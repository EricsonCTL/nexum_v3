'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const DIR=path.join(__dirname,'tb_apoio'),FILE=path.join(DIR,'tabela_fipezap.csv'),FALLBACK=path.join(DIR,'tb_apoio_fipezap.csv');
const CITIES=['Brasil','João Pessoa','Campina Grande'];
const HEADERS=['cidade','competencia','variacao_12m_pct','variacao_ytd_pct','fonte','status','observacao'];
const LEGACY_HEADERS=['Recorte','Preço médio (R$/m²)','Variação em 12 meses','Variação em 2026 (jan–ago)'];
const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const clean=value=>String(value??'').trim().replace(/^'+/,'');
const cityFrom=value=>CITIES.find(city=>key(value).startsWith(key(city)));
function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(s=>s.trim()))rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw Error('CSV com aspas não fechadas.');row.push(field);if(row.some(s=>s.trim()))rows.push(row);return rows;
}
function optionalPercent(value){if(!String(value??'').trim())return null;const raw=String(value).trim();if(!/^[+-]?\d+(?:[.,]\d+)?$/.test(raw))return NaN;const number=Number(raw.replace(',','.'));return Number.isFinite(number)&&number>=-100?number:NaN;}
function emptyCity(cidade){return {cidade,available:false,competencia:null,variacao_12m_pct:null,variacao_ytd_pct:null,fonte:'FipeZAP',status:cidade==='Campina Grande'?'sem_serie_oficial':'nao_cadastrado',observacao:cidade==='Campina Grande'?'Sem série oficial FipeZAP disponível na base local':'Sem referência oficial cadastrada na base local',periodMonths:12};}
function parseStructured(matrix,header){
  const warnings=[],records=[];
  for(const [i,cells] of matrix.entries()){
    const r=Object.fromEntries(header.map((h,index)=>[h,clean(cells[index])])),city=CITIES.find(c=>key(c)===key(r.cidade));
    const value=optionalPercent(r.variacao_12m_pct),ytd=optionalPercent(r.variacao_ytd_pct),status=key(r.status);
    const reason=!city?'cidade desconhecida':!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.competencia)?'competência inválida':!['oficial','sem_serie_oficial'].includes(status)?'status inválido':!r.fonte?'fonte ausente':Number.isNaN(value)||Number.isNaN(ytd)?'percentual inválido':status==='oficial'&&value===null?'variação de 12 meses ausente':status==='sem_serie_oficial'&&(value!==null||ytd!==null)?'sem série oficial não pode conter valores':cells.length!==header.length?'número de colunas inválido':null;
    if(reason){warnings.push(`Linha ${i+2}: ${reason}.`);continue;}
    records.push({cidade:city,competencia:r.competencia,variacao_12m_pct:value,variacao_ytd_pct:ytd,fonte:r.fonte,status,observacao:r.observacao,periodMonths:12});
  }
  const counts=new Map();for(const r of records){const id=r.cidade+'|'+r.competencia;counts.set(id,(counts.get(id)||0)+1);}
  [...counts].filter(([,n])=>n>1).forEach(([id])=>warnings.push(`Competência duplicada: ${id}. Registros dessa competência não utilizados.`));
  const valid=records.filter(r=>counts.get(r.cidade+'|'+r.competencia)===1);
  return {cities:CITIES.map(cidade=>{const latest=valid.filter(r=>r.cidade===cidade).sort((a,b)=>a.competencia.localeCompare(b.competencia)).at(-1);return latest?{...latest,available:latest.status==='oficial'}:emptyCity(cidade);}),warnings};
}
function parseMarketTable(matrix,header){
  const warnings=[],columns=Object.fromEntries(header.map((name,index)=>[name,index])),record=new Map();
  for(const [i,cells] of matrix.entries()){
    const cidade=cityFrom(cells[columns.Recorte]);if(!cidade){warnings.push(`Linha ${i+2}: recorte não reconhecido.`);continue;}
    const variation=clean(cells[columns['Variação em 12 meses']]),ytd=clean(cells[columns['Variação em 2026 (jan–ago)']]),price=clean(cells[columns['Preço médio (R$/m²)']]);
    const official=!/estimado/i.test(`${variation} ${price}`),numeric=optionalPercent(variation.replace('%','').replace('+',''));
    record.set(cidade,{cidade,available:Boolean(variation),competencia:null,variacao_12m_pct:Number.isNaN(numeric)?null:numeric,variacao_12m_display:variation,variacao_ytd_display:ytd,preco_m2_display:price,fonte:official?'FipeZAP · tabela de apoio':'Tabela de apoio · estimativa informada',status:official?'oficial':'estimado',observacao:official?'':'Valor estimado informado na tabela de apoio; não é uma série oficial FipeZAP.',periodMonths:12});
  }
  return {cities:CITIES.map(cidade=>record.get(cidade)||emptyCity(cidade)),warnings};
}
function getLatestFipezapByCity(text){
  const matrix=parseCsv(String(text||'').replace(/^\uFEFF/,'')),header=matrix.shift()||[];
  if(HEADERS.every(h=>header.includes(h)))return {...parseStructured(matrix,header),source:'tb_apoio/tb_apoio_fipezap.csv',informationalOnly:true};
  if(LEGACY_HEADERS.every(h=>header.includes(h)))return {...parseMarketTable(matrix,header),source:'tb_apoio/tabela_fipezap.csv',informationalOnly:true};
  throw Error('Cabeçalho inválido na tabela de apoio FipeZAP.');
}
async function loadFipezapReference(file){
  const candidates=file?[file]:[FILE,FALLBACK];let lastError;
  for(const candidate of candidates){try{const result=getLatestFipezapByCity(await fs.readFile(candidate,'utf8'));return {...result,source:path.relative(__dirname,candidate).replace(/\\/g,'/')};}catch(error){lastError=error;if(error.code!=='ENOENT')break;}}
  const result=getLatestFipezapByCity(HEADERS.join(','));result.warnings.push(lastError?.code==='ENOENT'?'Tabela de apoio FipeZAP ainda não cadastrada.':lastError?.message||'Tabela FipeZAP indisponível.');return result;
}
// Leitura somente local. Este módulo não participa do cálculo econômico e não grava arquivos.
module.exports={loadFipezapReference,getLatestFipezapByCity};
