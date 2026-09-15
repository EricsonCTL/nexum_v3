'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
const SOURCE='https://sindusconjp.com.br/pesquisas-e-indices/';
const MONTHS=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function parseCub(text,url){
  const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const date=normalized.match(/(?:\)\s*-\s*|mes de\s+)(Janeiro|Fevereiro|Marco|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\/(\d{4})/i);
  if(!date)return [];
  const month=`${date[2]}-${String(MONTHS.indexOf(date[1].toLowerCase())+1).padStart(2,'0')}`;
  let columns=[],section='';const rows=[];
  for(const line of normalized.split(/\r?\n/)){
    if(/PROJETOS.*RESIDENCIAIS/.test(line))section='Residencial';
    if(/PROJETOS.*COMERCIAIS/.test(line))section='Comercial';
    if(/PROJETOS.*GALPAO/.test(line)){section='Outros';columns=[];}
    if(/PADRAO BAIXO|PADRAO NORMAL/.test(line))columns=[...line.matchAll(/PADRAO (BAIXO|NORMAL|ALTO)/g)].map(m=>({index:m.index,standard:m[1]}));
    for(const m of line.matchAll(/\b(R-\d+|PP-\d+|PIS|CAL-\d+|CSL-\d+|RP1Q|GI)\s+([\d.]+,\d+)\s+(-?[\d.,]+)%/g)){
      const standard=columns.length?columns.reduce((best,c)=>Math.abs(c.index-m.index)<Math.abs(best.index-m.index)?c:best).standard:null;
      const code=[m[1],standard].filter(Boolean).join(' / ');
      rows.push({code,description:`${section} · ${m[1]}${standard?' · Padrão '+standard.toLowerCase():''}`,month,level:Number(m[2].replace(/\./g,'').replace(',','.')),value:Number(m[3].replace(/\./g,'').replace(',','.')),source:'Sinduscon-João Pessoa · CUB-PB (não desonerado)',url});
    }
  }return rows;
}
async function getCubPB(existing={}){
  const response=await fetch(SOURCE,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('CUB-PB: página oficial indisponível.');
  const html=await response.text();let media=[];
  try{const api=await fetch('https://sindusconjp.com.br/wp-json/wp/v2/media?search=CUB&per_page=100',{signal:AbortSignal.timeout(12000)});if(api.ok){const list=await api.json();if(Array.isArray(list))media=list.map(item=>item.source_url);}}catch{}
  const urls=[...new Set([...media,...[...html.matchAll(/href=["']([^"']+\.pdf)["']/gi)].map(m=>m[1].replace(/&amp;/g,'&'))].filter(u=>/CUB/i.test(u)&&!/des.?onerad|desronerad/i.test(u)&&/^https:\/\/sindusconjp\.com\.br\//.test(u)))].slice(0,30);
  const series=JSON.parse(JSON.stringify(existing));const known=new Set(Object.values(series).flatMap(s=>(s.rows||[]).map(r=>r.url)));const warnings=[];
  // Small batches keep the official publisher from receiving a burst of downloads.
  for(let i=0;i<urls.length;i+=3)await Promise.all(urls.slice(i,i+3).filter(url=>!known.has(url)).map(async url=>{
    let dir;
    try{
      const pdf=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!pdf.ok)throw new Error();
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexum-cub-'));const file=path.join(dir,'source.pdf');await fs.writeFile(file,Buffer.from(await pdf.arrayBuffer()));
      const {stdout}=await execFile('pdftotext',['-layout',file,'-'],{windowsHide:true,maxBuffer:2*1024*1024,timeout:15000});
      const parsed=parseCub(stdout,url);if(!parsed.length)throw new Error('Tabela não reconhecida');
      for(const row of parsed){const key=`cub-pb:${row.code}`;const item=series[key]||{code:row.code,description:row.description,source:row.source,url:SOURCE,rows:[]};if(!item.rows.some(r=>r.month===row.month))item.rows.push(row);item.rows.sort((a,b)=>a.month.localeCompare(b.month));item.fetchedAt=new Date().toISOString();series[key]=item;}
    }catch{warnings.push(`CUB-PB: publicação não carregada: ${url}`);}finally{if(dir)await fs.rm(path.join(dir,'source.pdf'),{force:true}).then(()=>fs.rmdir(dir)).catch(()=>{});}
  }));return {series,warnings};
}
module.exports={parseCub,getCubPB};
