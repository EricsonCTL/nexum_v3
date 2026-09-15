const fs = require('node:fs/promises');
const path = require('node:path');
// Esta camada é deliberadamente somente de leitura: consulta a fotografia que
// a raiz já consolidou. Importação, OCR, normalização e validação não existem
// no pacote online.
const BrokerNetwork = require('./broker-network');
const { calculateMarketPressure, pressureHistory } = require('./market-pressure');

let snapshotCache = null;
let brokerCache = null;
let brokerLoad = null;
const pressureCache = new Map();
const pressureMapCache = new Map();

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const moneyOf = (unit) => ['valorValidado', 'valorPublicado', 'valorInterpretado', 'valorExtraido', 'valor'].map((key) => number(unit?.[key])).find((value) => value != null && value > 0) ?? null;
const isAvailable = (unit) => /dispon|novo|reserv/i.test(String(unit?.situacaoComercial || unit?.situacaoPublicada || unit?.situacaoExtraida || ''));
const isSold = (unit) => /vend/i.test(String(unit?.situacaoComercial || unit?.situacaoPublicada || unit?.situacaoExtraida || ''));

async function snapshot(root) {
  const file = path.join(root, 'data', 'nexum-public.json');
  const stat = await fs.stat(file);
  const version = `${stat.mtimeMs}:${stat.size}`;
  if (snapshotCache?.version === version) return snapshotCache.data;
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  snapshotCache = { version, data };
  return data;
}

async function brokerData(root) {
  const directory = path.join(root, 'data', 'corretores');
  const files = ['manifest.json', 'opportunities.json', 'sender_directory.json'];
  const stats = await Promise.all(files.map((file) => fs.stat(path.join(directory, file))));
  const version = stats.map((stat) => `${stat.mtimeMs}:${stat.size}`).join('|');
  if (brokerCache?.version === version) return brokerCache.data;
  if (brokerLoad?.version === version) return brokerLoad.promise;
  const promise = Promise.all(files.map((file) => fs.readFile(path.join(directory, file), 'utf8').then(JSON.parse)))
    .then(([manifest, opportunities, senderDirectory]) => {
      const data = { manifest, opportunities:Array.isArray(opportunities) ? opportunities : [], directory:Array.isArray(senderDirectory) ? senderDirectory : [] };
      brokerCache = { version, data };
      return data;
    })
    .finally(() => { if (brokerLoad?.version === version) brokerLoad = null; });
  brokerLoad = { version, promise };
  return promise;
}

function tableOf(enterprise) {
  return [...(enterprise.tabelas || [])].filter((table) => table.status === 'registered')
    .sort((left, right) => String(right.validityDate || '').localeCompare(String(left.validityDate || '')))[0] || null;
}

function unitsOf(enterprise, table = tableOf(enterprise)) {
  return table?.unidades || enterprise.unidades || [];
}

function metricsOf(enterprise) {
  const table = tableOf(enterprise), units = unitsOf(enterprise, table), prices = units.map(moneyOf).filter((value) => value != null);
  const available = units.filter(isAvailable).length, sold = units.filter(isSold).length;
  return {
    table, units, total:units.length, available, sold,
    averagePrice: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null,
    vso: sold + available ? sold / (sold + available) * 100 : null
  };
}

function entryOf(enterprise) {
  const metrics = metricsOf(enterprise), tables = enterprise.tabelas || [];
  return {
    id:enterprise.id, nome:enterprise.nome, construtora:enterprise.construtora || '', bairro:enterprise.bairro || '', cidade:enterprise.cidade || '', estado:enterprise.estado || '',
    latitude:enterprise.latitude, longitude:enterprise.longitude, tipo:enterprise.tipo || 'Outro', padrao:enterprise.padrao || 'Indefinido', fase:enterprise.fase || 'Novo',
    imagem:enterprise.imagem || null, deliveryDate:enterprise.deliveryDate || null, latestTable:metrics.table, tableCount:tables.length,
    firstTableDate:[...tables].map((table) => table.validityDate).filter(Boolean).sort()[0] || null,
    current:{ units:metrics.total, available:metrics.available, averagePrice:metrics.averagePrice, sold:metrics.sold },
    pendingCurrent:null, pendingTable:null, unidades:metrics.total, disponiveis:metrics.available, vendas:metrics.sold,
    vso:metrics.vso, ivv:{ monthly:null, available:false }, favorite:false
  };
}

function applies(entry, query) {
  const selected = String(query.get('empreendimentos') || '').split(',').filter(Boolean);
  if (selected.length && !selected.includes(entry.id)) return false;
  const search = String(query.get('search') || '').toLocaleLowerCase('pt-BR');
  if (search && !`${entry.nome} ${entry.bairro} ${entry.cidade} ${entry.construtora}`.toLocaleLowerCase('pt-BR').includes(search)) return false;
  if (query.get('bairro') && query.get('bairro') !== entry.neighborhoodId && query.get('bairro') !== entry.bairro) return false;
  for (const key of ['tipo', 'padrao', 'fase']) if (query.get(key) && query.get(key) !== entry[key]) return false;
  const ticket = query.get('ticket'), price = Number(entry.current.averagePrice || 0);
  if (ticket === 'ate-500' && price > 500000) return false;
  if (ticket === '500-800' && !(price > 500000 && price <= 800000)) return false;
  if (ticket === '800-1200' && !(price > 800000 && price <= 1200000)) return false;
  if (ticket === 'acima-1200' && price <= 1200000) return false;
  return true;
}

function entriesOf(data, query) { return (data.empreendimentos || []).map(entryOf).filter((entry) => applies(entry, query)); }

function portfolio(data, query) {
  const entries = entriesOf(data, query), totals = entries.reduce((result, entry) => {
    result.unidades += entry.current.units; result.disponiveis += entry.current.available; result.vendas += entry.current.sold;
    if (entry.current.averagePrice) result.prices.push(entry.current.averagePrice);
    return result;
  }, { unidades:0, disponiveis:0, vendas:0, prices:[] });
  const ticketMedio = totals.prices.length ? totals.prices.reduce((sum, value) => sum + value, 0) / totals.prices.length : null;
  const vso = totals.vendas + totals.disponiveis ? totals.vendas / (totals.vendas + totals.disponiveis) * 100 : null;
  const month = new Date().toISOString().slice(0, 7);
  const photograph = { mes:month, unidades:totals.unidades, disponiveis:totals.disponiveis, ticketMedio, precoMedioM2:null, reajusteMedio:null, vgvDisponivel:ticketMedio ? ticketMedio * totals.disponiveis : null };
  const velocity = { mes:month, vso, ivv:null };
  const kpis = { empreendimentos:entries.length, unidades:totals.unidades, disponiveis:totals.disponiveis, vendasValidadas:totals.vendas, ticketMedio, precoMedioM2:null, reajusteMedio:null, ivv:null, vso, tabelasRecentes:entries.filter((entry) => entry.latestTable).length };
  return {
    entries, empreendimentos:entries.map((entry) => ({ ...entry, unidades:entry.current.units, disponiveis:entry.current.available })), kpis,
    vendasConfirmadas:totals.vendas, faixasPreco:[], filtros:{ de:'', ate:'' },
    series:{ consolidada:{ fotografias:[photograph], velocidade:[velocity] }, individuais:entries.map((entry) => ({ empreendimentoId:entry.id, nome:entry.nome, fotografias:[photograph], velocidade:[velocity] })) },
    podium:[...entries].filter((entry) => entry.vso != null).sort((a,b) => b.vso - a.vso).slice(0,3),
    noSales:entries.filter((entry) => entry.current.sold === 0).map((entry) => ({ ...entry, latestAge:0 })), changes:[],
    pulse:{ paragraphs:['Fotografia pública calculada a partir das tabelas já consolidadas pelo ambiente interno.'] },
    marketPressure:null, generatedAt:new Date().toISOString()
  };
}

function values(value) { return Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function isTrue(value) { return value === true || ['sim', 'true', '1'].includes(String(value || '').toLowerCase()); }
function parseTop(value) { return String(value || '').toLowerCase() === 'all' ? Infinity : ([10, 20, 30, 50].includes(Number(value)) ? Number(value) : 10); }
function parseRadius(query) {
  const lat = Number(query.raioLat), lng = Number(query.raioLng), km = Number(query.raioKm), zoom = Number(query.zoom || 12);
  return [lat, lng, km, zoom].every(Number.isFinite) && km > 0 ? { active:true, lat, lng, km, zoom } : null;
}
function mean(items) { const valid = items.map(Number).filter((item) => Number.isFinite(item) && item > 0); return valid.length ? valid.reduce((sum, item) => sum + item, 0) / valid.length : null; }
function recordMatchesExtendedFilters(record, query = {}) {
  const month = String(record.data_inicio || '').slice(0, 7);
  if (String(query.aplicarPeriodo || '') === '1' && query.de && month < String(query.de)) return false;
  if (String(query.aplicarPeriodo || '') === '1' && query.ate && month > String(query.ate)) return false;
  const search = String(query.search || '').trim().toLocaleLowerCase('pt-BR');
  if (search && !`${record.bairro_normalizado || ''} ${record.bairro_original || ''} ${record.tipo_imovel || ''} ${record.regiao || ''} ${record.zona || ''}`.toLocaleLowerCase('pt-BR').includes(search)) return false;
  const bedrooms = values(query.dormitorios); if (bedrooms.length && !bedrooms.includes(String(record.quartos ?? ''))) return false;
  const parking = values(query.vagas); if (parking.length && !parking.includes(String(record.vagas_garagem ?? ''))) return false;
  for (const feature of values(query.caracteristicas)) {
    if (feature === 'suite' && !(Number(record.suites) > 0)) return false;
    if (feature === 'area_lazer' && !isTrue(record.area_lazer_flag)) return false;
    if (feature === 'piscina' && !isTrue(record.piscina_flag)) return false;
    if (feature === 'mobiliado' && !isTrue(record.mobiliado_flag)) return false;
    if (feature === 'financiavel' && !isTrue(record.financiavel_flag)) return false;
  }
  return true;
}
function filterBrokerRecords(records, query = {}) {
  const analytical = (records || []).filter(BrokerNetwork.isAnalyticalRecord).filter((item) => recordMatchesExtendedFilters(item, query));
  const shared = BrokerNetwork.applySharedFilters(analytical, { bairro:query.bairro || '', bairros:query.bairros || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '' });
  return BrokerNetwork.applyOperationFilter(shared, query.operacoes || query.operacao || '');
}
function operationCounts(opportunities) {
  return Object.fromEntries(Object.keys(BrokerNetwork.OPERATION_META).filter((key) => key !== 'indefinida').map((key) => [key, opportunities.filter((item) => item.operacao_mercado === key).length]));
}
function operationTimeSeries(opportunities) {
  const keys = Object.keys(BrokerNetwork.OPERATION_META).filter((key) => key !== 'indefinida');
  const periods = [...new Set(opportunities.map((item) => String(item.data_inicio || '').slice(0, 7)).filter((item) => /^\d{4}-\d{2}$/.test(item)))].sort().slice(-13);
  const counts = new Map(periods.map((period) => [period, Object.fromEntries(keys.map((key) => [key, 0]))]));
  opportunities.forEach((item) => { const period = String(item.data_inicio || '').slice(0, 7), operation = item.operacao_mercado || 'indefinida'; if (counts.has(period) && Object.hasOwn(counts.get(period), operation)) counts.get(period)[operation] += 1; });
  return { periods:periods.map((period) => ({ period, label:new Date(`${period}-02T12:00:00`).toLocaleDateString('pt-BR', { month:'long', year:'numeric' }) })), series:keys.map((key) => ({ key, label:BrokerNetwork.operationMeta(key).label, color:BrokerNetwork.operationMeta(key).color, values:periods.map((period) => counts.get(period)[key] || 0) })) };
}

async function brokerAnalytics(root, query = {}) {
  const broker = await brokerData(root);
  const analytical = broker.opportunities.filter(BrokerNetwork.isAnalyticalRecord).filter((item) => recordMatchesExtendedFilters(item, query));
  const shared = BrokerNetwork.applySharedFilters(analytical, { bairro:query.bairro || '', bairros:query.bairros || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '' });
  const scoped = BrokerNetwork.applyOperationFilter(shared, query.operacoes || query.operacao || '');
  const radius = parseRadius(query), bubbles = BrokerNetwork.aggregateBubbles(scoped, scoped.length);
  const radiusNeighborhoods = BrokerNetwork.radiusNeighborhoods(bubbles, radius, scoped.length);
  const territorial = radius ? scoped.filter((item) => radiusNeighborhoods.has(BrokerNetwork.canonicalNeighborhood(item.bairro_normalizado))) : scoped;
  const focus = BrokerNetwork.canonicalNeighborhood(query.bairroFoco || '');
  const market = focus ? territorial.filter((item) => BrokerNetwork.canonicalNeighborhood(item.bairro_normalizado) === focus) : territorial;
  const analytics = BrokerNetwork.buildAnalytics(analytical, broker.directory, {
    filters:{ bairro:query.bairro || '', bairros:query.bairros || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '' },
    operations:query.operacoes || query.operacao || '', radius, bairroFoco:query.bairroFoco || '', corretorSelecionado:query.corretorSelecionado || '', top:parseTop(query.top)
  });
  return {
    meta:{ project:broker.manifest.project || 'Nexum', version:broker.manifest.version || null, generatedAt:broker.manifest.generated_at || null, source:'nexum_online_snapshot', totalOpportunities:broker.opportunities.length, analyticalOpportunities:broker.opportunities.filter(BrokerNetwork.isAnalyticalRecord).length, directoryEntries:broker.directory.length },
    ...analytics, timeSeries:operationTimeSeries(market), operationCounts:operationCounts(market),
    marketSummary:{ averageSale:mean(market.filter((item) => item.operacao_mercado === 'venda_ofertada').map((item) => item.valor_venda)), averageRent:mean(market.filter((item) => item.operacao_mercado === 'locacao_ofertada').map((item) => item.valor_locacao)), saleSupplyTicket:mean(market.filter((item) => item.operacao_mercado === 'venda_ofertada').map((item) => item.valor_venda || item.valor_orcamento_maximo)), saleDemandTicket:mean(market.filter((item) => item.operacao_mercado === 'compra_procurada').map((item) => item.valor_orcamento_maximo)), rentSupplyTicket:mean(market.filter((item) => item.operacao_mercado === 'locacao_ofertada').map((item) => item.valor_locacao)), rentDemandTicket:mean(market.filter((item) => item.operacao_mercado === 'locacao_procurada').map((item) => item.valor_orcamento_maximo)) }
  };
}

function referencesFrom(data, query) {
  const ids = values(query.empreendimentos);
  return ids.length ? (data.empreendimentos || []).filter((item) => ids.includes(String(item.id))) : [];
}
async function marketPressure(root, data, query = {}) {
  const broker = await brokerData(root), references = referencesFrom(data, query);
  const key = JSON.stringify({ v:broker.manifest.generated_at, q:query, r:references.map((item) => item.id) });
  if (pressureCache.has(key)) return pressureCache.get(key);
  const input = { records:broker.opportunities, query, neighborhoods:data.neighborhoods || [], enterprises:references, referenceEnterprises:references };
  const result = { meta:{ source:'nexum_online_snapshot', version:broker.manifest.version || null, generatedAt:broker.manifest.generated_at || null }, exact:calculateMarketPressure({ ...input, geoMode:'EXACT' }), influence:calculateMarketPressure({ ...input, geoMode:'INFLUENCE' }), history:String(query.includeHistory || '1') !== '0' ? { exact:pressureHistory({ ...input, geoMode:'EXACT' }), influence:pressureHistory({ ...input, geoMode:'INFLUENCE' }) } : { exact:[], influence:[] } };
  pressureCache.set(key, result); if (pressureCache.size > 24) pressureCache.delete(pressureCache.keys().next().value);
  return result;
}

async function marketPressureMap(root, data, query = {}) {
  const broker = await brokerData(root), neighborhoods = data.neighborhoods || [];
  const requested = String(query.geoMode || query.geo || 'both').toLowerCase();
  const key = JSON.stringify({ v:broker.manifest.generated_at, q:query, n:neighborhoods.map((item) => [item.id, item.latitude, item.longitude]) });
  if (pressureMapCache.has(key)) return pressureMapCache.get(key);
  const brokerMap = await brokerAnalytics(root, query);
  const neighborhoodByName = new Map(neighborhoods.map((item) => [BrokerNetwork.canonicalNeighborhood(item.nome), item]));
  const unsupported = values(query.caracteristicas).filter((item) => ['vaga_coberta', 'condominio_fechado'].includes(item));
  const exactRecords = filterBrokerRecords(broker.opportunities, { ...query, aplicarPeriodo:(query.de || query.ate) ? '1' : query.aplicarPeriodo });
  const influenceRecords = filterBrokerRecords(broker.opportunities, { ...query, bairro:'', bairros:'', aplicarPeriodo:(query.de || query.ate) ? '1' : query.aplicarPeriodo });
  const exactByNeighborhood = new Map();
  exactRecords.forEach((record) => { const name = BrokerNetwork.canonicalNeighborhood(record.bairro_normalizado || record.bairro_original); if (!exactByNeighborhood.has(name)) exactByNeighborhood.set(name, []); exactByNeighborhood.get(name).push(record); });
  const residual = { ...query, bairro:'', bairros:'', tipo:'', padrao:'', ticket:'', search:'', dormitorios:'', vagas:'', operacoes:'', operacao:'', aplicarPeriodo:'0', caracteristicas:unsupported.join(',') };
  const build = (item, geoMode) => {
    const neighborhood = neighborhoodByName.get(BrokerNetwork.canonicalNeighborhood(item.bairro)), exact = geoMode === 'EXACT';
    const reference = { id:`MAP-${item.bairroKey}`, bairro:item.bairro, neighborhoodId:neighborhood?.id || '', latitude:item.latitude, longitude:item.longitude };
    const result = calculateMarketPressure({ records:exact ? (exactByNeighborhood.get(item.bairroKey) || []) : influenceRecords, query:{ ...residual, bairro:exact ? item.bairro : '', bairroNome:exact ? item.bairro : '' }, geoMode, neighborhoods, enterprises:[reference], referenceEnterprises:[reference] });
    return { key:item.bairroKey, bairro:item.bairro, latitude:item.latitude, longitude:item.longitude, ...result };
  };
  const result = { meta:{ source:'nexum_online_snapshot', version:broker.manifest.version || null } };
  if (requested !== 'influence') result.exact = (brokerMap.bubbles || []).map((item) => build(item, 'EXACT'));
  if (requested !== 'exact') result.influence = (brokerMap.bubbles || []).map((item) => build(item, 'INFLUENCE'));
  pressureMapCache.set(key, result); if (pressureMapCache.size > 24) pressureMapCache.delete(pressureMapCache.keys().next().value);
  return result;
}

function radarAnalysis(data, query) {
  const rows = entriesOf(data, query).map((entry) => {
    const vso = entry.vso;
    const values = { vso, ivv:null, absorption:null, coverage:null, adjustment:null, iap:vso == null ? null : Math.max(0, Math.min(100, vso)) };
    return {
      id:entry.id, name:entry.nome, values, scores:Object.fromEntries(Object.keys(values).map((key) => [key, values[key] == null ? null : key === 'iap' ? values[key] : 50])),
      absorption:{ initialStock:entry.current.units, finalStock:entry.current.available, absorbedUnits:entry.current.sold, observedDays:null, from:null, to:null, reason:'A fotografia pública não recalcula o intervalo comercial.' },
      coverage:{ reason:'Sem ritmo de absorção calculado na fotografia pública.' }, adjustment:{ value:null, igpm:null, from:null, to:null, position:'unavailable', reason:'Índice econômico não é recalculado no ambiente online.' },
      iap:{ band:'Indisponível', missing:['ivv','absorption','coverage','adjustment'] }, price:{ peerIds:[] }, reduced:true
    };
  });
  const ranking = [...rows].sort((left, right) => Number(right.values.vso ?? -Infinity) - Number(left.values.vso ?? -Infinity)).map((row) => row.id);
  return { rows, rankings:{ vso:ranking, ivv:ranking, absorption:ranking, coverage:ranking, adjustment:ranking, iap:ranking }, methodology:'Leitura pública sobre dados consolidados; sem processamento local.', indexSource:{ warning:'Índices externos não são consultados no ambiente online.' } };
}

async function route({ method = 'GET', pathname, search = '', root }) {
  const query = new URLSearchParams(search), queryObject = Object.fromEntries(query.entries()), snapshotData = await snapshot(root), data = snapshotData.data || {};
  if (method !== 'GET') return { status:405, payload:{ error:'O ambiente online é somente leitura.' } };
  if (pathname === '/api/health') return { status:200, payload:{ ok:true, mode:'online-read-only' } };
  if (pathname === '/api/public-data') return { status:200, payload:snapshotData };
  if (pathname === '/api/empreendimentos') return { status:200, payload:entriesOf(data, query) };
  if (pathname === '/api/dominios') return { status:200, payload:{ economicStandards:(data.economicStandards || []).filter((item) => item.ativo !== false), neighborhoods:data.neighborhoods || [], propertyFeatures:data.propertyFeatureCatalog || [] } };
  if (pathname === '/api/bairros') return { status:200, payload:data.neighborhoods || [] };
  if (pathname === '/api/padroes-economicos') return { status:200, payload:(data.economicStandards || []).filter((item) => item.ativo !== false) };
  if (pathname === '/api/notificacoes') return { status:200, payload:{ items:[] } };
  if (pathname === '/api/user-favorites') return { status:200, payload:{ userId:'PUBLIC', favorites:[] } };
  if (pathname === '/api/portfolio-home' || pathname === '/api/analytics') return { status:200, payload:portfolio(data, query) };
  if (pathname === '/api/radar') return { status:200, payload:entriesOf(data, query) };
  if (pathname === '/api/radar-analysis') return { status:200, payload:radarAnalysis(data, query) };
  if (pathname === '/api/market-pressure') return { status:200, payload:await marketPressure(root, data, queryObject) };
  if (pathname === '/api/market-pressure-map') return { status:200, payload:await marketPressureMap(root, data, queryObject) };
  if (pathname === '/api/rede-corretores') return { status:200, payload:await brokerAnalytics(root, queryObject) };
  const analyticsMatch = pathname.match(/^\/api\/empreendimentos\/([^/]+)\/analytics$/);
  if (analyticsMatch) {
    const enterprise = (data.empreendimentos || []).find((item) => item.id === decodeURIComponent(analyticsMatch[1]));
    if (!enterprise) return { status:404, payload:{ error:'Empreendimento não encontrado.' } };
    const entry = entryOf(enterprise), base = portfolio({ ...data, empreendimentos:[enterprise] }, query);
    // Mantém uma resposta JSON útil para a navegação pública. A leitura de
    // comparação detalhada continua sendo calculada exclusivamente pela raiz.
    return { status:200, payload:{ ...base, empreendimento:entry, onlineNotice:'Detalhamento comparativo é consolidado no ambiente interno antes da próxima exportação.' } };
  }
  const match = pathname.match(/^\/api\/empreendimentos\/([^/]+)$/);
  if (match) {
    const enterprise = (data.empreendimentos || []).find((item) => item.id === decodeURIComponent(match[1]));
    return enterprise ? { status:200, payload:enterprise } : { status:404, payload:{ error:'Empreendimento não encontrado.' } };
  }
  return { status:404, payload:{ error:'Rota pública não disponível.' } };
}

module.exports = { route };
