'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { getSeries } = require('./igpm-service');
const { getCubPB } = require('./cub-pb-service');
const CONFIG = path.join(__dirname, 'reajuste-config.json');
const CACHE = path.join(__dirname, 'data', 'economic-reference-cache.json');
let pending;
const monthIndex = m => Number(m.slice(0,4))*12+Number(m.slice(5,7))-1;
const monthKey = i => `${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;
const INDICATORS=['incc','cub','ipca','igpm'];
const validMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validNumber=value=>typeof value==='number'&&Number.isFinite(value);
function calculateConstructionCost(incc,cub){return validNumber(incc)&&validNumber(cub)?(incc+cub)/2:null;}
function calculateEconomicPressure(ipca,igpm){return validNumber(ipca)&&validNumber(igpm)?(ipca+igpm)/2:null;}
function calculateSectorPressure(cost,pressure){return validNumber(cost)&&validNumber(pressure)?Math.max(0,cost-pressure):null;}
// Entradas e saídas em frações (0,0661 = 6,61%). Nenhum dado da carteira,
// FipeZAP, Selic ou parâmetro de ponderação participa desta função.
function calculateNexumIndex({incc,cub,ipca,igpm}={}){
  const constructionCost=calculateConstructionCost(incc,cub),economicPressure=calculateEconomicPressure(ipca,igpm),sectorPressure=calculateSectorPressure(constructionCost,economicPressure);
  return {constructionCost,economicPressure,sectorPressure,index:sectorPressure===null?null:constructionCost+sectorPressure};
}
function calculateReference(series,currentMonth,periodMonths=12) {
  if(!validMonth(currentMonth))return {available:false,reason:'Competência de referência inválida.'};
  if(!Number.isInteger(periodMonths)||periodMonths<1||periodMonths>12)return {available:false,reason:'Período de referência inválido.'};
  const components=INDICATORS.map(key=>{
    const map=new Map(),duplicates=new Set();
    for(const row of series[key]?.rows||[]){
      if(!validMonth(row.month)||!validNumber(row.value)||row.value<=-100||row.month>=currentMonth)continue;
      if(map.has(row.month)||duplicates.has(row.month)){map.delete(row.month);duplicates.add(row.month);}else map.set(row.month,row.value);
    }
    const candidates=[...map.keys()].sort().reverse(),latestAvailable=candidates[0];
    const end=candidates.find(candidate=>Array.from({length:periodMonths},(_,i)=>monthKey(monthIndex(candidate)-periodMonths+1+i)).every(m=>map.has(m)));
    const months=end?Array.from({length:periodMonths},(_,i)=>monthKey(monthIndex(end)-periodMonths+1+i)):[];
    const metadata={key,source:series[key]?.source,url:series[key]?.url,updatedAt:series[key]?.fetchedAt,latestAvailable,duplicates:[...duplicates]};
    if(months.length!==periodMonths)return {...metadata,available:false};
    const rows=months.map(month=>({month,value:map.get(month)})),accumulated=rows.reduce((p,r)=>p*(1+r.value/100),1)-1;
    return {...metadata,available:true,from:months[0],to:end,historyGap:latestAvailable!==end,accumulated,monthly:Math.pow(1+accumulated,1/periodMonths)-1,rows};
  });
  if(components.some(c=>!c.available))return {available:false,reason:`São necessárias ${periodMonths} competências consecutivas válidas para INCC, CUB, IPCA e IGP-M.`,components};
  const blocks=calculateNexumIndex(Object.fromEntries(components.map(c=>[c.key,c.accumulated])));
  const annualEquivalent=Math.pow(1+blocks.index,12/periodMonths)-1;
  return {available:true,name:'Índice NEXUM — Custo e Pressão Econômica',method:'custo + max(0, custo - pressao_economica)',baseMonths:periodMonths,from:components.map(c=>c.from).sort()[0],to:components.map(c=>c.to).sort().at(-1),period:blocks.index,annual:annualEquivalent,annualEquivalent,monthly:Math.pow(1+blocks.index,1/periodMonths)-1,blocks,components};
}
async function loadSeries(config) {
  if(pending)return pending;
  pending=(async()=>{
    let cached={};try{cached=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{}
    const signature=JSON.stringify(config.cubSources);
    if(cached.signature===signature&&Date.now()-Date.parse(cached.updatedAt)<config.refreshHours*3600000)return cached;
    const today=new Date(),to=today.toISOString().slice(0,10),from=`${today.getUTCFullYear()-3}-01-01`;
    const series={...cached.series}, warnings=[],expected=monthKey(monthIndex(to.slice(0,7))-1);
    for(const key of ['incc','ipca','igpm']){
      if(series[key]?.rows?.some(r=>r.month===expected))continue;
      const item=await getSeries(key,from,to);if(item.rows.length){const known=new Map((series[key]?.rows||[]).map(r=>[r.month,r]));for(const row of item.rows)if(!known.has(row.month))known.set(row.month,{...row,source:item.source,url:item.url,storedAt:item.fetchedAt});series[key]={...item,rows:[...known.values()].sort((a,b)=>a.month.localeCompare(b.month))};}if(item.warning)warnings.push(item.warning);
    }
    const cubStored=Object.fromEntries(Object.entries(series).filter(([key])=>key.startsWith('cub-pb:')));
    if(!Object.values(cubStored).length||Object.values(cubStored).some(s=>!s.rows.some(r=>r.month===expected)))try{const cub=await getCubPB(cubStored);Object.assign(series,cub.series);warnings.push(...cub.warnings);}catch{warnings.push('CUB-PB indisponível; histórico local preservado.');}
    await Promise.all(Object.entries(config.cubSources).map(async([code,source])=>{
      try{
        const response=await fetch(source.url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();
        const data=await response.json();const input=source.rowsKey?data[source.rowsKey]:data;
        if(!Array.isArray(input))throw new Error();
        const rows=input.map(r=>({month:String(r[source.monthField||'month']).slice(0,7),value:r[source.variationField||'value']==null?null:Number(String(r[source.variationField||'value']).replace(',','.'))})).filter(r=>/^\d{4}-\d{2}$/.test(r.month)&&typeof r.value==='number'&&Number.isFinite(r.value));
        if(!rows.length)throw new Error();series[code]={rows,source:source.label,url:source.url,fetchedAt:new Date().toISOString()};
      }catch{warnings.push(`CUB ${code}: fonte indisponível; usando histórico armazenado quando existente.`);}
    }));
    const result={signature,updatedAt:new Date().toISOString(),series,warnings};
    await fs.mkdir(path.dirname(CACHE),{recursive:true});const temp=CACHE+'.pending';await fs.writeFile(temp,JSON.stringify(result));await fs.rename(temp,CACHE);return result;
  })();try{return await pending;}finally{pending=null;}
}
function cubAverageSeries(series, sourceUrl) {
  const cubSources=Object.entries(series || {}).filter(([key,item]) => key.startsWith('cub-pb:') && Array.isArray(item?.rows));
  const valuesByMonth=new Map();
  for (const [, item] of cubSources) for (const row of item.rows || []) {
    const month=String(row?.month || ''); const value=row?.value;
    if (!validMonth(month) || !validNumber(value) || value <= -100) continue;
    if (!valuesByMonth.has(month)) valuesByMonth.set(month,[]);
    valuesByMonth.get(month).push(value);
  }
  const rows=[...valuesByMonth.entries()].map(([month, values]) => ({ month, value:values.reduce((sum,value) => sum + value,0) / values.length, fontes:values.length })).sort((left,right) => left.month.localeCompare(right.month));
  if (!rows.length) return null;
  return {
    rows,
    source:'Sinduscon-João Pessoa · média simples dos padrões oficiais disponíveis do CUB-PB',
    url:sourceUrl,
    fetchedAt:cubSources.map(([,item]) => item.fetchedAt).filter(Boolean).sort().at(-1) || null,
    metodologia:'Média simples por competência entre os padrões CUB-PB oficialmente publicados; sem segmentação por padrão econômico do empreendimento.',
    seriesCount:cubSources.length
  };
}
async function getReference(months=6) {
  const config=JSON.parse(await fs.readFile(CONFIG,'utf8'));let cached;
  try{cached=JSON.parse(await fs.readFile(CACHE,'utf8'));}catch{cached=await loadSeries(config);}
  const series={...cached.series};
  const cub=cubAverageSeries(cached.series,config.cubSource); if (cub) series.cub=cub;
  const result=calculateReference(series,new Date().toISOString().slice(0,7),months);
  return {...result,months,warnings:cached.warnings,cubConfigured:Boolean(series.cub),cubMethod:series.cub?.metodologia || null,cubCatalog:Object.entries(cached.series).filter(([key])=>key.startsWith('cub-pb:')).map(([key,s])=>({key,code:s.code,description:s.description,source:s.source,url:s.url,month:s.rows.at(-1)?.month})),updatedAt:cached.updatedAt};
}
async function refreshReference(){const config=JSON.parse(await fs.readFile(CONFIG,'utf8'));return loadSeries(config);}
function startReferenceUpdates(){refreshReference().catch(console.error);const timer=setInterval(()=>refreshReference().catch(console.error),24*3600000);timer.unref();}
module.exports={calculateConstructionCost,calculateEconomicPressure,calculateSectorPressure,calculateNexumIndex,calculateReference,cubAverageSeries,getReference,refreshReference,startReferenceUpdates};
