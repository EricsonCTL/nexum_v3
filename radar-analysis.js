'use strict';

// Pure analytical rules. VSO/IVV arrive from the existing commercial service.
const AXES = ['vso', 'ivv', 'absorption', 'coverage', 'adjustment', 'iap'];
const WEIGHTS = { price: .30, vso: .25, ivv: .15, absorption: .15, coverage: .15 };
const DAY = 86400000;
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const median = values => {
  const sorted = values.filter(finite).map(Number).sort((a,b) => a-b), n = sorted.length;
  return n ? (sorted[Math.floor(n/2)] + sorted[Math.ceil(n/2)-1])/2 : null;
};
const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const timestamp = value => Date.parse(String(value).slice(0,10) + 'T00:00:00Z');
const month = value => String(value || '').slice(0,7);
const known = value => !!key(value) && !['nao informado','indefinido','outro','outros'].includes(key(value));

function normalized(value, population, inverse = false) {
  if (!finite(value)) return null;
  const values = population.filter(finite).map(Number);
  if (values.length < 2 || values.every(item => item === values[0])) return 50;
  const less = values.filter(item => item < value).length, ties = values.filter(item => item === value).length;
  const percentile = Math.max(0, Math.min(100, 100*(less + Math.max(0,ties-1)/2)/(values.length-1)));
  return inverse ? 100-percentile : percentile;
}

function prepareHistory(history, until) {
  const byDate = new Map();
  [...(history || [])].filter(row => Number.isFinite(timestamp(row.date)) && (!until || month(row.date) <= month(until)))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.order||a.id).localeCompare(String(b.order||b.id)))
    .forEach(row => byDate.set(String(row.date).slice(0,10), row));
  return [...byDate.values()];
}

function absorption(history, from) {
  const lower=from ? timestamp(String(from).length===7 ? from+'-01' : from) : -Infinity;
  const rows=prepareHistory(history).filter(row=>timestamp(row.date)>=lower);
  if(rows.length<2)return {value:null,observedDays:0,absorbedUnits:null,initialStock:null,finalStock:null,reason:'Histórico insuficiente: são necessárias duas tabelas em datas distintas dentro do período selecionado.'};
  const first=rows[0],last=rows.at(-1),observedDays=(timestamp(last.date)-timestamp(first.date))/DAY;
  if(!Array.isArray(first.units)||!Array.isArray(last.units))return {value:null,observedDays,absorbedUnits:null,initialStock:null,finalStock:null,reason:'Estoque não informado em uma das tabelas de referência.'};
  const initialStock=first.units.filter(unit=>unit.available).length,finalStock=last.units.filter(unit=>unit.available).length,absorbedUnits=initialStock-finalStock;
  return {value:absorbedUnits/observedDays*30.44,observedDays,absorbedUnits,initialStock,finalStock,
    from:first.date,to:last.date,reason:null,estimated:true,method:'net_stock_change'};
}

const GAP_TOLERANCE_PP=.05; // Half of the displayed 0.1 p.p. rounding step.
function gapPosition(gap) {
  return !finite(gap)?'unavailable':Math.abs(gap)<GAP_TOLERANCE_PP?'aligned':gap<0?'below':'above';
}

function accumulateIgpm(series, from, to) {
  if (!from || !to || month(from) >= month(to)) return { value:null, missing:[], reason:'Período sem competências mensais completas para comparar.' };
  const start = new Date(month(from)+'-01T00:00:00Z'), finish = month(to), byMonth = new Map((series||[]).map(row => [row.month,row.value]));
  const months=[],missing=[]; let factor=1;
  start.setUTCMonth(start.getUTCMonth()+1);
  while (start.toISOString().slice(0,7) <= finish) {
    const period = start.toISOString().slice(0,7), value = byMonth.get(period); months.push(period);
    if (!finite(value)) missing.push(period); else factor *= 1+Number(value)/100;
    start.setUTCMonth(start.getUTCMonth()+1);
  }
  return { value:missing.length ? null : (factor-1)*100, months, missing,
    reason:missing.length ? 'IGP-M indisponível em uma ou mais competências do período.' : null };
}

function priceAdjustment(history, igpm) {
  const first = history[0], current = history.at(-1), events=[]; let comparablePairs=0, lastPairCount=0, fallbackPairs=0;
  for (let index=1; index<history.length; index++) {
    const previous=history[index-1], next=history[index], before=new Map(previous.units.filter(unit=>unit.id).map(unit=>[unit.id,unit]));
    const variations=[],fallback=[];
    for (const unit of next.units) {
      const old=before.get(unit.id);
      if (!old || !old.available || !unit.available) continue;
      if (finite(old.priceM2)&&old.priceM2>0&&finite(unit.priceM2)&&unit.priceM2>0) variations.push((unit.priceM2/old.priceM2-1)*100);
      else if (finite(old.price)&&old.price>0&&finite(unit.price)&&unit.price>0) fallback.push((unit.price/old.price-1)*100);
    }
    const selected=variations.length ? variations : fallback;
    if (!selected.length) continue;
    comparablePairs++;lastPairCount=selected.length;if(!variations.length)fallbackPairs++;
    const value=median(selected);
    if (Math.abs(value)>0.000001) events.push({ date:next.date, value, units:selected.length, basis:variations.length?'Preço/m²':'Preço total (metragem indisponível)', previousDate:previous.date });
  }
  if (!first||!current||!comparablePairs) return { value:null, gap:null, igpm:null, event:null, from:first?.date||null, to:current?.date||null, reason:'Histórico insuficiente de unidades com preços comparáveis.' };
  const event=events.at(-1)||null;
  if(!event&&comparablePairs<history.length-1)return { value:null,gap:null,igpm:null,event:null,from:first.date,to:current.date,reason:'Histórico de preços com lacunas: não é possível afirmar ausência de reajuste.' };
  const from=event ? (events.at(-2)?.date||first.date) : first.date, to=event?.date||current.date, reference=accumulateIgpm(igpm,from,to), value=event?.value||0;
  const gap=finite(reference.value)?value-reference.value:null;
  return { value, gap, position:gapPosition(gap), tolerance:GAP_TOLERANCE_PP, igpm:reference.value, from,to,event,
    monitoredSince:first.date, latestTable:current.date, unchangedSince:event?.date||first.date,
    comparableUnits:event?.units||lastPairCount, basis:event?.basis||(fallbackPairs?'Preço total (metragem indisponível)':'Preço/m²'),
    incompleteHistory:comparablePairs<history.length-1, missingMonths:reference.missing, reason:reference.reason };
}

function comparablePeers(target, entries) {
  if(!known(target.type)||!known(target.standard)||!known(target.city))return {rows:[],label:'Tipo, padrão econômico e cidade são necessários para definir comparáveis.'};
  const compatibleCharacteristics=row=>{
    const a=target.characteristics||{},b=row.characteristics||{},overlap=(left=[],right=[])=>!left.length||!right.length||left.some(item=>right.includes(item));
    if(!overlap(a.dormitorios,b.dormitorios)||!overlap(a.vagas?.quantidades,b.vagas?.quantidades))return false;
    return Object.entries(a.atributos||{}).every(([attribute,value])=>!['sim','nao'].includes(value)||!['sim','nao'].includes(b.atributos?.[attribute])||b.atributos[attribute]===value);
  };
  const peers=entries.filter(row=>row.id!==target.id&&known(row.type)&&known(row.standard)&&known(row.city)&&key(row.type)===key(target.type)&&key(row.standard)===key(target.standard)&&key(row.city)===key(target.city)&&row.modality===target.modality&&finite(row.priceM2)&&row.priceM2>0&&compatibleCharacteristics(row));
  // Preço não é uma chave absoluta: é um filtro de proximidade dentro do
  // mesmo produto. Mantemos a faixa ampla quando ela deixaria o grupo vazio.
  const pricePeers=finite(target.priceM2)&&target.priceM2>0 ? peers.filter(row=>Math.abs(row.priceM2-target.priceM2)/target.priceM2<=.3) : peers;
  const scopedPeers=pricePeers.length>=2 ? pricePeers : peers;
  const neighborhood=scopedPeers.filter(row=>known(target.neighborhood)&&key(row.neighborhood)===key(target.neighborhood));
  const dimensions=' Dormitórios, vagas e atributos compatíveis quando informados; características ausentes não são inferidas.';
  return neighborhood.length ? {rows:neighborhood,label:'Mesmo bairro, produto, padrão econômico, faixa de preço e modalidade.'+dimensions} : {rows:scopedPeers,label:'Mesma cidade, produto, padrão econômico e faixa de preço; base ampliada além do bairro.'+dimensions};
}

function iapBand(value) {
  if (!finite(value)) return 'N/D';
  return value<=20?'Muito baixa':value<=40?'Baixa':value<=60?'Moderada':value<=80?'Boa':'Alta';
}

function analyze(entries, indices = {}, query = {}) {
  const rows=entries.map(entry=>{
    const history=prepareHistory(entry.history,query.ate), estimate=entry.absorptionBlocked?{value:null,observedDays:0,reason:entry.absorptionBlocked}:absorption(history,query.de), adjustment=priceAdjustment(history,indices.rows||[]);
    const coverage=finite(entry.available)&&estimate.value>0 ? entry.available/estimate.value : null;
    return {...entry,history:undefined,absorption:estimate,coverage:{value:coverage,reason:finite(coverage)?null:estimate.value===0?'Cobertura indeterminada / sem absorção identificada.':estimate.value<0?'Cobertura indeterminada: o estoque disponível aumentou no período.':estimate.reason},adjustment,
      values:{vso:finite(entry.vso)?Number(entry.vso):null,ivv:finite(entry.ivv)?Number(entry.ivv):null,absorption:estimate.value,coverage,adjustment:adjustment.gap,iap:null},scores:{},counts:{}};
  });
  for(const row of rows) {
    const peers=comparablePeers(row,rows), reference=median(peers.rows.map(item=>item.priceM2));
    for(const metric of AXES.filter(item=>item!=='iap')) {
      const cohort=metric==='absorption'||metric==='coverage'?[row,...peers.rows]:rows;
      const population=cohort.map(item=>metric==='adjustment'&&finite(item.values[metric])?Math.abs(item.values[metric]):item.values[metric]);
      const value=metric==='adjustment'&&finite(row.values[metric])?Math.abs(row.values[metric]):row.values[metric];
      row.scores[metric]=normalized(value,population,metric==='coverage'||metric==='adjustment');
      row.counts[metric]=population.filter(finite).length;
    }
    const priceScore=peers.rows.length&&finite(row.priceM2)&&row.priceM2>0?normalized(row.priceM2,[row.priceM2,...peers.rows.map(item=>item.priceM2)],true):null;
    row.price={value:row.priceM2,reference,score:priceScore,peerCount:peers.rows.length,peerIds:peers.rows.map(item=>item.id),group:peers.label,reduced:peers.rows.length<5,relative:reference>0&&finite(row.priceM2)&&row.priceM2>0?(row.priceM2/reference-1)*100:null};
    row.scores.price=priceScore;
    const complete=Object.keys(WEIGHTS).every(metric=>finite(row.scores[metric]));
    row.values.iap=complete?Math.max(0,Math.min(100,Object.entries(WEIGHTS).reduce((sum,[metric,weight])=>sum+row.scores[metric]*weight,0))):null;
    row.scores.iap=row.values.iap;
    row.iap={value:row.values.iap,band:iapBand(row.values.iap),components:Object.entries(WEIGHTS).map(([metric,weight])=>({metric,weight,value:metric==='price'?row.priceM2:row.values[metric],score:row.scores[metric]})),missing:Object.keys(WEIGHTS).filter(metric=>!finite(row.scores[metric]))};
    row.reduced=rows.length<5||row.price.reduced||Object.values(row.counts).some(count=>count<5);
  }
  // Diferencial relativo: cada ativo é comparado ao seu próprio grupo, não ao
  // ranking bruto da carteira. O sinal publicado é o maior desvio positivo ou
  // negativo com base suficiente para não fabricar distinção.
  for(const row of rows) {
    const peers=comparablePeers(row,rows).rows, peerIds=new Set(peers.map(item=>item.id));
    const differentials=AXES.filter(metric=>metric!=='iap').map(metric=>{
      const peerValues=rows.filter(item=>peerIds.has(item.id)).map(item=>item.scores?.[metric]).filter(finite);
      const value=row.scores?.[metric];
      return { metric, score:finite(value)&&peerValues.length>=2 ? Number(value)-median(peerValues) : null, groupCount:peerValues.length };
    }).filter(item=>finite(item.score)).sort((a,b)=>Math.abs(b.score)-Math.abs(a.score));
    const lead=differentials[0]||null;
    row.group={count:peers.length,ids:peers.map(item=>item.id),label:comparablePeers(row,rows).label};
    row.differential=lead&&Math.abs(lead.score)>=10 ? {metric:lead.metric,score:Number(lead.score.toFixed(1)),direction:lead.score>0?'acima':'abaixo',groupCount:lead.groupCount} : null;
  }
  return {version:'radar_nexum_v1',axes:AXES,weights:WEIGHTS,rows,rankings:Object.fromEntries(AXES.map(metric=>[metric,rank(rows,metric).map(row=>row.id)])),filters:query,indexSource:{name:'FGV · IGP-M / Banco Central SGS 189',url:indices.url||'https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&series=189',fetchedAt:indices.fetchedAt||null,warning:indices.warning||null},methodology:{normalization:'Posto percentílico com empates no ponto médio; base unitária ou constante recebe 50/100. Não é uma meta absoluta.',coverage:'Menor cobertura = maior score.',adjustment:'Menor distância absoluta do gap ao IGP-M = maior score. Acima/abaixo continua exibido no valor real.',indexPeriod:'Capitalização mensal, do mês seguinte à data inicial até o mês final, sem rateio diário.',iap:'Sem um componente, IAP = N/D. Os pesos não são redistribuídos.',smallBase:'Menos de cinco observações válidas: base comparativa reduzida.'}};
}

function rank(rows, criterion='vso') {
  const metric=AXES.includes(criterion)?criterion:'vso';
  return [...rows].sort((a,b)=>{
    const av=a.values[metric],bv=b.values[metric];
    if(!finite(av)||!finite(bv))return Number(finite(bv))-Number(finite(av))||a.name.localeCompare(b.name,'pt-BR');
    const diff=metric==='coverage'?av-bv:metric==='adjustment'?Math.abs(av)-Math.abs(bv):bv-av;
    return diff||a.name.localeCompare(b.name,'pt-BR');
  });
}

module.exports={AXES,WEIGHTS,finite,median,normalized,prepareHistory,absorption,accumulateIgpm,priceAdjustment,gapPosition,comparablePeers,iapBand,analyze,rank};
