const fs = require('node:fs/promises');
const path = require('node:path');
const BrokerNetwork = require('./broker-network');
const { calculateMarketPressure, pressureHistory } = require('./market-pressure');
const { loadCommittedData, ingestionVersion } = require('./rede-ingestion');

const ROOT = __dirname;
const BROKER_DATA_DIR = path.join(ROOT, 'dados', 'corretores');
const FILES = {
  manifest: path.join(BROKER_DATA_DIR, 'manifest.json'),
  opportunities: path.join(BROKER_DATA_DIR, 'opportunities.json'),
  directory: path.join(BROKER_DATA_DIR, 'sender_directory.json'),
  reviewTranscripts: path.join(BROKER_DATA_DIR, 'review-transcripts.json')
};
const CANONICAL_NEIGHBORHOOD_LOCATIONS = new Map(
  require('./engine/investlar/dictionaries/bairros_campina_grande.json')
    .map((item) => [BrokerNetwork.canonicalNeighborhood(item.bairro), item])
);

let cache = null;
let cacheCheckedAt = 0;
const CACHE_RECHECK_MS = 30000;
const pressureMapCache = new Map();
const pressureResultCache = new Map();

async function dataVersion() {
  const required = [FILES.manifest, FILES.opportunities, FILES.directory];
  const stats = await Promise.all(required.map((file) => fs.stat(file)));
  const transcript = await fs.stat(FILES.reviewTranscripts).catch(() => null);
  return `${stats.map((stat) => `${stat.size}:${stat.mtimeMs}`).join('|')}|${transcript ? `${transcript.size}:${transcript.mtimeMs}` : 'no-transcript'}|${await ingestionVersion()}`;
}

function validateData(manifest, opportunities, directory) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.json da Rede de Corretores é inválido.');
  if (!Array.isArray(opportunities)) throw new Error('opportunities.json da Rede de Corretores deve ser uma lista.');
  if (!Array.isArray(directory)) throw new Error('sender_directory.json da Rede de Corretores deve ser uma lista.');
  if (Number(manifest.total_opportunities || 0) && Number(manifest.total_opportunities) !== opportunities.length) throw new Error('O total de opportunities.json não corresponde ao manifest.json.');
  const directoryIds = new Set(directory.map((item) => String(item.sender_id || '')).filter(Boolean));
  const missingSender = opportunities.find((item) => item.sender_id && !directoryIds.has(String(item.sender_id)));
  if (missingSender) throw new Error(`sender_id sem correspondência no diretório: ${missingSender.sender_id}.`);
  const invalidPattern = opportunities.find((item) => item.padrao_economico && !BrokerNetwork.canonicalPattern(item.padrao_economico));
  if (invalidPattern) throw new Error(`Padrão econômico não reconhecido: ${invalidPattern.padrao_economico}.`);
}

function applyCanonicalNeighborhoodLocation(opportunity) {
  const location = CANONICAL_NEIGHBORHOOD_LOCATIONS.get(BrokerNetwork.canonicalNeighborhood(opportunity.bairro_normalizado || opportunity.bairro_original));
  if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return opportunity;
  return { ...opportunity, latitude:Number(location.latitude), longitude:Number(location.longitude) };
}

async function loadBrokerData() {
  if (cache && Date.now() - cacheCheckedAt < CACHE_RECHECK_MS) return cache;
  cacheCheckedAt = Date.now();
  let version;
  try {
    version = await dataVersion();
  } catch (error) {
    const unavailable = new Error(`Dados da Rede de Corretores indisponíveis: ${error.message}`);
    unavailable.status = 503;
    throw unavailable;
  }
  if (cache?.version === version) return cache;
  try {
    const [manifestText, opportunitiesText, directoryText, transcriptText] = await Promise.all([
      fs.readFile(FILES.manifest, 'utf8'),
      fs.readFile(FILES.opportunities, 'utf8'),
      fs.readFile(FILES.directory, 'utf8'),
      fs.readFile(FILES.reviewTranscripts, 'utf8').catch(() => '{"records":[]}')
    ]);
    const manifest = JSON.parse(manifestText);
    const baselineOpportunities = JSON.parse(opportunitiesText);
    const baselineDirectory = JSON.parse(directoryText);
    const baselineReviewTranscripts = JSON.parse(transcriptText).records || [];
    validateData(manifest, baselineOpportunities, baselineDirectory);
    const incremental = process.env.VERCEL
      ? { directoryUpdates: [], opportunities: [], reviewMessages: [], overrides: {} }
      : await loadCommittedData();
    const directoryById = new Map(baselineDirectory.map((item) => [String(item.sender_id), item]));
    incremental.directoryUpdates.forEach((item) => directoryById.set(String(item.sender_id), item));
    const directory = [...directoryById.values()];
    // A coordenada é propriedade do bairro, não da mensagem histórica. Assim, uma
    // correção territorial única reposiciona todo o histórico e as novas importações.
    const opportunities = [...baselineOpportunities, ...incremental.opportunities]
      .map((item) => ({ ...item, ...(incremental.overrides[item.id] || {}) }))
      .map(applyCanonicalNeighborhoodLocation);
    const combinedManifest = {
      ...manifest,
      generated_at: incremental.lastImport?.processedAt || manifest.generated_at,
      total_opportunities: opportunities.length,
      baseline_opportunities: baselineOpportunities.length,
      incremental_opportunities: incremental.opportunities.length,
      source: 'nexum_local_incremental'
    };
    validateData({ ...combinedManifest, total_opportunities:opportunities.length }, opportunities, directory);
    cache = { version, manifest:combinedManifest, opportunities, directory, reviewTranscripts:[...baselineReviewTranscripts, ...(incremental.reviewMessages || [])] };
    return cache;
  } catch (error) {
    const invalid = new Error(`Falha ao carregar a Rede de Corretores: ${error.message}`);
    invalid.status = 500;
    throw invalid;
  }
}

function parseTop(value) {
  if (String(value || '').toLowerCase() === 'all') return Infinity;
  const top = Number(value || 10);
  return [10, 20, 30, 50].includes(top) ? top : 10;
}

function operationTimeSeries(opportunities) {
  const operationKeys = Object.keys(BrokerNetwork.OPERATION_META).filter((key) => key !== 'indefinida');
  const periods = [...new Set(opportunities.map((item) => String(item.data_inicio || '').slice(0, 7)).filter((item) => /^\d{4}-\d{2}$/.test(item)))].sort();
  const latest = periods.at(-1);
  if (!latest) return { periods:[], series:[] };
  const [year, month] = latest.split('-').map(Number), end = new Date(Date.UTC(year, month - 1, 1)), start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 12);
  const visiblePeriods = periods.filter((period) => { const [itemYear,itemMonth] = period.split('-').map(Number), date = new Date(Date.UTC(itemYear,itemMonth - 1,1)); return date >= start && date <= end; });
  const counts = new Map(visiblePeriods.map((period) => [period, Object.fromEntries(operationKeys.map((key) => [key, 0]))]));
  opportunities.forEach((item) => { const period=String(item.data_inicio || '').slice(0,7), operation=item.operacao_mercado || 'indefinida'; if(counts.has(period) && Object.hasOwn(counts.get(period),operation)) counts.get(period)[operation] += 1; });
  const label = (period) => new Date(`${period}-02T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  return { periods:visiblePeriods.map((period) => ({ period, label:label(period) })), series:operationKeys.map((key) => ({ key, label:BrokerNetwork.operationMeta(key).label, color:BrokerNetwork.operationMeta(key).color, values:visiblePeriods.map((period) => counts.get(period)[key] || 0) })) };
}

function operationCounts(opportunities) {
  const keys = Object.keys(BrokerNetwork.OPERATION_META).filter((key) => key !== 'indefinida');
  return Object.fromEntries(keys.map((key) => [key, opportunities.filter((item) => item.operacao_mercado === key).length]));
}

function parseRadius(query) {
  const lat = Number(query.raioLat);
  const lng = Number(query.raioLng);
  const km = Number(query.raioKm);
  const zoom = Number(query.zoom || 12);
  if (![lat, lng, km, zoom].every(Number.isFinite) || km <= 0) return null;
  return { active: true, lat, lng, km, zoom };
}

function values(value) { return Array.isArray(value) ? value.filter(Boolean) : String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function isTrue(value) { return value === true || ['sim','true','1'].includes(String(value || '').toLowerCase()); }
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

function mean(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function filterBrokerRecords(records, query = {}) {
  const analytical = (records || []).filter(BrokerNetwork.isAnalyticalRecord).filter((item) => recordMatchesExtendedFilters(item, query));
  const shared = BrokerNetwork.applySharedFilters(analytical, { bairro:query.bairro || '', bairros:query.bairros || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '' });
  return BrokerNetwork.applyOperationFilter(shared, query.operacoes || query.operacao || '');
}

function reviewSummary(record) {
  const parts = [
    BrokerNetwork.operationMeta(record.operacao_mercado).label,
    record.tipo_imovel && record.tipo_imovel !== 'INDEFINIDO' ? record.tipo_imovel : '',
    record.bairro_normalizado || record.bairro_original || 'bairro não identificado'
  ].filter(Boolean);
  const value = [record.valor_venda, record.valor_locacao, record.valor_repasse_agio, record.valor_orcamento_maximo]
    .map(Number).find((item) => Number.isFinite(item) && item > 0);
  return `${parts.join(' · ')}${value ? ` · R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits:0 })}` : ''}`;
}

async function getBrokerReviewSamples(query = {}) {
  const data = await loadBrokerData();
  const terms = [...new Set([query.reviewSearch, query.search]
    .map((value) => String(value || '').trim().toLocaleLowerCase('pt-BR'))
    .filter(Boolean))];
  const directory = new Map(data.directory.map((item) => [String(item.sender_id || ''), item]));
  const transcripts = new Map((data.reviewTranscripts || []).map((item) => [String(item.opportunityId || ''), item]));
  // A busca global desta página também precisa alcançar o texto da conversa.
  // Os demais filtros continuam sendo aplicados normalmente pelo motor comum.
  const rows = filterBrokerRecords(data.opportunities, { ...query, search:'' }).filter((item) => item.status_extracao !== 'RUIDO').filter((item) => {
    if (!terms.length) return true;
    const sender = directory.get(String(item.sender_id || ''));
    const transcript = transcripts.get(String(item.id || ''));
    const searchable = [
      transcript?.sourceMessageMasked,
      reviewSummary(item),
      item.status_extracao,
      sender?.nome_exibicao || sender?.sender_name || sender?.nome_corretor,
      item.bairro_normalizado,
      item.bairro_original,
      item.tipo_imovel,
      item.operacao_mercado
    ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return terms.every((term) => searchable.includes(term));
  }).sort((left, right) => String(right.data_inicio || '').localeCompare(String(left.data_inicio || '')));
  const pageSize = Math.min(Math.max(Number(query.limit || 50), 1), 100);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Number(query.page || 1), 1), pageCount);
  const offset = (page - 1) * pageSize;
  return {
    total: rows.length,
    page,
    pageSize,
    pageCount,
    baselineTextStored: false,
    samples: rows.slice(offset, offset + pageSize).map((item) => {
      const sender = directory.get(String(item.sender_id || ''));
      const transcript = transcripts.get(String(item.id || ''));
      return {
        id: `baseline-${item.id}`,
        opportunityId: item.id,
        sender: sender?.nome_exibicao || sender?.sender_name || item.sender_id || 'Remetente não identificado',
        occurredAt: item.data_inicio,
        operationLabel: BrokerNetwork.operationMeta(item.operacao_mercado).label,
        territoryLabel: [item.bairro_normalizado || item.bairro_original || 'Indefinido', item.tipo_imovel && item.tipo_imovel !== 'INDEFINIDO' ? item.tipo_imovel : ''].filter(Boolean).join(' · '),
        extractionStatus: item.status_extracao || 'PARCIAL',
        candidateName: item.bairro_normalizado || item.bairro_original || '',
        sourceMessageMasked: transcript?.sourceMessageMasked || reviewSummary(item),
        historical: true
      };
    })
  };
}

async function getBrokerAnalytics(query = {}) {
  const data = await loadBrokerData();
  const analytical = data.opportunities.filter(BrokerNetwork.isAnalyticalRecord).filter((item) => recordMatchesExtendedFilters(item, query));
  const sharedScope = BrokerNetwork.applySharedFilters(analytical, { bairro:query.bairro || '', bairros:query.bairros || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '' });
  const scopedRecords = BrokerNetwork.applyOperationFilter(sharedScope, query.operacoes || query.operacao || '');
  const radius = parseRadius(query);
  const radiusBubbles = BrokerNetwork.aggregateBubbles(scopedRecords, scopedRecords.length);
  const radiusNeighborhoods = BrokerNetwork.radiusNeighborhoods(radiusBubbles, radius, scopedRecords.length);
  const territorialRecords = radius
    ? scopedRecords.filter((item) => radiusNeighborhoods.has(BrokerNetwork.canonicalNeighborhood(item.bairro_normalizado)))
    : scopedRecords;
  const focusedNeighborhood = BrokerNetwork.canonicalNeighborhood(query.bairroFoco || '');
  const marketRecords = focusedNeighborhood
    ? territorialRecords.filter((item) => BrokerNetwork.canonicalNeighborhood(item.bairro_normalizado) === focusedNeighborhood)
    : territorialRecords;
  const analytics = BrokerNetwork.buildAnalytics(analytical, data.directory, {
    filters: {
      bairro: query.bairro || '',
      bairros: query.bairros || '',
      tipo: query.tipo || '',
      padrao: query.padrao || '',
      ticket: query.ticket || ''
    },
    operations: query.operacoes || query.operacao || '',
    radius,
    bairroFoco: query.bairroFoco || '',
    corretorSelecionado: query.corretorSelecionado || '',
    top: parseTop(query.top)
  });
  return {
    meta: {
      project: data.manifest.project || 'Investlar Market Intelligence',
      version: data.manifest.version || null,
      rulesetVersion: data.manifest.extractor_version || null,
      generatedAt: data.manifest.generated_at || null,
      source: data.manifest.source || null,
      sourceFile: data.manifest.source_file || null,
      sourceHash: data.manifest.source_hash || null,
      totalOpportunities: data.opportunities.length,
      analyticalOpportunities: data.opportunities.filter(BrokerNetwork.isAnalyticalRecord).length,
      directoryEntries: data.directory.length
    },
    ...analytics,
    timeSeries: operationTimeSeries(marketRecords),
    operationCounts: operationCounts(marketRecords),
    marketSummary: {
      averageSale: mean(marketRecords.filter((item) => item.operacao_mercado === 'venda_ofertada').map((item) => item.valor_venda)),
      averageRent: mean(marketRecords.filter((item) => item.operacao_mercado === 'locacao_ofertada').map((item) => item.valor_locacao)),
      saleSupplyTicket: mean(marketRecords.filter((item) => item.operacao_mercado === 'venda_ofertada').map((item) => item.valor_venda || item.valor_orcamento_maximo)),
      saleDemandTicket: mean(marketRecords.filter((item) => item.operacao_mercado === 'compra_procurada').map((item) => item.valor_orcamento_maximo)),
      rentSupplyTicket: mean(marketRecords.filter((item) => item.operacao_mercado === 'locacao_ofertada').map((item) => item.valor_locacao)),
      rentDemandTicket: mean(marketRecords.filter((item) => item.operacao_mercado === 'locacao_procurada').map((item) => item.valor_orcamento_maximo))
    }
  };
}

async function getMarketPressure(query = {}, context = {}) {
  const data = await loadBrokerData();
  const references = context.referenceEnterprises || [];
  const pressureConfig = context.config || undefined;
  const cacheKey = JSON.stringify({
    dataVersion:data.version,
    query:Object.fromEntries(Object.entries(query).sort(([left],[right]) => left.localeCompare(right))),
    references:references.map((item) => [item.id,item.latitude,item.longitude,item.neighborhoodId,item.bairro]),
    neighborhoods:(context.neighborhoods || []).map((item) => [item.id,item.latitude,item.longitude,item.updated_at || item.updatedAt || '']),
    influenceBands:pressureConfig?.influenceBands || null
  });
  if (pressureResultCache.has(cacheKey)) return pressureResultCache.get(cacheKey);
  const input = {
    records: data.opportunities,
    query,
    neighborhoods: context.neighborhoods || [],
    enterprises: context.enterprises || [],
    referenceEnterprises: context.referenceEnterprises || [],
    ...(pressureConfig ? { config:pressureConfig } : {})
  };
  const exact = calculateMarketPressure({ ...input, geoMode:'EXACT' });
  const influence = calculateMarketPressure({ ...input, geoMode:'INFLUENCE' });
  const includeHistory = String(query.includeHistory || '1') !== '0';
  const result = {
    meta: { source:data.manifest.source || null, version:data.manifest.version || null, generatedAt:data.manifest.generated_at || null },
    exact,
    influence,
    history: includeHistory ? { exact:pressureHistory({ ...input, geoMode:'EXACT' }), influence:pressureHistory({ ...input, geoMode:'INFLUENCE' }) } : { exact:[], influence:[] }
  };
  pressureResultCache.set(cacheKey,result);
  if (pressureResultCache.size > 24) pressureResultCache.delete(pressureResultCache.keys().next().value);
  return result;
}

async function getMarketPressureMap(query = {}, context = {}) {
  const data = await loadBrokerData();
  const neighborhoods = context.neighborhoods || [];
  const requestedGeoMode = String(query.geoMode || query.geo || 'both').toLowerCase();
  const neighborhoodVersion = neighborhoods.map((item) => `${item.id}:${item.latitude ?? ''}:${item.longitude ?? ''}:${item.updated_at || item.updatedAt || ''}`).sort().join('|');
  const cacheKey = JSON.stringify({ dataVersion:data.version, query:Object.fromEntries(Object.entries(query).sort(([left],[right]) => left.localeCompare(right))), neighborhoodVersion });
  if (pressureMapCache.has(cacheKey)) return pressureMapCache.get(cacheKey);
  const neighborhoodByName = new Map(neighborhoods.map((item) => [BrokerNetwork.canonicalNeighborhood(item.nome), item]));
  const brokerMap = await getBrokerAnalytics(query);
  const unsupported = values(query.caracteristicas).filter((item) => ['vaga_coberta','condominio_fechado'].includes(item));
  const exactRecords = filterBrokerRecords(data.opportunities, { ...query, aplicarPeriodo:(query.de || query.ate) ? '1' : query.aplicarPeriodo });
  const influenceRecords = filterBrokerRecords(data.opportunities, { ...query, bairro:'', bairros:'', aplicarPeriodo:(query.de || query.ate) ? '1' : query.aplicarPeriodo });
  const exactByNeighborhood = new Map();
  exactRecords.forEach((record) => {
    const key = BrokerNetwork.canonicalNeighborhood(record.bairro_normalizado || record.bairro_original);
    if (!exactByNeighborhood.has(key)) exactByNeighborhood.set(key, []);
    exactByNeighborhood.get(key).push(record);
  });
  const residualQuery = { ...query, bairro:'', bairros:'', tipo:'', padrao:'', ticket:'', search:'', dormitorios:'', vagas:'', operacoes:'', operacao:'', aplicarPeriodo:'0', caracteristicas:unsupported.join(',') };
  const build = (item, geoMode) => {
    const neighborhood = neighborhoodByName.get(BrokerNetwork.canonicalNeighborhood(item.bairro));
    const exact = geoMode === 'EXACT';
    const pressureQuery = { ...residualQuery, bairro:exact ? item.bairro : '', bairroNome:exact ? item.bairro : '' };
    const reference = { id:`MAP-${item.bairroKey}`, bairro:item.bairro, neighborhoodId:neighborhood?.id || '', latitude:item.latitude, longitude:item.longitude };
    const records = exact ? (exactByNeighborhood.get(item.bairroKey) || []) : influenceRecords;
    const result = calculateMarketPressure({ records, query:pressureQuery, geoMode, neighborhoods, enterprises:[reference], referenceEnterprises:[reference] });
    return { key:item.bairroKey, bairro:item.bairro, latitude:item.latitude, longitude:item.longitude, ...result };
  };
  const result = { meta:{ source:data.manifest.source || null, version:data.manifest.version || null } };
  if (requestedGeoMode !== 'influence') result.exact = (brokerMap.bubbles || []).map((item) => build(item, 'EXACT'));
  if (requestedGeoMode !== 'exact') result.influence = (brokerMap.bubbles || []).map((item) => build(item, 'INFLUENCE'));
  pressureMapCache.set(cacheKey, result);
  if (pressureMapCache.size > 24) pressureMapCache.delete(pressureMapCache.keys().next().value);
  return result;
}

function clearBrokerDataCache() {
  cache = null;
  cacheCheckedAt = 0;
  pressureMapCache.clear();
  pressureResultCache.clear();
}

module.exports = { FILES, validateData, loadBrokerData, filterBrokerRecords, getBrokerReviewSamples, getBrokerAnalytics, getMarketPressure, getMarketPressureMap, clearBrokerDataCache };
