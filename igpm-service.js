'use strict';

const BCB='https://api.bcb.gov.br/dados/serie/bcdata.sgs.';
const SERIES={
  igpm:{ id:189, label:'IGP-M', source:'FGV · Banco Central, SGS 189' },
  ipca:{ id:433, label:'IPCA', source:'IBGE · Banco Central, SGS 433' },
  incc:{ id:192, label:'INCC', source:'FGV · Banco Central, SGS 192' }
};
const cache=new Map(),pending=new Map(),ttl=6*60*60*1000;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
async function getSeries(key,from,to,fetcher=fetch) {
  const definition=SERIES[key]; if(!definition)throw new Error(`Índice não configurado: ${key}`);
  const start=String(from||to).slice(0,10),end=String(to).slice(0,10),cached=cache.get(key),covers=item=>item&&item.from<=start&&item.to>=end;
  if(!validDate(start)||!validDate(end))return {rows:[],warning:'Datas insuficientes para consultar o índice.',...definition};
  if(covers(cached)&&Date.now()-cached.stamp<ttl)return cached;
  if(pending.has(key)){const result=await pending.get(key);if(covers(result))return result;}
  const br=date=>date.split('-').reverse().join('/'),url=`${BCB}${definition.id}/dados?formato=json&dataInicial=${br(start)}&dataFinal=${br(end)}`;
  const request=(async()=>{
    try {
      const response=await fetcher(url,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();if(!Array.isArray(data))throw new Error('Série mensal inválida');
      const rows=data.map(row=>({month:`${String(row.data).slice(6,10)}-${String(row.data).slice(3,5)}`,value:row.valor===null||row.valor===''?null:Number(String(row.valor).replace(',','.'))})).filter(row=>/^\d{4}-\d{2}$/.test(row.month)&&Number.isFinite(row.value));
      const result={rows,from:start,to:end,url,fetchedAt:new Date().toISOString(),stamp:Date.now(),warning:null,...definition};cache.set(key,result);return result;
    } catch(error) { return covers(cached)?{...cached,warning:`${definition.label} indisponível: usando a última consulta válida em cache.`}:{rows:[],url,warning:`${definition.label} indisponível na fonte oficial. O valor fica N/D.`,...definition}; }
  })();
  pending.set(key,request);try{return await request;}finally{pending.delete(key);}
}
async function getMarketIndices(from,to,fetcher=fetch) { const entries=await Promise.all(Object.keys(SERIES).map(async key=>[key,await getSeries(key,from,to,fetcher)]));return Object.fromEntries(entries); }
async function getIgpm(from,to,fetcher=fetch) { return getSeries('igpm',from,to,fetcher); }
module.exports={SERIES,getSeries,getMarketIndices,getIgpm};
