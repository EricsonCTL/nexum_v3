const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getBrokerAnalytics, getMarketPressure, getMarketPressureMap, loadBrokerData, filterBrokerRecords, getBrokerReviewSamples, clearBrokerDataCache } = require('./broker-data');
const { PRESSURE_CONFIG, validCoordinates, polygonDistanceKm } = require('./market-pressure');
const BrokerNetwork = require('./broker-network');
const RadarAnalysis = require('./radar-analysis');
const { buildEditorialReading, buildSurfaceNarratives, EDITORIAL_WEIGHTS } = require('./editorial-engine');
const { getIgpm, getMarketIndices } = require('./igpm-service');
const { getReference } = require('./reajuste-service');
if (require.main === module) require('./reajuste-service').startReferenceUpdates();
const { exportOnline } = require('./lib/online-export');
const {
  ensureIngestionStorage, prepareImport, processImport, getIngestionStatus,
  listReviews, resolveReview
} = require('./rede-ingestion');

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const TERM_DICTIONARY_FILE = path.join(ROOT, 'tb apoio', 'dicionario_termos_tabelas_imobiliarias.csv');
const DEFAULT_DATA_FILE = path.join(ROOT, 'data', 'nexo-radar.json');
const DATA_FILE = process.env.NEXO_DATA_FILE ? path.resolve(process.env.NEXO_DATA_FILE) : DEFAULT_DATA_FILE;
const DATA_DIR = path.dirname(DATA_FILE);
// Execuções isoladas (por exemplo, a suíte de testes) não podem substituir a
// fotografia de produção. Um arquivo de dados alternativo só exporta se o
// destino for declarado de forma explícita.
const ONLINE_DESTINATION = process.env.NEXUM_ONLINE_DIR
  ? path.resolve(process.env.NEXUM_ONLINE_DIR)
  : DATA_FILE === DEFAULT_DATA_FILE ? path.join(ROOT, 'Nexum') : null;
const PDF_DIRS = ['entrada', 'processando', 'cadastrados', 'erro', 'excluidos'].map((name) => path.join(ROOT, 'pdf', name));
const PDF_TRANSACTION_DIR = path.join(ROOT, 'pdf', '.txn');
const MANAGEMENT_PDF_INPUT_DIR = path.join(ROOT, 'PDF Entrada');
const MANAGEMENT_PDF_ARCHIVE_DIR = path.join(ROOT, 'PDF cadastrados');
const MANAGEMENT_JSON_INPUT_DIR = path.join(ROOT, 'JSON Entrada');
const MANAGEMENT_JSON_ARCHIVE_DIR = path.join(ROOT, 'JSON cadastrados');
const MANAGED_DOCUMENT_ROOTS = [path.join(ROOT, 'pdf'), MANAGEMENT_PDF_INPUT_DIR, MANAGEMENT_PDF_ARCHIVE_DIR, MANAGEMENT_JSON_INPUT_DIR, MANAGEMENT_JSON_ARCHIVE_DIR];
const ENTERPRISE_IMAGE_DIR = path.join(ROOT, 'img_empreendimentos');
const EMBEDDED_NEIGHBORHOODS_FILE = path.join(ROOT, 'engine', 'investlar', 'dictionaries', 'bairros_campina_grande.json');
const DEFAULT_ENTERPRISE_IMAGES = {
  'LETS BELA VISTA - INC': 'img_empreendimentos/LETS BELA VISTA - INC.png',
  'ZuHaus Club Residence': 'img_empreendimentos/ZuHaus Club Residence.jpg'
};
// A aplicação local é acessada pelo endereço padrão do usuário.
const PORT = Number(process.env.PORT || 3000);
let geographicEnrichmentQueue = Promise.resolve();
const geographicEnrichmentScheduled = new Set();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

// O CSV é a fonte externa e imutável das equivalências publicadas. A pesquisa
// é sempre exata após uma normalização exclusivamente técnica do texto.
function normalizeTableTermText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/²/g, '2').replace(/[–—−_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function parseCsvRecord(line) {
  const values = []; let current = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(current); current = ''; }
    else current += character;
  }
  values.push(current); return values.map((value) => value.trim());
}
function loadTableTermDictionary() {
  if (!fsSync.existsSync(TERM_DICTIONARY_FILE)) throw new Error(`Dicionário de termos não encontrado: ${TERM_DICTIONARY_FILE}`);
  const lines = fsSync.readFileSync(TERM_DICTIONARY_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvRecord(lines.shift() || '').map(normalizeTableTermText);
  const required = ['termo origem', 'termo normalizado', 'categoria'];
  if (!required.every((column) => header.includes(column))) throw new Error('O dicionário de termos deve conter: termo_origem, termo_normalizado e categoria.');
  const positions = Object.fromEntries(header.map((column, index) => [column, index])); const index = new Map();
  for (const line of lines) {
    const row = parseCsvRecord(line); const origem = String(row[positions['termo origem']] || '').trim(); const normalizado = String(row[positions['termo normalizado']] || '').trim(); const categoria = String(row[positions.categoria] || '').trim();
    const key = normalizeTableTermText(origem); if (!key || !normalizado || !categoria) throw new Error(`Linha inválida no dicionário de termos: ${line}`);
    const prior = index.get(key);
    if (prior && (prior.termoNormalizado !== normalizado || prior.categoria !== categoria)) throw new Error(`Termo duplicado conflitante no dicionário de termos: ${origem}`);
    if (!prior) index.set(key, { termoOriginal: origem, termoNormalizado: normalizado, categoria });
  }
  return { arquivo: TERM_DICTIONARY_FILE, index, quantidade: index.size };
}
const CANONICAL_TABLE_TERMS = new Map([
  ['valor', { categoria: 'preco_valor', campoPadrao: 'VALOR_UNIDADE' }], ['valor_avaliacao', { categoria: 'preco_valor', campoPadrao: 'VALOR_AVALIACAO' }], ['valor_m2', { categoria: 'preco_valor', campoPadrao: 'VALOR_M2' }],
  ['entrada', { categoria: 'entrada', campoPadrao: 'ENTRADA' }], ['ato', { categoria: 'entrada', campoPadrao: 'ATO' }], ['parcela_inicial', { categoria: 'entrada', campoPadrao: 'PARCELA_INICIAL' }],
  ['parcelas_mensais', { categoria: 'parcelamento', campoPadrao: 'PARCELAS_MENSAIS' }], ['intercalada', { categoria: 'parcelamento', campoPadrao: 'INTERCALADAS' }], ['intercalada_anual', { categoria: 'parcelamento', campoPadrao: 'INTERCALADA_ANUAL' }], ['intercalada_semestral', { categoria: 'parcelamento', campoPadrao: 'INTERCALADA_SEMESTRAL' }],
  ['entrega_chaves', { categoria: 'evento', campoPadrao: 'ENTREGA_CHAVES' }], ['pos_chaves', { categoria: 'pos_entrega', campoPadrao: 'POS_CHAVES' }], ['pos_entrega', { categoria: 'pos_entrega', campoPadrao: 'POS_ENTREGA' }], ['financiamento', { categoria: 'financiamento', campoPadrao: 'FINANCIAMENTO' }], ['financiamento_direto', { categoria: 'financiamento', campoPadrao: 'FINANCIAMENTO_DIRETO' }],
  ['quadra', { categoria: 'estrutura', campoPadrao: 'QUADRA' }], ['situacao', { categoria: 'estrutura', campoPadrao: 'SITUACAO_COMERCIAL' }], ['status', { categoria: 'estrutura', campoPadrao: 'SITUACAO_COMERCIAL' }], ['lote', { categoria: 'estrutura', campoPadrao: 'UNIDADE' }], ['unidade', { categoria: 'estrutura', campoPadrao: 'UNIDADE' }], ['imovel', { categoria: 'estrutura', campoPadrao: 'UNIDADE' }], ['area_privativa', { categoria: 'estrutura', campoPadrao: 'AREA_PRIVATIVA' }], ['m2', { categoria: 'estrutura', campoPadrao: 'AREA_PRIVATIVA' }], ['posicao', { categoria: 'estrutura', campoPadrao: 'POSICAO' }], ['vagas', { categoria: 'estrutura', campoPadrao: 'VAGAS' }], ['investimento', { categoria: 'preco_valor', campoPadrao: 'VALOR_UNIDADE' }], ['sinal 10%', { categoria: 'entrada', campoPadrao: 'ENTRADA' }], ['2x', { categoria: 'parcelamento', campoPadrao: 'INTERCALADAS' }], ['mensais 15%', { categoria: 'parcelamento', campoPadrao: 'PARCELAS_MENSAIS' }], ['21x', { categoria: 'parcelamento', campoPadrao: 'PARCELAS_MENSAIS' }], ['interc. semestrais 5%', { categoria: 'parcelamento', campoPadrao: 'INTERCALADA_SEMESTRAL' }], ['3x', { categoria: 'parcelamento', campoPadrao: 'INTERCALADAS' }], ['saldo banco', { categoria: 'financiamento', campoPadrao: 'FINANCIAMENTO' }], ['parc. movel', { categoria: 'financiamento', campoPadrao: 'FINANCIAMENTO' }]
].map(([termoNormalizado, detail]) => [normalizeTableTermText(termoNormalizado), { ...detail, termoNormalizado }]));
const TABLE_TERM_DICTIONARY = loadTableTermDictionary();
function resolveTableTerm(term, manualEntries = []) {
  const termoOriginal = String(term ?? ''); const termoTecnico = normalizeTableTermText(termoOriginal);
  const fromCsv = TABLE_TERM_DICTIONARY.index.get(termoTecnico);
  if (fromCsv) return { termoOriginal, termoNormalizado: fromCsv.termoNormalizado, categoria: fromCsv.categoria, encontradoNoDicionario: true, origemResolucao: 'csv', termoTecnico };
  const fromManual = (manualEntries || []).find((entry) => normalizeTableTermText(entry.termoOrigem) === termoTecnico);
  if (fromManual?.decisao === 'nao_vincular') return { termoOriginal, termoNormalizado: null, categoria: 'ignorado', encontradoNoDicionario: true, ignorado: true, origemResolucao: 'nao_vincular', termoTecnico };
  if (fromManual) return { termoOriginal, termoNormalizado: fromManual.termoNormalizado, categoria: fromManual.categoria || CANONICAL_TABLE_TERMS.get(normalizeTableTermText(fromManual.termoNormalizado))?.categoria || 'outro', encontradoNoDicionario: true, origemResolucao: fromManual.decisao === 'novo_padrao' ? 'novo_padrao' : 'dicionario_manual', termoTecnico };
  const canonical = CANONICAL_TABLE_TERMS.get(termoTecnico);
  if (canonical) return { termoOriginal, termoNormalizado: canonical.termoNormalizado, categoria: canonical.categoria, campoPadrao: canonical.campoPadrao, encontradoNoDicionario: true, origemResolucao: 'canonico', termoTecnico };
  return { termoOriginal, termoNormalizado: termoOriginal, categoria: 'nao_mapeado', encontradoNoDicionario: false, origemResolucao: 'nao_mapeado', termoTecnico };
}
function canonicalTableTermOptions(data = {}) {
  const base = [...CANONICAL_TABLE_TERMS.values()].map((detail) => ({ termoNormalizado: detail.termoNormalizado, nome:detail.termoNormalizado.replaceAll('_', ' '), categoria: detail.categoria, campoPadrao: detail.campoPadrao, origem:'nativo' }));
  const custom = (data.termosCanonicosManuais || []).map((detail) => ({ termoNormalizado:detail.termoNormalizado, nome:detail.nome || String(detail.termoNormalizado || '').replaceAll('_', ' '), categoria:detail.categoria || 'outro', tipoDado:detail.tipoDado || '', unidade:detail.unidade || '', origem:'manual' }));
  return [...new Map([...base, ...custom].filter((item) => item.termoNormalizado).map((item) => [normalizeTableTermText(item.termoNormalizado), item])).values()].sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'));
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await Promise.all([...PDF_DIRS, PDF_TRANSACTION_DIR, ENTERPRISE_IMAGE_DIR, MANAGEMENT_PDF_INPUT_DIR, MANAGEMENT_PDF_ARCHIVE_DIR, MANAGEMENT_JSON_INPUT_DIR, MANAGEMENT_JSON_ARCHIVE_DIR].map((dir) => fs.mkdir(dir, { recursive: true })));
  try { await fs.access(DATA_FILE); } catch (_) {
    await writeData({ version: 1, sequences: { empreendimento: 0, tabela: 0, unidade: 0 }, empreendimentos: [], dicionario: [], logs: [] });
  }
  // A migração é idempotente: preserva documentos comerciais e materializa o
  // Cadastro Central nas bases antigas antes da aplicação ser disponibilizada.
  const normalized = await readData(); await writeData(normalized);
  await ensureIngestionStorage();
  await initializeIvvCurveStore();
  (normalized.neighborhoods || []).filter((item) => item.geographic_status !== 'resolved').forEach((item) => scheduleNeighborhoodEnrichment(item.id));
}

let dataFileCache = null;
let dataFileCacheMtime = 0;
let dataFileCacheCheckedAt = 0;
const DATA_FILE_CACHE_RECHECK_MS = 5000;
async function readData() {
  if (dataFileCache && Date.now() - dataFileCacheCheckedAt < DATA_FILE_CACHE_RECHECK_MS) return dataFileCache;
  const stat = await fs.stat(DATA_FILE);
  dataFileCacheCheckedAt = Date.now();
  if (dataFileCache && stat.mtimeMs === dataFileCacheMtime) return dataFileCache;
  dataFileCache = normalizeDataModel(JSON.parse(await fs.readFile(DATA_FILE, 'utf8')));
  dataFileCacheMtime = stat.mtimeMs;
  return dataFileCache;
}
async function writeData(data) {
  const temporary = path.join(DATA_DIR, `.${path.basename(DATA_FILE)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try { await fs.rename(temporary, DATA_FILE); } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
  const stat = await fs.stat(DATA_FILE);
  dataFileCache = data; dataFileCacheMtime = stat.mtimeMs; dataFileCacheCheckedAt = Date.now();
  // Todas as mutações que chegam à base consolidada passam por aqui. Assim a
  // cópia online é atualizada no mesmo fluxo, sem duplicar o motor interno.
  if (ONLINE_DESTINATION) {
    try { await exportOnline({ root:ROOT, data, destination:ONLINE_DESTINATION }); }
    catch (error) { console.error(`[NEXUM] Estado local salvo; projeção online pendente: ${error.message}`); }
  }
}
function now() { return new Date().toISOString(); }
function nextId(data, entity, prefix) { data.sequences[entity] = (data.sequences[entity] || 0) + 1; return `${prefix}-${String(data.sequences[entity]).padStart(6, '0')}`; }
function canonicalTableType(value) {
  const input = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (['PADRAO', 'A_VISTA', 'FINANCIAMENTO_CEF', 'FINANCIAMENTO_BANCARIO', 'DIRETO_CONSTRUTORA', 'OUTRO'].includes(input)) return input;
  if (/VISTA|\bAV\b/.test(input)) return 'A_VISTA';
  if (/CAIXA|\bCEF\b/.test(input)) return 'FINANCIAMENTO_CEF';
  if (/BANCAR|FINANCIAMENTO BANC/.test(input)) return 'FINANCIAMENTO_BANCARIO';
  if (/DIRETO|CONSTRUTORA/.test(input)) return 'DIRETO_CONSTRUTORA';
  return 'PADRAO';
}
function excludedTableTombstone(table, details = {}) {
  const document = table?.documento || table?.documentoReferencia || null;
  return {
    id: table?.id || details.id || crypto.randomUUID(),
    name: table?.name || details.name || 'Tabela excluída',
    tipoTabela: table?.tipoTabela || details.tipoTabela || 'PADRAO',
    tipoTabelaLabel: table?.tipoTabelaLabel || details.tipoTabelaLabel || TABLE_TYPE_LABELS[table?.tipoTabela] || 'Tabela excluída',
    validityDate: table?.validityDate || details.validityDate || null,
    unidadeCount: Number(table?.unidadeCount ?? table?.unidades?.length ?? details.unidadeCount ?? 0),
    documentoHash: table?.documentoHash || document?.hash || details.documentoHash || null,
    origem: typeof table?.origem === 'string' ? table.origem : table?.origem?.tipo || details.origem || null,
    deletedAt: table?.deletedAt || details.deletedAt || now(),
    deletedReason: table?.deletedReason || details.deletedReason || null,
    deletedBy: table?.deletedBy || details.deletedBy || null
  };
}
function compactDeletedTableTombstones(entries = []) {
  const compact = new Map();
  for (const entry of entries || []) {
    const tombstone = excludedTableTombstone(entry);
    compact.set(tombstone.id, tombstone);
  }
  return [...compact.values()].sort((a, b) => String(a.deletedAt || '').localeCompare(String(b.deletedAt || '')) || String(a.id).localeCompare(String(b.id)));
}
const TABLE_TYPE_LABELS = { PADRAO: 'Tabela geral / não informado', A_VISTA: 'À vista', FINANCIAMENTO_CEF: 'Financiamento Caixa / CEF', DIRETO_CONSTRUTORA: 'Direto com a construtora', FINANCIAMENTO_BANCARIO: 'Financiamento bancário', OUTRO: 'Outra modalidade' };
// Ausência e reserva são fotografias comerciais, não prova de venda. Ambas
// permanecem rastreáveis para revisão; somente venda publicada ou confirmada
// pelo operador integra IVV, VSO e vendas consolidadas.
const UNIT_STATUSES = ['Disponível', 'Vendida', 'Bloqueada', 'Reservada', 'Novo', 'Indisponível', 'Retirada', 'Ausente', 'Não identificado'];
// Domínios mestres: o cadastro, os filtros e as leituras analíticas consomem
// estes registros. As constantes apenas semeiam a fonte inicial do Investlar.
const ECONOMIC_STANDARD_SEED = [
  ['popular_mcmv', 'Popular/MCMV', 10], ['medio', 'Médio', 20], ['alto', 'Alto', 30],
  ['luxo', 'Luxo', 40], ['nao_aplicavel', 'Não aplicável', 90], ['indefinido', 'Indefinido', 99]
].map(([slug, nome, ordem]) => ({ id:`PDE-${slug}`, slug, nome, ordem, ativo:true, origem:'Investlar' }));
const PROPERTY_FEATURE_CATALOG_SEED = [
  { id:'dormitorios', categoria:'dormitorios', nome:'Dormitórios', tipo:'multivalorado', opcoes:[{id:'1',nome:'1 quarto'},{id:'2',nome:'2 quartos'},{id:'3',nome:'3 quartos'},{id:'4',nome:'4 quartos'},{id:'5_mais',nome:'5+ quartos'}] },
  { id:'suite', categoria:'caracteristicas', nome:'Suíte', tipo:'triestado' },
  { id:'area_lazer', categoria:'caracteristicas', nome:'Área de lazer', tipo:'triestado' },
  { id:'piscina', categoria:'caracteristicas', nome:'Piscina', tipo:'triestado' },
  { id:'mobiliado', categoria:'caracteristicas', nome:'Mobiliado', tipo:'triestado' },
  { id:'financiavel', categoria:'caracteristicas', nome:'Financiável', tipo:'triestado' },
  { id:'condominio_fechado', categoria:'caracteristicas', nome:'Condomínio fechado', tipo:'triestado' },
  { id:'vagas', categoria:'vagas', nome:'Vagas', tipo:'multivalorado_condicional', opcoes:[{id:'1',nome:'1 vaga'},{id:'2',nome:'2 vagas'},{id:'3',nome:'3 vagas'},{id:'4_mais',nome:'4+ vagas'}] },
  { id:'vaga_coberta', categoria:'vagas', nome:'Vaga coberta', tipo:'triestado' }
];
const ENTERPRISE_PHASES = ['Lançamento', 'Novo', 'Em obras', 'Entregue'];
const CONSTRUCTION_STATUSES = ['EM_OBRAS', 'OBRA_AVANCADA', 'OBRA_CONCLUIDA', 'ENTREGUE'];
function normalizeDomainText(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function domainSlug(value) { return normalizeDomainText(value).replace(/\s+/g, '_'); }
function canonicalEconomicStandardSlug(value) {
  const key = normalizeDomainText(value).replace(/\s+/g, '_');
  const aliases = { popular:'popular_mcmv', mcmv:'popular_mcmv', minha_casa_minha_vida:'popular_mcmv', popular_mcmv:'popular_mcmv', medio:'medio', alto:'alto', alto_padrao:'alto', luxo:'luxo', nao_aplicavel:'nao_aplicavel', outro:'indefinido', indefinido:'indefinido' };
  return aliases[key] || 'indefinido';
}
function normalizeTriState(value) { const key = normalizeDomainText(value); return ['sim','true','1'].includes(key) || value === true ? 'sim' : ['nao','false','0'].includes(key) || value === false ? 'nao' : 'nao_informado'; }
function normalizeMultiValue(value, allowed) { const values = Array.isArray(value) ? value : String(value || '').split(','); return [...new Set(values.map((item) => String(item).trim()).filter((item) => allowed.includes(item)))]; }
function normalizeEnterpriseCharacteristics(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const bedroomSource = source.dormitorios ?? source.bedrooms ?? source.quartos;
  const dormitorios = normalizeMultiValue(Number.isFinite(Number(bedroomSource)) ? String(bedroomSource) : bedroomSource, ['1','2','3','4','5_mais']);
  const atributosSource = source.atributos || source.attributes || source;
  const financingEvidence = atributosSource.financiamento ?? source.financiamento;
  const atributos = Object.fromEntries(['suite','area_lazer','piscina','mobiliado','financiavel','condominio_fechado','vaga_coberta'].map((key) => {
    const aliases = { suite:['suite','suites','suítes'], area_lazer:['area_lazer','área_lazer','lazer'], financiavel:['financiavel','financiável','financiamento'] };
    const candidate = (aliases[key] || [key]).map((alias) => atributosSource[alias] ?? source[alias]).find((item) => item !== undefined && item !== null);
    if (key === 'financiavel' && candidate === financingEvidence && typeof candidate === 'string' && candidate.trim()) return [key, 'sim'];
    return [key, normalizeTriState(candidate)];
  }));
  const vagasSource = source.vagas || source.parking || {};
  const parkingText = typeof vagasSource === 'string' ? vagasSource : '';
  const inferredParking = parkingText.match(/\b([1-4])\s+vaga/i)?.[1] || null;
  const quantidades = normalizeMultiValue(vagasSource.quantidades || vagasSource.spaces || inferredParking, ['1','2','3','4_mais']);
  const possui = normalizeTriState(vagasSource.possui ?? vagasSource.hasParking ?? (quantidades.length ? 'sim' : undefined));
  return { dormitorios, atributos, vagas:{ possui, quantidades: possui === 'sim' ? quantidades : [] } };
}
function neighborhoodKey(nome, cidade, uf) { return `${normalizeDomainText(nome)}|${normalizeDomainText(cidade)}|${String(uf || '').trim().toUpperCase()}`; }
function makeNeighborhoodId(nome, cidade, uf) { return `BAI-${domainSlug(nome)}-${domainSlug(cidade || 'sem_cidade')}-${String(uf || 'XX').toUpperCase()}`.slice(0, 120); }
function geographicDefaults(neighborhood = {}) {
  return {
    latitude: validCoordinates(neighborhood.latitude, neighborhood.longitude) ? Number(neighborhood.latitude) : null,
    longitude: validCoordinates(neighborhood.latitude, neighborhood.longitude) ? Number(neighborhood.longitude) : null,
    geometry: neighborhood.geometry || null,
    geographic_source: neighborhood.geographic_source || null,
    geographic_external_id: neighborhood.geographic_external_id || null,
    geographic_precision: neighborhood.geographic_precision || 'pending',
    geographic_updated_at: neighborhood.geographic_updated_at || null,
    geographic_status: neighborhood.geographic_status || 'pending'
  };
}
function centroidFromGeometry(geometry) {
  const source = typeof geometry === 'string' ? (() => { try { return JSON.parse(geometry); } catch (_) { return null; } })() : geometry;
  const root = source?.type === 'Feature' ? source.geometry : source; const coordinates = root?.type === 'Polygon' ? root.coordinates?.flat() : root?.type === 'MultiPolygon' ? root.coordinates?.flat(2) : [];
  const valid = coordinates.filter((coordinate) => Array.isArray(coordinate) && validCoordinates(coordinate[1], coordinate[0]));
  if (!valid.length) return null;
  return { latitude:valid.reduce((total, coordinate) => total + Number(coordinate[1]), 0) / valid.length, longitude:valid.reduce((total, coordinate) => total + Number(coordinate[0]), 0) / valid.length };
}
async function osmNeighborhoodGeometry(neighborhood) {
  const query = [neighborhood.nome, neighborhood.cidade, neighborhood.uf, 'Brasil'].filter(Boolean).join(', ');
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&q=${encodeURIComponent(query)}`, { headers:{ 'User-Agent':'Nexum-Radar-Imobiliario/1.0 (local geographic enrichment)' } });
  if (!response.ok) throw new Error(`OpenStreetMap respondeu ${response.status}.`);
  const payload = await response.json(); const feature = (payload.features || []).find((item) => ['Polygon', 'MultiPolygon', 'Point'].includes(item?.geometry?.type));
  if (!feature) return null;
  const geometry = feature.geometry?.type === 'Point' ? null : feature.geometry, fromGeometry = centroidFromGeometry(geometry), coordinates = feature.geometry?.coordinates;
  const latitude = fromGeometry?.latitude ?? Number(feature.properties?.lat ?? (feature.geometry?.type === 'Point' ? coordinates?.[1] : NaN));
  const longitude = fromGeometry?.longitude ?? Number(feature.properties?.lon ?? (feature.geometry?.type === 'Point' ? coordinates?.[0] : NaN));
  if (!validCoordinates(latitude, longitude)) return null;
  return { latitude, longitude, geometry, geographic_source:'OpenStreetMap', geographic_external_id:String(feature.properties?.osm_id || feature.id || ''), geographic_precision:geometry ? 'polygon' : 'centroid', geographic_updated_at:now(), geographic_status:'resolved' };
}
function proximityRows(neighborhoods = []) {
  const rows = [];
  for (let left = 0; left < neighborhoods.length; left += 1) for (let right = left + 1; right < neighborhoods.length; right += 1) {
    const source = neighborhoods[left], target = neighborhoods[right]; if (!validCoordinates(source.latitude, source.longitude) || !validCoordinates(target.latitude, target.longitude)) continue;
    const centroid_distance_km = BrokerNetwork.distanceKm(Number(source.latitude), Number(source.longitude), Number(target.latitude), Number(target.longitude));
    const targetPoint = { latitude:Number(target.latitude), longitude:Number(target.longitude) }, sourcePoint = { latitude:Number(source.latitude), longitude:Number(source.longitude) };
    const sourceBoundary = source.geometry ? polygonDistanceKm(targetPoint, source.geometry) : null, targetBoundary = target.geometry ? polygonDistanceKm(sourcePoint, target.geometry) : null;
    const boundary_distance_km = sourceBoundary != null && targetBoundary != null ? Math.min(sourceBoundary, targetBoundary) : centroid_distance_km;
    rows.push({ neighborhood_id:source.id, nearby_neighborhood_id:target.id, centroid_distance_km:Number(centroid_distance_km.toFixed(3)), boundary_distance_km:Number(boundary_distance_km.toFixed(3)), shares_boundary:Boolean(source.geometry && target.geometry && boundary_distance_km === 0), geographic_quality:source.geometry && target.geometry ? 'polygon' : 'centroid', updated_at:now() });
  }
  return rows;
}
function scheduleNeighborhoodEnrichment(neighborhoodId) {
  if (!neighborhoodId || geographicEnrichmentScheduled.has(neighborhoodId)) return;
  geographicEnrichmentScheduled.add(neighborhoodId);
  geographicEnrichmentQueue = geographicEnrichmentQueue.then(async () => {
    const data = await readData(), neighborhood = (data.neighborhoods || []).find((item) => item.id === neighborhoodId);
    if (!neighborhood || neighborhood.geographic_status === 'resolved') return;
    try { const enriched = await osmNeighborhoodGeometry(neighborhood); Object.assign(neighborhood, enriched || { geographic_status:'unresolved', geographic_precision:'unavailable', geographic_updated_at:now(), geographic_source:'OpenStreetMap' }); }
    catch (_) { Object.assign(neighborhood, { geographic_status:'pending_retry', geographic_updated_at:now(), geographic_source:'OpenStreetMap' }); }
    data.neighborhood_proximity = proximityRows(data.neighborhoods || []); await writeData(data);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }).catch(() => {}).finally(() => geographicEnrichmentScheduled.delete(neighborhoodId));
}
function ensureNeighborhood(data, source = {}, defaultOrigin = 'NEXUM') {
  const nome = String(source.nome ?? source.bairro ?? '').trim().replace(/\s+/g, ' '); if (!nome) return null;
  const cidade = String(source.cidade ?? source.localidade ?? '').trim().replace(/\s+/g, ' '), uf = String(source.uf ?? source.estado ?? '').trim().toUpperCase();
  const key = neighborhoodKey(nome, cidade, uf); let neighborhood = (data.neighborhoods || []).find((item) => neighborhoodKey(item.nome, item.cidade, item.uf) === key);
  if (!neighborhood) { neighborhood = { id:makeNeighborhoodId(nome, cidade, uf), nome, nome_normalizado:normalizeDomainText(nome), cidade, uf, ativo:true, origem:defaultOrigin, created_at:now(), updated_at:now(), ...geographicDefaults(source) }; data.neighborhoods.push(neighborhood); scheduleNeighborhoodEnrichment(neighborhood.id); }
  else Object.assign(neighborhood, geographicDefaults(neighborhood));
  return neighborhood;
}
function standardByValue(data, value) { const direct = (data.economicStandards || []).find((item) => item.id === value || item.slug === value || normalizeDomainText(item.nome) === normalizeDomainText(value)); if (direct) return direct; const slug = canonicalEconomicStandardSlug(value); return (data.economicStandards || []).find((item) => item.slug === slug) || (data.economicStandards || []).find((item) => item.slug === 'indefinido'); }
function ensureDomainTables(data) {
  data.economicStandards = Array.isArray(data.economicStandards) ? data.economicStandards : [];
  for (const seed of ECONOMIC_STANDARD_SEED) if (!data.economicStandards.some((item) => item.slug === seed.slug)) data.economicStandards.push({ ...seed, created_at:now(), updated_at:now() });
  data.economicStandards.sort((left, right) => left.ordem - right.ordem);
  data.propertyFeatureCatalog = Array.isArray(data.propertyFeatureCatalog) && data.propertyFeatureCatalog.length ? data.propertyFeatureCatalog : PROPERTY_FEATURE_CATALOG_SEED.map((item) => ({ ...item, origem:'NEXUM', ativo:true, created_at:now(), updated_at:now() }));
  for (const feature of PROPERTY_FEATURE_CATALOG_SEED) if (!data.propertyFeatureCatalog.some((item) => item.id === feature.id)) data.propertyFeatureCatalog.push({ ...feature, origem:'NEXUM', ativo:true, created_at:now(), updated_at:now() });
  data.neighborhoods = Array.isArray(data.neighborhoods) ? data.neighborhoods : []; data.neighborhood_proximity = Array.isArray(data.neighborhood_proximity) ? data.neighborhood_proximity : [];
  try { const imported = JSON.parse(fsSync.readFileSync(EMBEDDED_NEIGHBORHOODS_FILE, 'utf8')); for (const item of imported) ensureNeighborhood(data, { nome:item.bairro, cidade:'Campina Grande', uf:'PB', regiao:item.regiao, zona:item.zona }, 'Motor incorporado'); } catch (_) { /* a base local continua funcional sem a fonte de carga */ }
  for (const empreendimento of data.empreendimentos || []) {
    const standard = standardByValue(data, empreendimento.padraoEconomicoId || empreendimento.padrao || empreendimento.padrao_economico); if (standard) { empreendimento.padraoEconomicoId = standard.id; empreendimento.padrao = standard.nome; }
    const neighborhood = empreendimento.neighborhoodId ? data.neighborhoods.find((item) => item.id === empreendimento.neighborhoodId) : ensureNeighborhood(data, { nome:empreendimento.bairro, cidade:empreendimento.cidade, uf:empreendimento.estado }, 'NEXUM legado');
    if (neighborhood) { empreendimento.neighborhoodId = neighborhood.id; empreendimento.bairro = neighborhood.nome; empreendimento.cidade = empreendimento.cidade || neighborhood.cidade; empreendimento.estado = empreendimento.estado || neighborhood.uf; }
    empreendimento.caracteristicasImovel = normalizeEnterpriseCharacteristics(empreendimento.caracteristicasImovel);
  }
}
function applyEnterpriseDomains(data, empreendimento, payload = {}) {
  const standard = standardByValue(data, payload.padraoEconomicoId || payload.padrao || empreendimento.padraoEconomicoId || empreendimento.padrao); if (standard) { empreendimento.padraoEconomicoId = standard.id; empreendimento.padrao = standard.nome; }
  const selectedNeighborhood = data.neighborhoods.find((item) => item.id === String(payload.neighborhoodId || ''));
  const neighborhood = selectedNeighborhood || ensureNeighborhood(data, { nome:payload.bairro ?? empreendimento.bairro, cidade:payload.cidade ?? empreendimento.cidade, uf:payload.estado ?? empreendimento.estado }, 'NEXUM');
  if (neighborhood) { empreendimento.neighborhoodId = neighborhood.id; empreendimento.bairro = neighborhood.nome; empreendimento.cidade = neighborhood.cidade || empreendimento.cidade || ''; empreendimento.estado = neighborhood.uf || empreendimento.estado || ''; }
  empreendimento.caracteristicasImovel = normalizeEnterpriseCharacteristics(payload.caracteristicasImovel ?? empreendimento.caracteristicasImovel);
}
function normalizeDataModel(data) {
  const previousVersion = Number(data.version || 1);
  data.version = Math.max(previousVersion, 11); data.dicionario = data.dicionario || []; data.dicionarioTermosManuais = data.dicionarioTermosManuais || []; data.termosCanonicosManuais = Array.isArray(data.termosCanonicosManuais) ? data.termosCanonicosManuais : []; data.termosNaoMapeados = data.termosNaoMapeados || []; data.sequences = data.sequences || {}; data.empreendimentos = data.empreendimentos || []; data.userFavorites = Array.isArray(data.userFavorites) ? data.userFavorites : []; data.userNotificationReads = Array.isArray(data.userNotificationReads) ? data.userNotificationReads : []; data.gestaoImportacoesPdf = Array.isArray(data.gestaoImportacoesPdf) ? data.gestaoImportacoesPdf : []; data.gestaoImportacoesJson = Array.isArray(data.gestaoImportacoesJson) ? data.gestaoImportacoesJson : []; ensureDomainTables(data);
  for (const empreendimento of data.empreendimentos) {
    empreendimento.unidades = empreendimento.unidades || []; empreendimento.pontosQuentes = empreendimento.pontosQuentes || []; empreendimento.tabelasExcluidas = compactDeletedTableTombstones(empreendimento.tabelasExcluidas || []); empreendimento.fatosComerciais = empreendimento.fatosComerciais || []; empreendimento.intervalosComerciais = empreendimento.intervalosComerciais || []; empreendimento.auditoria = empreendimento.auditoria || []; empreendimento.tabelaPadraoTipo = empreendimento.tabelaPadraoTipo || null; empreendimento.fase = ENTERPRISE_PHASES.includes(empreendimento.fase) ? empreendimento.fase : 'Novo'; empreendimento.launchDate = normalizeManagementDate(empreendimento.launchDate || empreendimento.launch_date); empreendimento.deliveryDate = normalizeManagementDate(empreendimento.deliveryDate || empreendimento.delivery_date); empreendimento.percentualObra = Number.isFinite(Number(empreendimento.percentualObra ?? empreendimento.percentual_obra)) ? Math.min(100, Math.max(0, Number(empreendimento.percentualObra ?? empreendimento.percentual_obra))) : null; refreshConstructionStatus(empreendimento);
    for (const table of empreendimento.tabelas || []) {
      table.tipoTabela = table.tipoTabela || canonicalTableType(table.name); table.tipoTabelaLabel = TABLE_TYPE_LABELS[table.tipoTabela] || table.tipoTabelaLabel || 'Outra modalidade';
      table.isDemo = Boolean(table.isDemo);
      table.manualReviewRequired = table.manualReviewRequired ?? (!(table.unidades || []).length && !String(table.extracao?.texto || '').replace(/\f/g, '').trim());
      for (const unit of table.unidades || []) {
        if (unit.valorAvaliacaoExtraido != null) unit.valorAvaliacaoExtraido = parseMoney(unit.valorAvaliacaoExtraido);
        if (unit.valorPublicado === undefined) unit.valorPublicado = unit.valorExtraido ?? null;
        if (unit.situacaoPublicada === undefined) unit.situacaoPublicada = unit.situacaoExtraida ?? 'Não identificado';
        if (['RESERVADA_CONSIDERADA_VENDIDA', 'AUSENTE_CONSIDERADA_VENDIDA'].includes(unit.statusRegra)) {
          unit.situacaoExtraida = normalizeUnitStatus(unit.situacaoPublicada || unit.statusOriginal);
          unit.statusRegra = null;
        }
        unit.situacaoExtraida = normalizeUnitStatus(unit.situacaoExtraida ?? unit.situacaoPublicada);
        delete unit.condicoes?.conciliação;
        for (const plan of unit.condicoes?.planos || []) delete plan.conciliação;
      }
      normalizeTableComparisonIdentities(empreendimento, table);
      table.normalizacao = table.normalizacao || { formato: 'legado', campos: [] };
      if ((!(table.normalizacao.campos || []).length || Number(table.normalizacao.versaoLeitura || 0) < 2) && String(table.extracao?.texto || '').trim()) table.normalizacao = buildNormalization(table.extracao.texto, { commercialRules: table.regrasComerciais || '' }, data.dicionarioTermosManuais);
      table.classificacoesRemocao = table.classificacoesRemocao || {};
      table.origem = table.origem || { tipo: table.documento ? 'pdf' : 'manual', label: table.documento ? 'PDF importado' : 'Cadastro manual' };
      table.confiancaLeitura = table.confiancaLeitura || { percentual: table.manualReviewRequired ? 0 : 95, classificacao: table.manualReviewRequired ? 'baixa' : 'alta', metodo: table.manualReviewRequired ? 'pdf_imagem_sem_ocr' : 'texto_embutido' };
      table.alertas = table.alertas || [];
      normalizeDeclaredPaymentPlans(table);
      if (!table.regraInterpretada?.planos || Number(table.regraInterpretada.versaoModelo || 0) < 4) applyCommercialRule(table);
      else {
        let commercialDefaultsChanged = false;
        for (const plan of table.regraInterpretada.planos || []) for (const component of plan.componentes || []) {
          if (['entrada', 'intercaladas'].includes(component.id) && component.origemInterpretacao !== 'editada' && component.natureza !== 'minima') { component.natureza = 'minima'; commercialDefaultsChanged = true; }
          if (plan.codigo === 'PLANO_PADRAO' && component.id === 'intercaladas' && component.origemInterpretacao !== 'editada') { const publishedPeriodicity = detectedIntercalatedPeriodicity(table.extracao?.texto); if (component.periodicidade !== publishedPeriodicity) { component.periodicidade = publishedPeriodicity; commercialDefaultsChanged = true; } }
        }
        if (commercialDefaultsChanged) reconcileCommercialRule(table, table.regraInterpretada);
      }
    }
    alignZeroTableModality(empreendimento);
    applyVisionResidenceReconciliationPolicy(empreendimento);
    applyAggregateSimulatedZeroReconciliation(empreendimento);
    reconcileLegacyRemovalClassificationKeys(empreendimento);
    const registered = sortTables(empreendimento.tabelas || []); const selected = registered.find((table) => table.id === (empreendimento.tabelaBaseId || empreendimento.tabelaPadraoTableId));
    // A tabela base é estrutural. A fotografia vigente continua sendo calculada
    // separadamente para cada modalidade.
    const standard = selected || registered.at(-1) || null;
    if (standard) {
      empreendimento.tabelaBaseId = standard.id; empreendimento.tabelaBaseDefinidaEm = empreendimento.tabelaBaseDefinidaEm || empreendimento.migracaoTabelaPadraoEm || now();
      empreendimento.tabelaPadraoTableId = standard.id; empreendimento.tabelaPadraoTipo = standard.tipoTabela;
      empreendimento.migracaoTabelaPadraoEm = empreendimento.migracaoTabelaPadraoEm || now();
    }
    if (previousVersion < 7 && !empreendimento.migracaoHistoricoV7Em) empreendimento.migracaoHistoricoV7Em = now();
    if (empreendimento.migracaoHistoricoV7Em && !empreendimento.auditoria.some((item) => item.operacao === 'migracao_modelo_v7')) empreendimento.auditoria.push({ id: `AUD-MIGRACAO-V7-${empreendimento.id}`, at: empreendimento.migracaoHistoricoV7Em, operacao: 'migracao_modelo_v7', usuario: { codigo: 'sistema', nome: 'Sistema', perfil: 'SISTEMA' }, empreendimentoId: empreendimento.id, versaoAnterior: previousVersion < 7 ? previousVersion : 6, versaoAtual: 7 });
    if (previousVersion < 8 && !empreendimento.migracaoHistoricoV8Em) empreendimento.migracaoHistoricoV8Em = now();
    if (empreendimento.migracaoHistoricoV8Em && !empreendimento.auditoria.some((item) => item.operacao === 'migracao_modelo_v8')) empreendimento.auditoria.push({ id: `AUD-MIGRACAO-V8-${empreendimento.id}`, at: empreendimento.migracaoHistoricoV8Em, operacao: 'migracao_modelo_v8', usuario: { codigo: 'sistema', nome: 'Sistema', perfil: 'SISTEMA' }, empreendimentoId: empreendimento.id, versaoAnterior: previousVersion < 8 ? previousVersion : 7, versaoAtual: 8 });
    rebuildCommercialHistory(empreendimento, { reason: previousVersion < 7 ? 'migracao_v7' : 'leitura' });
  }
  for (const empreendimento of data.empreendimentos) for (const table of empreendimento.tabelas || []) table.alertas = reviewAlerts(empreendimento, table);
  for (const empreendimento of data.empreendimentos) rebuildCentralCatalog(empreendimento);
  const activeEnterpriseIds = new Set(data.empreendimentos.map((item) => item.id)); const favoriteKeys = new Set();
  data.userFavorites = data.userFavorites.reduce((favorites, item) => {
    const userId = String(item?.user_id || '').trim(), enterpriseId = String(item?.enterprise_id || '').trim(), key = `${userId}:${enterpriseId}`;
    if (!userId || !activeEnterpriseIds.has(enterpriseId) || favoriteKeys.has(key)) return favorites;
    favoriteKeys.add(key); favorites.push({ id:String(item.id || crypto.randomUUID()), user_id:userId, enterprise_id:enterpriseId, created_at:item.created_at || now() }); return favorites;
  }, []);
  return data;
}
function sanitize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 96) || 'sem_nome'; }
function enterpriseImage(empreendimento) { return empreendimento.imagem || (DEFAULT_ENTERPRISE_IMAGES[empreendimento.nome] ? { path: DEFAULT_ENTERPRISE_IMAGES[empreendimento.nome], source: 'asset_inicial' } : null); }
function log(data, event, detail = {}) { data.logs.unshift({ id: crypto.randomUUID(), event, at: now(), ...detail }); data.logs = data.logs.slice(0, 500); }
function requestActor(req) {
  try { const parsed = JSON.parse(decodeURIComponent(String(req.headers['x-nexum-actor'] || ''))); return { codigo: String(parsed.code || 'usuario'), nome: String(parsed.name || 'Usuário'), perfil: String(parsed.role || '') }; } catch (_) { return { codigo: 'sistema', nome: 'Sistema', perfil: 'SISTEMA' }; }
}

function isTruthyQuery(value) { return ['1','true','sim'].includes(String(value || '').trim().toLocaleLowerCase('pt-BR')); }
function queryValues(value) { return [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((item) => String(item).trim()).filter(Boolean))]; }
function hasValidCoordinates(latitude, longitude) { return latitude !== null && latitude !== undefined && String(latitude).trim() !== '' && longitude !== null && longitude !== undefined && String(longitude).trim() !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180; }
function coordinatePayload(payload = {}) {
  const latitudeProvided = Object.prototype.hasOwnProperty.call(payload, 'latitude') && String(payload.latitude ?? '').trim() !== '';
  const longitudeProvided = Object.prototype.hasOwnProperty.call(payload, 'longitude') && String(payload.longitude ?? '').trim() !== '';
  if (latitudeProvided !== longitudeProvided) return { error:'Informe latitude e longitude juntas.' };
  if (!latitudeProvided) return { value:null };
  if (!hasValidCoordinates(payload.latitude, payload.longitude)) return { error:'Informe coordenadas válidas: latitude entre -90 e 90 e longitude entre -180 e 180.' };
  return { value:{ latitude:Number(payload.latitude), longitude:Number(payload.longitude) } };
}
async function resolveEnterpriseCoordinates(empreendimento, coordinates) {
  if (coordinates) {
    empreendimento.latitude = coordinates.latitude;
    empreendimento.longitude = coordinates.longitude;
    empreendimento.geocodeStatus = 'manual';
    empreendimento.geocodeLabel = 'Coordenadas informadas no cadastro';
    return;
  }
  empreendimento.latitude = null;
  empreendimento.longitude = null;
  empreendimento.geocodeStatus = 'pending';
  empreendimento.geocodeLabel = 'Localização pendente — informe coordenadas ou um CEP completo.';
  try {
    const result = await geocode(empreendimento);
    empreendimento.latitude = result.latitude;
    empreendimento.longitude = result.longitude;
    empreendimento.geocodeStatus = result.source || 'automatic';
    empreendimento.geocodeLabel = result.label || 'Localizada automaticamente';
    for (const field of ['endereco', 'bairro', 'cidade', 'estado']) if (!empreendimento[field] && result.location?.[field]) empreendimento[field] = result.location[field];
  } catch (_) { /* o cadastro continua válido; a interface orienta a informar coordenadas */ }
}
function selectedEconomicStandard(data, enterprise) { return (data.economicStandards || []).find((item) => item.id === enterprise.padraoEconomicoId) || standardByValue(data, enterprise.padrao); }
function matchesCharacteristics(enterprise, query = {}) {
  const features = normalizeEnterpriseCharacteristics(enterprise.caracteristicasImovel), bedrooms = queryValues(query.dormitorios), parking = queryValues(query.vagas), attributes = queryValues(query.caracteristicas);
  if (bedrooms.length && !bedrooms.some((item) => features.dormitorios.includes(item))) return false;
  if (parking.length && !parking.some((item) => features.vagas.quantidades.includes(item))) return false;
  return attributes.every((item) => features.atributos[item] === 'sim');
}
function matchesSharedEnterpriseFilters(enterprise, query = {}, favoriteIds = new Set()) {
  const radar = buildRadar(enterprise), search = String(query.search || '').trim().toLocaleLowerCase('pt-BR'), ticket = Number(radar.current?.averagePrice || 0), text = `${enterprise.nome || ''} ${enterprise.construtora || ''} ${enterprise.bairro || ''} ${enterprise.cidade || ''}`.toLocaleLowerCase('pt-BR');
  const ticketMatches = !query.ticket || (query.ticket === 'ate-500' && ticket <= 500000) || (query.ticket === '500-800' && ticket > 500000 && ticket <= 800000) || (query.ticket === '800-1200' && ticket > 800000 && ticket <= 1200000) || (query.ticket === 'acima-1200' && ticket > 1200000);
  const neighborhoodMatches = !query.bairro || enterprise.neighborhoodId === query.bairro || normalizeDomainText(enterprise.bairro) === normalizeDomainText(query.bairro);
  const standard = selectedEconomicStandard(query.__domains || { economicStandards:ECONOMIC_STANDARD_SEED }, enterprise);
  const standardMatches = !query.padrao || [enterprise.padraoEconomicoId, standard?.slug, enterprise.padrao].includes(query.padrao);
  return (!isTruthyQuery(query.favorite) || favoriteIds.has(enterprise.id)) && (!search || text.includes(search)) && neighborhoodMatches && (!query.tipo || enterprise.tipo === query.tipo) && standardMatches && matchesCharacteristics(enterprise, query) && (!query.fase || homePhase(enterprise.fase, enterprise.launchDate || enterpriseFirstTableDate(enterprise)) === query.fase) && ticketMatches;
}
function scopedDataForSharedFilters(data, query = {}, userId = '') {
  const favoriteIds = new Set((data.userFavorites || []).filter((item) => item.user_id === userId).map((item) => item.enterprise_id));
  const selectedIds = new Set(queryEnterpriseIds(query));
  return { ...data, empreendimentos:(data.empreendimentos || []).filter((enterprise) => enterprise.status !== 'inactive' && (!selectedIds.size || selectedIds.has(enterprise.id)) && matchesSharedEnterpriseFilters(enterprise, { ...query, __domains:data }, favoriteIds)) };
}
function queryEnterpriseIds(query = {}) { return String(query.empreendimentos || query.empreendimento || '').split(',').map((item) => item.trim()).filter(Boolean); }
function marketPeriodQuery(query = {}) {
  if (query.de || query.ate || !query.period) return query;
  const current = new Date(), month = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const start = new Date(current);
  if (query.period === '30d' || query.period === 'current-month') return { ...query, de:month(current), ate:month(current) };
  if (query.period === '60d') { start.setMonth(start.getMonth() - 1); return { ...query, de:month(start), ate:month(current) }; }
  if (query.period === '90d') { start.setMonth(start.getMonth() - 2); return { ...query, de:month(start), ate:month(current) }; }
  if (query.period === '12m') { start.setMonth(start.getMonth() - 11); return { ...query, de:month(start), ate:month(current) }; }
  if (query.period === 'current-year') return { ...query, de:`${current.getFullYear()}-01`, ate:month(current) };
  return query;
}
function marketPressureContext(data, query = {}, userId = '') {
  const scoped = scopedDataForSharedFilters(data, query, userId), explicitIds = new Set(queryEnterpriseIds(query));
  const selectedNeighborhood = (data.neighborhoods || []).find((item) => item.id === query.bairro) || (data.neighborhoods || []).find((item) => normalizeDomainText(item.nome) === normalizeDomainText(query.bairro));
  let references = explicitIds.size ? scoped.empreendimentos.filter((item) => explicitIds.has(item.id)) : [];
  if (!references.length && isTruthyQuery(query.favorite)) references = scoped.empreendimentos;
  if (!references.length && selectedNeighborhood) references = [{ id:selectedNeighborhood.id, neighborhoodId:selectedNeighborhood.id, bairro:selectedNeighborhood.nome, latitude:selectedNeighborhood.latitude, longitude:selectedNeighborhood.longitude }];
  return { scoped, selectedNeighborhood, references, pressureQuery:marketPeriodQuery({ ...query, bairroNome:selectedNeighborhood?.nome || query.bairro || '' }) };
}
function audit(data, empreendimento, req, operation, detail = {}) {
  const record = { id: crypto.randomUUID(), at: now(), operacao: operation, usuario: requestActor(req), empreendimentoId: empreendimento.id, ...detail };
  empreendimento.auditoria = empreendimento.auditoria || []; empreendimento.auditoria.push(record); log(data, operation, { empreendimentoId: empreendimento.id, tabelaId: detail.tabelaId || null, auditoriaId: record.id }); return record;
}
function tableManagementControls(empreendimento) { return empreendimento.gestaoTabelas = Array.isArray(empreendimento.gestaoTabelas) ? empreendimento.gestaoTabelas : []; }
function tableOperationalUpdate(empreendimento, table, actor = { codigo:'sistema', nome:'Sistema', perfil:'SISTEMA' }) {
  const controls = tableManagementControls(empreendimento), type = canonicalTableType(table.tipoTabela), stamp = now();
  let control = controls.find((item) => item.tipoTabela === type);
  if (!control) { control = { tipoTabela:type, tipoTabelaLabel:TABLE_TYPE_LABELS[type] || table.tipoTabelaLabel || 'Outra modalidade' }; controls.push(control); }
  Object.assign(control, { tipoTabelaLabel:TABLE_TYPE_LABELS[type] || table.tipoTabelaLabel || control.tipoTabelaLabel, tabelaId:table.id, ultimaAtualizacao:stamp, atualizadoPor:{ codigo:actor.codigo, nome:actor.nome, perfil:actor.perfil }, agendamento:null, agendamentoConcluidoEm:control.agendamento ? stamp : null });
  return control;
}
function managementRows(data, query = {}) {
  const today = new Date(), search = String(query.search || '').trim().toLocaleLowerCase('pt-BR'), statusFilter = String(query.status || 'pendentes');
  const rows = [];
  for (const enterprise of data.empreendimentos || []) {
    const latestByType = new Map(); for (const table of enterprise.tabelas || []) { const type=canonicalTableType(table.tipoTabela); const current=latestByType.get(type); if (!current || String(table.updatedAt || table.createdAt || '') > String(current.updatedAt || current.createdAt || '')) latestByType.set(type, table); }
    for (const [type, table] of latestByType) {
      const control = tableManagementControls(enterprise).find((item) => item.tipoTabela === type) || {};
      const last = control.ultimaAtualizacao || table.updatedAt || table.validatedAt || table.createdAt || null, next = last ? new Date(new Date(last).getTime() + 30 * 86400000) : null, scheduled = control.agendamento ? new Date(control.agendamento) : null;
      const status = scheduled && scheduled >= today ? 'Agendada' : !next || next <= today ? 'Pendente' : 'Em dia';
      const haystack = `${enterprise.nome} ${enterprise.construtora} ${enterprise.bairro}`.toLocaleLowerCase('pt-BR');
      if (search && !haystack.includes(search)) continue;
      if (statusFilter === 'agendadas' && !(scheduled && scheduled >= today && scheduled <= new Date(today.getTime()+7*86400000))) continue;
      if (statusFilter !== 'todas' && statusFilter !== 'agendadas' && status.toLocaleLowerCase('pt-BR') !== statusFilter.replace(/s$/,'')) continue;
      rows.push({ empreendimentoId:enterprise.id, empreendimento:enterprise.nome, construtora:enterprise.construtora || 'Não informada', bairro:enterprise.bairro || 'Não informado', tipoImovel:enterprise.tipo || 'Outro', cidade:enterprise.cidade || '', estado:enterprise.estado || '', linkTabela:enterprise.linkTabela || '', tabelaOnlineStatus:enterprise.tabelaOnlineStatus || (enterprise.linkTabela ? 'disponivel' : ''), tipoTabela:type, modalidade:TABLE_TYPE_LABELS[type] || table.tipoTabelaLabel || 'Outra modalidade', vigencia:table.validityDate || null, tabelaId:table.id, ultimaAtualizacao:last, atualizadoPor:control.atualizadoPor || { nome:'Sistema / histórico' }, proximaRevisao:next?.toISOString() || null, agendamento:control.agendamento || null, status });
    }
  }
  return rows.sort((a,b) => String(a.construtora).localeCompare(String(b.construtora),'pt-BR') || String(a.empreendimento).localeCompare(String(b.empreendimento),'pt-BR'));
}
function normalizeOnlineTable(payload = {}) {
  const link = String(payload.linkTabela || '').trim();
  const status = ['disponivel','indisponivel'].includes(payload.tabelaOnlineStatus) ? payload.tabelaOnlineStatus : (link ? 'disponivel' : '');
  if (status === 'disponivel' && !link) return { error:'Informe o link direto da página da construtora.' };
  if (status === 'disponivel' && !/^https?:\/\//i.test(link)) return { error:'Informe um link válido, iniciado por http:// ou https://.' };
  return { status, link:status === 'disponivel' ? link : '' };
}
function managementKpis(data, rows) {
  const current = new Date(), monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  const afterStart = (value) => value && new Date(value) >= monthStart, last = [...rows].filter((item) => item.ultimaAtualizacao).sort((a,b) => String(b.ultimaAtualizacao).localeCompare(String(a.ultimaAtualizacao)))[0];
  return { empreendimentos:(data.empreendimentos || []).length, empreendimentosNovos:(data.empreendimentos || []).filter((item) => afterStart(item.createdAt)).length, tabelasCadastradas:rows.length, tabelasAtualizadas:rows.filter((item) => afterStart(item.ultimaAtualizacao)).length, agendadas:rows.filter((item) => item.status === 'Agendada').length, pendentes:rows.filter((item) => item.status === 'Pendente').length, ultimaAtualizacao:last ? { data:last.ultimaAtualizacao, usuario:last.atualizadoPor?.nome || 'Sistema' } : null };
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function body(req, limit = 28 * 1024 * 1024) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on('data', (chunk) => { size += chunk.length; if (size > limit) { reject(new Error('Arquivo excede 28 MB.')); req.destroy(); } else chunks.push(chunk); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
function parseJson(buffer) { try { return JSON.parse(buffer.toString('utf8') || '{}'); } catch (_) { throw new Error('JSON inválido.'); } }
function parseMultipart(buffer, contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('Formulário inválido.');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {}; let file = null; let cursor = buffer.indexOf(boundary) + boundary.length + 2;
  while (cursor > boundary.length + 1 && cursor < buffer.length) {
    const end = buffer.indexOf(boundary, cursor); if (end === -1) break;
    const part = buffer.subarray(cursor, end - 2); const sep = part.indexOf(Buffer.from('\r\n\r\n'));
    if (sep > -1) {
      const headers = part.subarray(0, sep).toString('utf8'); const value = part.subarray(sep + 4);
      const name = headers.match(/name="([^"]+)"/i)?.[1]; const filename = headers.match(/filename="([^"]*)"/i)?.[1]; const type = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1];
      if (filename !== undefined && filename) file = { name: filename, type, buffer: value };
      else if (name) fields[name] = value.toString('utf8');
    }
    cursor = end + boundary.length + 2;
  }
  return { fields, file };
}
function parseMoney(input) { const raw=String(input??'').trim();if(!raw||/^(?:-|\u2014|x)$/i.test(raw))return null;const normalized = raw.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');if(!normalized||normalized==='-'||normalized==='.')return null;const value = Number(normalized); return Number.isFinite(value) ? value : null; }
function buildUnitKey(empId, quadra, unidade, comparisonIdentity = null) {
  const explicitIdentity = String(comparisonIdentity || '').trim();
  if (explicitIdentity) return `${empId}:ID:${sanitize(explicitIdentity)}`;
  // Andar é contexto de leitura, não bloco estrutural. Mantê-lo na chave
  // quebrava a comparação entre JSONs que usam "Torre única" e PDFs que
  // inferem "1º andar", "2º andar" etc.
  const rawGroup = String(quadra || 'SEM_QUADRA').trim();
  const structuralGroup = /^(?:\d+\s*(?:º|°)?\s*andar|\d+_andar)$/i.test(rawGroup) ? 'Torre única' : rawGroup;
  return `${empId}:${sanitize(structuralGroup)}:${sanitize(unidade || 'SEM_UNIDADE')}`;
}
function buildUnitRecordKey(empId, unit = {}) {
  return buildUnitKey(empId, unit.quadra || unit.bloco || unit.torre, unit.unidade || unit.numero || unit.apartamento, unit.identificadorComparacao || unit.identificador_comparacao);
}
function compactUnitCode(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
function normalizeTableComparisonIdentities(enterprise, table) {
  const units = table?.unidades || [];
  if (!units.length) return;
  const codes = units.map((unit) => compactUnitCode(unit.unidade || unit.numero || unit.apartamento));
  const groups = [...new Set(units.map((unit) => compactUnitCode(unit.quadra || unit.bloco || unit.torre || unit.agrupadorOriginal)).filter(Boolean))];
  const isLotCode = codes.every((code) => /^\d{4}-\d{2}$/.test(code));
  const isApartment = /apartamento/i.test(String(enterprise?.tipo || ''));
  const compactTower = isApartment && groups.length >= 2 && codes.every((code) => /^\d{2,3}$/.test(code) && /^[1-8]$/.test(code.at(-1))) && codes.some((code) => code.length === 2) && codes.some((code) => code.length === 3);
  const paddedTower = isApartment && groups.length >= 2 && codes.every((code) => /^\d{3,4}$/.test(code) && /^0[1-8]$/.test(code.slice(-2)));
  for (const unit of units) {
    if (String(unit.identificadorComparacao || unit.identificador_comparacao || '').trim()) continue;
    const code = compactUnitCode(unit.unidade || unit.numero || unit.apartamento);
    const group = compactUnitCode(unit.quadra || unit.bloco || unit.torre || unit.agrupadorOriginal);
    if (isLotCode) unit.identificadorComparacao = `LOTE:${code}`;
    else if (compactTower) {
      const floor = Number(code.slice(0, -1)), position = Number(code.at(-1));
      if (Number.isInteger(floor) && floor > 0 && Number.isInteger(position) && position > 0) unit.identificadorComparacao = `APT:${group}:${String(floor * 100 + position)}`;
    } else if (paddedTower) unit.identificadorComparacao = `APT:${group}:${code}`;
  }
  for (const unit of units) unit.chave = buildUnitRecordKey(enterprise.id, unit);
}
function alignZeroTableModality(enterprise) {
  const tables = sortTables(enterprise?.tabelas || []).sort(snapshotOrder);
  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index];
    if (!/tabela\s+zero/i.test(String(table.name || ''))) continue;
    const next = tables.slice(index + 1).find((candidate) => !/tabela\s+zero/i.test(String(candidate.name || '')));
    if (!next || table.tipoTabela === next.tipoTabela) continue;
    table.tipoTabela = next.tipoTabela;
    table.tipoTabelaLabel = next.tipoTabelaLabel || TABLE_TYPE_LABELS[next.tipoTabela] || table.tipoTabelaLabel;
    table.modalidadeHerdadaDaPrimeiraFotografia = next.id;
  }
}
// Correção documental do Vision Residence: a aprovação estrutural informada
// pelo operador é de 240 apartamentos, exclusivamente nos blocos A e B. A
// fotografia de 18/08/2026 repetia a mesma grade também como "C"; ela não
// representa um terceiro bloco. Nesta série específica, a ausência frente à
// Tabela Zero é uma venda confirmada pelo operador, não uma pendência.
function applyVisionResidenceReconciliationPolicy(enterprise) {
  if (normalizeDomainText(enterprise?.nome) !== 'vision residence') return;
  const tables = sortTables(enterprise.tabelas || []).sort(snapshotOrder);
  const zero = tables.find((table) => /tabela\s+zero/i.test(String(table.name || '')) && (table.unidades || []).length === 240);
  const current = [...tables].reverse().find((table) => table.id !== zero?.id && !/tabela\s+zero/i.test(String(table.name || '')));
  if (!zero || !current) return;
  const zeroGroups = new Set((zero.unidades || []).map((unit) => compactUnitCode(unit.quadra || unit.bloco || unit.agrupadorOriginal)));
  if (zeroGroups.size !== 2 || !zeroGroups.has('A') || !zeroGroups.has('B')) return;
  const duplicatedGroup = (current.unidades || []).filter((unit) => compactUnitCode(unit.quadra || unit.bloco || unit.agrupadorOriginal) === 'C');
  if (duplicatedGroup.length) {
    current.unidades = current.unidades.filter((unit) => compactUnitCode(unit.quadra || unit.bloco || unit.agrupadorOriginal) !== 'C');
    current.unidadesApresentadas = current.unidades.length;
    current.reconciliacaoEstrutural = {
      politica: 'VISION_240_BLOCOS_A_B',
      gruposEstruturais: ['A', 'B'],
      linhasDescartadas: duplicatedGroup.length,
      motivo: 'Grupo C duplicava a mesma grade de apartamentos dos blocos A e B; não integra o total estrutural de 240 unidades.',
      aplicadaEm: now()
    };
    normalizeTableComparisonIdentities(enterprise, current);
  }
  const currentKeys = new Set((current.unidades || []).map((unit) => unit.chave));
  const soldKeys = (zero.unidades || []).filter((unit) => !currentKeys.has(unit.chave)).map((unit) => unit.chave);
  current.classificacoesRemocao = current.classificacoesRemocao || {};
  for (const key of soldKeys) {
    const prior = current.classificacoesRemocao[key];
    if (!prior || prior.status === 'PENDENTE') current.classificacoesRemocao[key] = {
      status: 'VENDIDA', usuario: 'operador', at: `${current.validityDate}T00:00:00.000Z`,
      observacao: 'Venda confirmada pelo operador: ausência entre a Tabela Zero estrutural de 240 unidades (A/B) e a fotografia atual.'
    };
  }
  enterprise.politicaReconciliacao = {
    ...(enterprise.politicaReconciliacao || {}),
    visionResidence: { totalEstrutural: 240, grupos: ['A', 'B'], ausenciasDaZero: 'VENDIDA_CONFIRMADA', reservasPublicadas: 'RESERVADA', atualizadaEm: now() }
  };
  if (!enterprise.auditoria?.some((item) => item.operacao === 'correcao_vision_240_ab')) {
    enterprise.auditoria = enterprise.auditoria || [];
    enterprise.auditoria.push({ id: `AUD-VISION-240-${enterprise.id}`, at: now(), operacao: 'correcao_vision_240_ab', usuario: { codigo: 'operador', nome: 'Operador', perfil: 'OPERADOR' }, empreendimentoId: enterprise.id, detalhe: { totalEstrutural: 240, blocos: ['A', 'B'], linhasGrupoCDuplicadas: duplicatedGroup.length, ausenciasClassificadasVendidas: soldKeys.length } });
  }
}
// Algumas Tabelas Zero legadas foram reconstruídas como estoque agregado: elas
// registram o total estrutural e o preço-base, mas ainda não trazem os códigos
// comerciais reais. A política abaixo é opt-in, documentada no cadastro e só
// opera quando o responsável confirmou que a ausência representa venda. Ela
// preserva a origem da simulação e nunca é aplicada a fotografias parciais.
function applyAggregateSimulatedZeroReconciliation(enterprise) {
  const policy = enterprise?.reconciliacaoEstrutural;
  if (!policy || policy.politica !== 'TABELA_ZERO_SIMULADA_AGREGADA_V1') return;
  const zero = (enterprise.tabelas || []).find((table) => table.id === policy.tabelaZeroId);
  const current = (enterprise.tabelas || []).find((table) => table.id === policy.tabelaAtualId);
  if (!zero || !current || !zero.unidades?.length || !current.unidades?.length) return;

  const expected = Number(policy.totalUnidadesEstruturais);
  const genericBase = zero.unidades.every((unit) => /^LOTE[-_ ]?\d+$/i.test(String(unit.unidade || unit.numero || unit.apartamento || '').trim()));
  const currentCodes = current.unidades.map((unit) => `${compactUnitCode(unit.quadra || unit.bloco || unit.torre || unit.agrupadorOriginal)}:${compactUnitCode(unit.unidade || unit.numero || unit.apartamento)}`);
  const valid = genericBase && Number.isInteger(expected) && expected === zero.unidades.length && current.unidades.length <= zero.unidades.length && new Set(currentCodes).size === currentCodes.length;
  if (!valid) return;

  // A Tabela Zero V6.1 não contém o vínculo individual. Para não somar duas
  // vezes o mesmo estoque, as unidades hoje ofertadas passam a ocupar slots
  // explícitos da base estrutural. O preço-base continua SIMULADO, não observado.
  current.unidades.forEach((unit, index) => {
    const identity = `ESTRUTURAL:${currentCodes[index]}`;
    const baseUnit = zero.unidades[index];
    unit.identificadorComparacao = identity;
    unit.origemIdentidadeComparacao = 'conciliacao_estrutural_base_simulada';
    baseUnit.identificadorComparacao = identity;
    baseUnit.origemIdentidadeComparacao = 'conciliacao_estrutural_base_simulada';
    baseUnit.codigoEstruturalOriginal = baseUnit.codigoEstruturalOriginal || String(baseUnit.unidade || baseUnit.numero || baseUnit.apartamento || '');
    baseUnit.unidadeConciliadaAtual = String(unit.unidade || unit.numero || unit.apartamento || '');
    baseUnit.quadraConciliadaAtual = String(unit.quadra || unit.bloco || unit.torre || unit.agrupadorOriginal || '');
  });
  normalizeTableComparisonIdentities(enterprise, zero);
  normalizeTableComparisonIdentities(enterprise, current);

  const currentKeys = new Set(current.unidades.map((unit) => unit.chave));
  current.classificacoesRemocao = current.classificacoesRemocao || {};
  if (policy.ausenciasConfirmadasComoVenda) for (const unit of zero.unidades) if (!currentKeys.has(unit.chave)) {
    const previous = current.classificacoesRemocao[unit.chave];
    if (!previous || previous.status === 'PENDENTE') current.classificacoesRemocao[unit.chave] = {
      status: 'VENDIDA', usuario: policy.confirmadoPor || 'operador', at: policy.confirmadoEm || `${current.validityDate}T00:00:00.000Z`,
      observacao: policy.observacao || 'Ausência confirmada na conciliação estrutural da Tabela Zero simulada.'
    };
  }
  current.reconciliacaoEstrutural = {
    politica: policy.politica, tabelaZeroId: zero.id, totalUnidadesEstruturais: expected,
    unidadesVinculadas: current.unidades.length, ausenciasClassificadasComoVenda: Math.max(0, zero.unidades.length - current.unidades.length),
    precoBase: 'SIMULADO', observacao: policy.observacao || null, confirmadoPor: policy.confirmadoPor || null,
    confirmadoEm: policy.confirmadoEm || null
  };
  if (policy.definirTabelaZeroComoBase) {
    enterprise.tabelaBaseId = zero.id;
    enterprise.tabelaPadraoTableId = zero.id;
    enterprise.tabelaPadraoTipo = zero.tipoTabela;
  }
}
function legacyRemovalIdentityToken(value) {
  return String(value || '').toUpperCase().replace(/^.*:/, '').replace(/^LOTE[-_ ]*/i, '').replace(/[^A-Z0-9]/g, '');
}
// A identidade de comparação pode evoluir sem perder decisões humanas já
// registradas. Esta migração só reaponta uma classificação quando o código da
// unidade anterior encontra exatamente um único candidato na fotografia-base.
function reconcileLegacyRemovalClassificationKeys(enterprise) {
  const tables = sortTables(enterprise?.tabelas || []).sort(snapshotOrder);
  for (const table of tables) {
    const classifications = table.classificacoesRemocao || {};
    if (!Object.keys(classifications).length) continue;
    const previous = previousSourceTable(enterprise, table);
    if (!previous?.unidades?.length) continue;
    const validKeys = new Set(previous.unidades.map((unit) => unit.chave));
    const candidatesByToken = new Map();
    for (const unit of previous.unidades) {
      const tokens = [unit.unidade, unit.numero, unit.apartamento, unit.identificadorComparacao, unit.identificador_comparacao].map(legacyRemovalIdentityToken).filter(Boolean);
      for (const token of new Set(tokens)) candidatesByToken.set(token, [...(candidatesByToken.get(token) || []), unit.chave]);
    }
    const reconciled = { ...classifications };
    for (const [legacyKey, classification] of Object.entries(classifications)) {
      if (validKeys.has(legacyKey)) continue;
      const candidates = [...new Set(candidatesByToken.get(legacyRemovalIdentityToken(legacyKey)) || [])];
      if (candidates.length !== 1 || reconciled[candidates[0]]) continue;
      reconciled[candidates[0]] = { ...classification, chaveAnterior:legacyKey, origemChave:'migracao_identidade_comparacao' };
      delete reconciled[legacyKey];
    }
    table.classificacoesRemocao = reconciled;
  }
}
function detectedIntercalatedPeriodicity(text) { const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); if (/INTERCALAD[^\n]{0,40}SEMESTR|SEMESTR[^\n]{0,40}INTERCALAD/.test(normalized)) return 'semestral'; if (/INTERCALAD[^\n]{0,40}ANUAL|ANUAL[^\n]{0,40}INTERCALAD/.test(normalized)) return 'anual'; return 'nao_informada'; }
function detectedPaymentPeriodicity(text, fallback = 'nao_informada') {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/BIMESTR/.test(normalized)) return 'bimestral'; if (/TRIMESTR/.test(normalized)) return 'trimestral'; if (/SEMESTR/.test(normalized)) return 'semestral'; if (/ANUAL/.test(normalized)) return 'anual'; if (/MENSAL|POR MES|AO MES/.test(normalized)) return 'mensal'; return fallback;
}
function extractZuhausUnits(text, empreendimentoId) {
  const units = []; const seen = new Set(); let bloco = null; const intercalatedPeriodicity = detectedIntercalatedPeriodicity(text);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[\f\t]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!line) continue;
    const blockMatch = line.match(/^BLOCO\s+([A-Z0-9-]+)$/i); if (blockMatch) { bloco = `Bloco ${blockMatch[1].toUpperCase()}`; continue; }
    // Tabela ZuHaus: apto, vagas, área, sinal, 100x, 10 intercaladas, chave, valor total.
    // Em algumas linhas o PDF repete o pavimento antes do apartamento (ex.: "4 402 ...").
    // Ele é estruturalmente irrelevante aqui e não pode deslocar a leitura dos valores.
    const row = line.match(/^(?:\d+\s+)?(\d{3,4})\s+(\d+,\d{2})\s+(\d+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/);
    if (!bloco || !row) continue;
    const unidade = row[1]; const key = buildUnitKey(empreendimentoId, bloco, unidade); if (seen.has(key)) continue; seen.add(key);
    const sinal = parseMoney(row[4]); const parcelas100x = parseMoney(row[5]); const intercaladas10x = parseMoney(row[6]); const chave = parseMoney(row[7]); const valorTotal = parseMoney(row[8]);
    units.push({ id: crypto.randomUUID(), chave: key, quadra: bloco, unidade, valorExtraido: valorTotal, valorInterpretado: valorTotal, valorValidado: null, areaPrivativa: parseMoney(row[3]), vagas: parseMoney(row[2]), situacaoExtraida: 'Disponível', condicoes: { sinal: { percentual: 15, valor: sinal }, parcelas: { quantidade: 100, percentual: 50, valor: parcelas100x }, intercaladas: { quantidade: 10, percentual: 20, valor: intercaladas10x, periodicidade: intercalatedPeriodicity }, chave: { percentual: 15, valor: chave } }, linhaOriginal: rawLine, status: 'extracted' });
  }
  return units;
}
function extractApartmentColumnUnits(text, empreendimentoId) {
  // Tabelas comerciais simples normalmente usam cinco colunas visuais:
  // unidade, bloco, metragem/descrição, situação e valor. O texto extraído
  // preserva essa ordem mesmo quando o PDF não traz rótulos como "Bloco A".
  const units = []; const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[\f\t]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!line) continue;
    const row = line.match(/^(\d{1,4}[A-Z]?)\s+([A-Z0-9-]+)\s+(.+?\d+(?:[,.]\d+)?\s*m(?:2|²).*?)\s+(Dispon[ií]vel|Indispon[ií]vel|Reservad[oa]|Vendida?|Bloquead[oa]|Retirad[oa])\s+((?:R\$\s*)?[\d.\s]+,\d{2})$/i);
    if (!row) continue;
    const [, unidade, bloco, descricao, situacao, valorTexto] = row;
    const area = descricao.match(/(\d+(?:[,.]\d+)?)\s*m(?:2|²)/i)?.[1]; const valor = parseMoney(valorTexto);
    if (valor === null) continue;
    const quadra = `Bloco ${bloco.toUpperCase()}`; const key = buildUnitKey(empreendimentoId, quadra, unidade); if (seen.has(key)) continue; seen.add(key);
    units.push({ id: crypto.randomUUID(), chave: key, quadra, unidade, valorExtraido: valor, valorInterpretado: valor, valorValidado: null, areaPrivativa: area ? parseMoney(area) : null, descricaoExtraida: descricao, situacaoExtraida: normalizeUnitStatus(situacao), condicoes: {}, linhaOriginal: rawLine, status: 'extracted' });
  }
  return units;
}
function loteamentoCommercialPlanLayout(text) {
  // A modalidade não é definida pelo empreendimento. Ela é inferida da
  // estrutura publicada: QUADRA + SITUAÇÃO + LOTE + área + preço + entrada.
  // Assim a mesma leitura atende loteamentos com 12/60/96/156 meses e também
  // matrizes mais recentes com 24, 36, 72, 84 ou outros prazos.
  const header = String(text || '').split(/\f/)[0].slice(0, 12000);
  const normalized = header.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const required = ['QUADRA', 'SITUACAO', 'LOTE', 'PRECO', 'ENTRADA'];
  if (!required.every((term) => normalized.includes(term))) return null;
  const prazos = [];
  for (const match of normalized.matchAll(/\b(\d{1,3})\s+MESES\b/g)) {
    const prazo = Number(match[1]);
    if (prazo >= 6 && prazo <= 240 && !prazos.includes(prazo)) prazos.push(prazo);
  }
  if (!prazos.length) return null;
  return { prazos, possuiValorM2: /VALOR\s*M[²2]/.test(normalized), possuiIntercaladas: /INTERCALADAS/.test(normalized) };
}
function loteamentoMoneyColumns(line) {
  // #VALUE! é uma célula publicada sem valor. Mantê-la como posição nula evita
  // deslocar todas as colunas seguintes de uma mesma linha.
  return [...String(line || '').matchAll(/R\$\s*([\d.]+,\d{2})|#VALUE!/gi)].map((match) => match[1] ? parseMoney(match[1]) : null);
}
function loteamentoDeclaredPlans(values, entryIndex, layout) {
  let cursor = entryIndex + 1;
  const plans = [];
  for (const prazo of layout.prazos) {
    const code = `PLANO_${prazo}`;
    plans.push({ codigo: code, nome: `Plano ${prazo}`, meses: prazo, mensal: { parcelas: prazo, valor: values[cursor++] ?? null } });
    if (layout.possuiIntercaladas && prazo >= 36) {
      const quantidade = Math.max(1, Math.round(prazo / 12));
      plans.push({ codigo: `${code}_INTERCALADAS`, nome: `Plano ${prazo} c/ Intercaladas`, meses: prazo, mensal: { parcelas: prazo, valor: values[cursor++] ?? null, intercaladasAnuais: { quantidade, periodicidade: 'anual', valor: values[cursor++] ?? null } } });
    }
  }
  return plans;
}
function extractQuintasDaMataUnits(text, empreendimentoId) {
  const layout = loteamentoCommercialPlanLayout(text); if (!layout) return [];
  // A coluna QUADRA usa células mescladas. No texto do PDF a âncora QD-xx
  // aparece no meio do conjunto de lotes, e não necessariamente na primeira
  // linha. Primeiro separamos sequências crescentes de lotes; depois vinculamos
  // a única âncora documental existente dentro de cada sequência.
  const rowPattern = /^(.+?)\s+(\d{1,4}[A-Z]?)\s+(\d{1,3}(?:\.\d{3})?,\d+)(?:\s+R\$\s*[\d.]+,\d{2}|\s+#VALUE!)/i;
  const rows = []; const anchors = []; let pendingPrefixValues = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[\f\t]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!line) continue;
    const header = line.match(/\bQD\s*-?\s*(\d{1,3}[A-Z]?)\b/i); const withoutHeader = header ? line.replace(header[0], '').trim() : line;
    if (header) anchors.push({ quadra: `QD-${header[1].toUpperCase()}`, position: rows.length, linhaOriginal: rawLine });
    const row = withoutHeader.match(rowPattern);
    if (!row) {
      const values = loteamentoMoneyColumns(withoutHeader);
      // Alguns PDFs quebram PREÇO e ENTRADA em uma linha com a âncora da
      // quadra e deixam a linha de lote com as demais parcelas.
      if (values.length && values.length <= 2 && !/(BLOQUEAD|VENDID|RESERVAD|DISPON[IÍ]VEL|\bNOVO\b)/i.test(withoutHeader)) pendingPrefixValues = values;
      continue;
    }
    rows.push({ rawLine, line: withoutHeader, match: row, lotOrder: Number.parseInt(row[2], 10), anchor: header ? `QD-${header[1].toUpperCase()}` : null, prefixValues: pendingPrefixValues });
    pendingPrefixValues = [];
  }
  const segments = []; let start = 0;
  for (let index = 1; index < rows.length; index++) if (rows[index].lotOrder <= rows[index - 1].lotOrder) { segments.push({ start, end: index }); start = index; }
  if (rows.length) segments.push({ start, end: rows.length });
  const diagnostics = []; const units = [];
  const parseRow = (candidate, contextQuadra) => {
    const row = candidate.match; const line = candidate.line;
    const [, situacao, unidade, areaTexto] = row;
    const values = [...(candidate.prefixValues || []), ...loteamentoMoneyColumns(line)];
    const priceIndex = layout.possuiValorM2 ? 1 : 0, entryIndex = layout.possuiValorM2 ? 2 : 1;
    const valor = values[priceIndex], area = parseMoney(areaTexto); if (valor === null || valor === undefined) return;
    const key = buildUnitKey(empreendimentoId, contextQuadra, unidade);
    const condicoes = { entrada: values[entryIndex] ?? null, planos: loteamentoDeclaredPlans(values, entryIndex, layout) };
    units.push({ id: crypto.randomUUID(), chave: key, quadra: contextQuadra, unidade, valorExtraido: valor, valorInterpretado: valor, valorValidado: null, areaPrivativa: area, valorM2Extraido: layout.possuiValorM2 ? values[0] ?? null : null, descricaoExtraida: `Lote ${unidade} · ${contextQuadra}`, situacaoExtraida: normalizeUnitStatus(situacao), situacaoPublicada: situacao, condicoes, linhaOriginal: candidate.rawLine, status: 'extracted' });
  };
  for (const segment of segments) {
    const segmentAnchors = anchors.filter((anchor) => anchor.position >= segment.start && anchor.position < segment.end);
    const inlineAnchors = rows.slice(segment.start, segment.end).map((row) => row.anchor).filter(Boolean);
    const candidates = [...new Set([...segmentAnchors.map((anchor) => anchor.quadra), ...inlineAnchors])];
    const quadra = candidates.length === 1 ? candidates[0] : 'SEM-QUADRA';
    if (candidates.length !== 1) diagnostics.push({ tipo: candidates.length ? 'CONFLITO_ANCORA_QUADRA' : 'QUADRA_NAO_IDENTIFICADA', nivel: 'critico', segmento: { inicio: segment.start + 1, fim: segment.end }, candidatas: candidates, mensagem: candidates.length ? `Mais de uma quadra foi associada à sequência de lotes ${segment.start + 1}-${segment.end}.` : `Nenhuma quadra foi associada à sequência de lotes ${segment.start + 1}-${segment.end}.` });
    for (const candidate of rows.slice(segment.start, segment.end)) parseRow(candidate, quadra);
  }
  const duplicated = new Map(); for (const unit of units) { if (!duplicated.has(unit.chave)) duplicated.set(unit.chave, []); duplicated.get(unit.chave).push(unit); }
  for (const [key, matches] of duplicated) if (matches.length > 1) diagnostics.push({ tipo: 'UNIDADE_DUPLICADA', nivel: 'critico', chave: key, quantidade: matches.length, mensagem: `A chave estável ${key} aparece ${matches.length} vezes na fonte. A área não foi usada para ocultar a duplicidade.` });
  units.extractionWarnings = diagnostics;
  return units;
}
function extractDirectLotUnits(text, empreendimentoId) {
  const units=[];const seen=new Set();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/[\f\t]+/g,' ').replace(/\s+/g,' ').trim();
    const row=line.match(/^(?:([A-Z0-9-]{1,8})\s+)?(Q[A-Z0-9-]*L\d+[A-Z]?)\s+(\d{1,4}(?:\.\d{3})?,\d{2})\s+(\d{1,4}(?:\.\d{3})?,\d{2})\s+(\d{1,3}(?:\.\d{3})+,\d{2})\b/i);
    if(!row)continue;const unidade=row[2].toUpperCase(),quadra=(row[1]||unidade.match(/^Q([A-Z0-9-]+)L/i)?.[1]||'SEM-QUADRA').toUpperCase(),key=buildUnitKey(empreendimentoId,quadra,unidade);if(seen.has(key))continue;seen.add(key);
    const tail=line.slice(row[0].length),values=[...tail.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g)].map((match)=>parseMoney(match[0])),entrada=values[0]??null;
    const planos=[];if(values.length>=4)planos.push({codigo:'PLANO_ESPECIAL_SEM_JUROS',nome:'Plano especial sem juros',entrada:{quantidade:1,valor:entrada},mensais:[{quantidade:72,valor:values[1]??null},{quantidade:72,valor:values[2]??null}],intercaladas:{quantidade:6,valor:values[3]??null}});if(values.length>=9)planos.push({codigo:'PLANO_MENOR_PARCELA',nome:'Plano especial menor parcela',entrada:{quantidade:1,valor:values[4]??entrada},mensais:[{quantidade:120,valor:values[5]??null},{quantidade:180,valor:values[6]??null},{quantidade:240,valor:values[7]??null}],intercaladas:{quantidade:20,valor:values[8]??null}});
    units.push({id:crypto.randomUUID(),chave:key,quadra,unidade,valorExtraido:parseMoney(row[5]),valorInterpretado:parseMoney(row[5]),valorValidado:null,areaPrivativa:parseMoney(row[3]),valorM2Extraido:parseMoney(row[4]),descricaoExtraida:`Lote ${unidade} · Quadra ${quadra}`,situacaoExtraida:'Disponível',situacaoPublicada:'Disponível',condicoes:{entrada,planos},linhaOriginal:rawLine,status:'extracted'});
  }
  return units;
}
function extractFloorApartmentUnits(text, empreendimentoId) {
  const units=[];const seen=new Set();let andar=null;
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/[\f\t]+/g,' ').replace(/\s+/g,' ').trim();if(!line)continue;
    const floor=line.match(/^(\d{1,2})\s*º\s*ANDAR\b/i);if(floor){andar=Number(floor[1]);continue;}
    const row=line.match(/^(\d{3,4})\s+(.*)$/);if(!row)continue;
    const unidade=row[1],rest=row[2],sold=/^VENDID[AO]\b/i.test(rest),available=rest.match(/^R\$\s*([\d.]+,\d{2})\s+(\d+(?:,\d+)?)\s+(.+)$/i);if(!sold&&!available)continue;
    const inferredFloor=andar||Number(unidade.slice(0,-2))||null,quadra=inferredFloor?`${inferredFloor}º andar`:'Torre única',key=buildUnitKey(empreendimentoId,quadra,unidade);if(seen.has(key))continue;seen.add(key);
    const valor=available?parseMoney(available[1]):null;
    units.push({id:crypto.randomUUID(),chave:key,quadra,unidade,valorExtraido:valor,valorInterpretado:valor,valorValidado:null,areaPrivativa:available?parseMoney(available[2]):null,descricaoExtraida:available?.[3]||null,situacaoExtraida:sold?'Vendida':'Disponível',situacaoPublicada:sold?'VENDIDO':'Disponível',condicoes:{},linhaOriginal:rawLine,status:valor===null?'pending_validation':'extracted'});
  }
  return units;
}
function extractAvailabilityApartmentUnits(text, empreendimentoId) {
  const units=[];const seen=new Set();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/[\f\t]+/g,' ').replace(/\s+/g,' ').trim();
    const row=line.match(/^Apto\s+(\d{1,4})(?:\s+\(VGM\))?\s+(\d+(?:,\d+)?)\s+(.+?)\s+(Dispon[ií]vel|Reservad[oa]|Vendid[oa]|Bloquead[oa]|Indispon[ií]vel)\s+(.+)$/i);if(!row)continue;
    const unidade=row[1],key=buildUnitKey(empreendimentoId,'Torre única',unidade);if(seen.has(key))continue;seen.add(key);
    const monies=[...row[5].matchAll(/(?:R\$\s*)?([\d.]+,\d{2})/g)].map((match)=>parseMoney(match[1])),valor=monies.at(-1)??null;
    units.push({id:crypto.randomUUID(),chave:key,quadra:'Torre única',unidade,valorExtraido:valor,valorInterpretado:valor,valorValidado:null,valorAvaliacaoExtraido:monies[0]??null,areaPrivativa:parseMoney(row[2]),descricaoExtraida:row[3],situacaoExtraida:normalizeUnitStatus(row[4]),situacaoPublicada:row[4],condicoes:{},linhaOriginal:rawLine,status:valor===null?'pending_validation':'extracted'});
  }
  return units;
}
function extractInvestmentApartmentUnits(text, empreendimentoId) {
  const units=[];const seen=new Set();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/[\f\t]+/g,' ').replace(/\s+/g,' ').trim();
    const row=line.match(/^(\d{3,4})\s+(\d+(?:,\d+)?)\s+(.+?)\s+(DISPON[IÍ]VEL|VENDID[OA]|RESERVAD[OA]|BLOQUEAD[OA]|INDISPON[IÍ]VEL)\s+([\d.]+,\d{2})(?:\s+(.+))?$/i);if(!row)continue;
    const unidade=row[1],andar=Number(unidade.slice(0,-2))||null,quadra=andar?`${andar}º andar`:'Torre única',key=buildUnitKey(empreendimentoId,quadra,unidade);if(seen.has(key))continue;seen.add(key);
    const values=[...String(row[6]||'').matchAll(/\b[\d.]+,\d{2}\b/g)].map((match)=>parseMoney(match[0])),valor=parseMoney(row[5]);
    const plano=values.length?{codigo:'PLANO_PUBLICADO',nome:'Plano publicado',entrada:{quantidade:1,valor:values[0]??null},componentes:values.slice(1).map((value,index)=>({ordem:index+1,valor}))}:null;
    units.push({id:crypto.randomUUID(),chave:key,quadra,unidade,valorExtraido:valor,valorInterpretado:valor,valorValidado:null,areaPrivativa:parseMoney(row[2]),descricaoExtraida:row[3],situacaoExtraida:normalizeUnitStatus(row[4]),situacaoPublicada:row[4],condicoes:{planos:plano?[plano]:[]},linhaOriginal:rawLine,status:valor===null?'pending_validation':'extracted'});
  }
  return units;
}
function extractCompactAvailabilityUnits(text, empreendimentoId) {
  const units=[];const seen=new Set();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/[\f\t]+/g,' ').replace(/\s+/g,' ').trim();
    const row=line.match(/^(\d{3,4})\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(DISPON[IÍ]VEL|VENDID[OA]|RESERVAD[OA]|BLOQUEAD[OA])(?:\s+([\d.]+,\d{2}))?/i);if(!row)continue;
    const unidade=row[1],andar=Number(unidade.slice(0,-2))||null,quadra=andar?`${andar}º andar`:'Torre única',key=buildUnitKey(empreendimentoId,quadra,unidade);if(seen.has(key))continue;seen.add(key);
    const valor=row[5]?parseMoney(row[5]):null;
    units.push({id:crypto.randomUUID(),chave:key,quadra,unidade,valorExtraido:valor,valorInterpretado:valor,valorValidado:null,areaPrivativa:parseMoney(row[2]),areaDescoberta:parseMoney(row[3]),situacaoExtraida:normalizeUnitStatus(row[4]),situacaoPublicada:row[4],condicoes:{},linhaOriginal:rawLine,status:valor===null?'pending_validation':'extracted'});
  }
  return units;
}
function extractUnits(text, empreendimentoId) {
  const zuhaus = extractZuhausUnits(text, empreendimentoId); if (zuhaus.length) return zuhaus;
  const apartmentColumns = extractApartmentColumnUnits(text, empreendimentoId); if (apartmentColumns.length) return apartmentColumns;
  const availabilityApartments = extractAvailabilityApartmentUnits(text, empreendimentoId); if (availabilityApartments.length) return availabilityApartments;
  const floorApartments = extractFloorApartmentUnits(text, empreendimentoId); if (floorApartments.length) return floorApartments;
  const compactAvailability = extractCompactAvailabilityUnits(text, empreendimentoId); if (compactAvailability.length) return compactAvailability;
  const investmentApartments = extractInvestmentApartmentUnits(text, empreendimentoId); if (investmentApartments.length) return investmentApartments;
  const directLots = extractDirectLotUnits(text, empreendimentoId); if (directLots.length) return directLots;
  const loteamento = extractQuintasDaMataUnits(text, empreendimentoId); if (loteamento.length) return loteamento;
  const units = []; const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim(); if (!line) continue;
    // Formato recorrente em tabelas verticais de apartamentos, por exemplo:
    // Bloco A  BV-BL. A - AP001  40,53 m² ... Disponível  R$ 180.900,00
    const apartmentRow = line.match(/^Bloco\s+([A-Z0-9-]+)\s+(BV-BL\.\s*[A-Z0-9-]+\s*-\s*(AP\d+[A-Z]?))\s+([\d,.]+)\s*m²\s+(.+?)\s+(Dispon[ií]vel|Indispon[ií]vel|Reservad[oa]|Vendida?|Bloquead[oa])\s+R\$\s*([\d.]+,\d{2})(?:\s+R\$\s*([\d.]+,\d{2}))?$/i);
    const labeled = line.match(/(?:quadra|qd\.?|bloco|torre)\s*[-:]?\s*([A-Z0-9-]+).*?(?:lote|unidade|apt(?:o)?\.?|apartamento)\s*[-:]?\s*([A-Z0-9-]+)/i);
    const compact = line.match(/\b(QD[-\s]?\d+[A-Z-]*)\s+(\d{1,4}[A-Z]?)\b/i);
    const apartment = line.match(/\b(BLOCO|TORRE)\s*([A-Z0-9-]+)\s+(?:APT(?:O)?\.?|UNIDADE)\s*(\d{1,4}[A-Z]?)/i);
    const quadra = apartmentRow ? `Bloco ${apartmentRow[1]}` : (labeled?.[1] || compact?.[1] || (apartment ? `${apartment[1]} ${apartment[2]}` : null));
    const unidade = apartmentRow?.[3] || labeled?.[2] || compact?.[2] || apartment?.[3];
    if (!quadra || !unidade) continue;
    const moneyMatches=[...line.matchAll(/R\$\s*([\d.]+,\d{2})/gi)],valueMatch=moneyMatches.at(-1); const valor = apartmentRow ? parseMoney(apartmentRow[7]) : (valueMatch ? parseMoney(valueMatch[1]) : null);
    const genericArea=line.match(/(\d+(?:[,.]\d+)?)\s*m(?:2|²)/i)?.[1]||null,statusMatch=line.match(/\b(Dispon[ií]vel|Indispon[ií]vel|Reservad[oa]|Vendida?|Bloquead[oa]|Retirad[oa])\b/i),descriptionMatch=line.match(/\((PcD|VGM)\)/i)?.[1]||null;
    const key = buildUnitKey(empreendimentoId, quadra, unidade); if (seen.has(key)) continue; seen.add(key);
    units.push({ id: crypto.randomUUID(), chave: key, quadra, unidade, valorExtraido: valor, valorInterpretado: valor, valorValidado: null, areaPrivativa: apartmentRow ? parseMoney(apartmentRow[4]) : parseMoney(genericArea), descricaoExtraida: apartmentRow?.[5] || descriptionMatch, situacaoExtraida:normalizeUnitStatus(apartmentRow?.[6]||statusMatch?.[1]||'Disponível'), valorAvaliacaoExtraido: apartmentRow?.[8] ? parseMoney(apartmentRow[8]) : (moneyMatches.length>1?parseMoney(moneyMatches[0][1]):null), condicoes: {}, linhaOriginal: rawLine, status: valor === null ? 'pending_validation' : 'extracted' });
  }
  return units;
}
let tesseractAvailability;
async function hasTesseract() {
  if (!tesseractAvailability) tesseractAvailability = execFileAsync('tesseract', ['--version'], { windowsHide:true }).then(()=>true).catch(()=>false);
  return tesseractAvailability;
}
async function ocrPdfText(filePath) {
  if (!(await hasTesseract())) return { text:'', available:false, warning:'OCR de fallback indisponível neste ambiente. O PDF deve ser revisado manualmente.' };
  const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'nexum-pdf-ocr-'));
  try {
    const info=await execFileAsync('pdfinfo',[filePath],{windowsHide:true,maxBuffer:1024*1024}),pages=Math.min(40,Number(info.stdout.match(/^Pages:\s+(\d+)/mi)?.[1]||1)),prefix=path.join(tempDir,'page');
    await execFileAsync('pdftoppm',['-f','1','-l',String(pages),'-r','180','-gray','-png',filePath,prefix],{windowsHide:true,maxBuffer:1024*1024});
    const images=(await fs.readdir(tempDir)).filter((name)=>name.endsWith('.png')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),parts=[];
    for(const image of images){
      const args=[path.join(tempDir,image),'stdout','-l','por+eng'];
      try{parts.push((await execFileAsync('tesseract',args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout||'')}catch(_){parts.push((await execFileAsync('tesseract',[path.join(tempDir,image),'stdout','-l','eng'],{windowsHide:true,maxBuffer:8*1024*1024})).stdout||'')}
    }
    return {text:parts.join('\n\f\n'),available:true,warning:pages>=40?'OCR limitado às primeiras 40 páginas; revise o documento.':null};
  } catch(error) {
    return {text:'',available:true,warning:`O OCR de fallback falhou: ${error.message}. Revise o PDF manualmente.`};
  } finally { await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{}); }
}
function tableLayoutFingerprint(text) {
  const signature=String(text||'').split(/\r?\n/).map((line)=>line.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/R\$\s*[\d.,]+/g,'<MOEDA>').replace(/\b\d+(?:[.,]\d+)*\b/g,'<N>').replace(/\s+/g,' ').trim()).filter((line)=>line.length>=4).slice(0,220).join('\n');
  return signature?{version:1,hash:crypto.createHash('sha256').update(signature).digest('hex'),sample:signature.slice(0,600)}:null;
}
async function extractPdf(filePath, empreendimentoId) {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], { maxBuffer: 12 * 1024 * 1024, windowsHide: true });
    let text = stdout || ''; const imageOnly = !text.replace(/\f/g, '').trim(); let ocrUsed=false,ocrWarning=null;
    if(imageOnly){const ocr=await ocrPdfText(filePath);if(ocr.text.trim()){text=ocr.text;ocrUsed=true}ocrWarning=ocr.warning;}
    const units = extractUnits(text, empreendimentoId); const isZuhausPattern = /Parcelas\s+100X/i.test(text) && /Intercaladas\s+10X/i.test(text);
    const commercialRules = isZuhausPattern ? 'Sinal: 15%. Parcelas: 100x (50%). Intercaladas: 10x (20%). Chave: 15%. Reajuste: INCC mensal durante a construção e IGP-M + 1% após a entrega.' : '';
    const warnings = units.length ? [...(units.extractionWarnings || [])] : [imageOnly ? 'O PDF é composto por imagens. Nenhuma unidade será inferida sem evidência; revise o documento antes de confirmar.' : 'Nenhuma unidade foi reconhecida automaticamente. Revise ou inclua as unidades na validação.'];if(ocrWarning)warnings.push(ocrWarning);
    const result={ text, units, commercialRules, warnings, manualReviewRequired: imageOnly || ocrUsed || warnings.some((warning) => warning?.nivel === 'critico'), imageOnly, ocrUsed, fingerprint:tableLayoutFingerprint(text) };result.confidence=readingConfidence(result);return result;
  } catch (error) { return { text: '', units: [], warnings: [`Não foi possível extrair o PDF: ${error.message}`], error: error.message, imageOnly: false, confidence: { percentual: 0, classificacao: 'baixa', metodo: 'falha_de_extracao' } }; }
}
function emptyComparison() { return { previousTableId: null, novas: [], removidas: [], retornadas: [], alteracoesValor: [], alteracoesComerciais: [], automaticoSuprimido: true }; }
function managementPdfFileName(value) {
  const fileName = path.basename(String(value || ''));
  if (!fileName || fileName !== String(value || '') || !fileName.toLowerCase().endsWith('.pdf')) throw Object.assign(new Error('Arquivo PDF inválido.'), { status:422 });
  return fileName;
}
async function managementPdfHash(filePath) { return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex'); }
function managementPdfPreference(left, right) {
  const rank = (name) => /\s*\(\d+\)(?=\.pdf$)/i.test(name) ? 1 : 0;
  return rank(left) - rank(right) || left.localeCompare(right, 'pt-BR', { numeric:true });
}
async function managementPrimaryPdfFile(hash) {
  const matches=[]; for (const entry of await fs.readdir(MANAGEMENT_PDF_INPUT_DIR, { withFileTypes:true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    if (await managementPdfHash(path.join(MANAGEMENT_PDF_INPUT_DIR, entry.name)) === hash) matches.push(entry.name);
  }
  return matches.sort(managementPdfPreference)[0] || null;
}
function managementIdentity(value) { return normalizeTableTermText(value).replace(/\b(inc|spe|ltda|construtora|incorporadora|residencial|empreendimento)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
function managementValidity(text, fileName = '') {
  const source = `${fileName}\n${String(text || '').slice(0, 12000)}`;
  const explicit = source.match(/(?:m[eê]s\s*(?:da\s*)?tabela|vig[eê]ncia|compet[eê]ncia)\D{0,18}(0?[1-9]|1[0-2])\D{0,6}(20\d{2})/i);
  if (explicit) return `${explicit[2]}-${String(explicit[1]).padStart(2,'0')}-01`;
  const numeric = fileName.match(/(?:^|\D)(0?[1-9]|1[0-2])[-_. ](20\d{2})(?:\D|$)/);
  if (numeric) return `${numeric[2]}-${String(numeric[1]).padStart(2,'0')}-01`;
  const months = { janeiro:1,fevereiro:2,marco:3,março:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12,jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12 };
  // Sem rótulo explícito, o mês só pode ser inferido do nome do arquivo.
  // Isso evita tratar datas de entrega impressas no PDF como vigência da tabela.
  const normalized = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  for (const [label, month] of Object.entries(months)) { const match = normalized.match(new RegExp(`\\b${label}\\b\\D{0,8}(20\\d{2}|\\d{2})`)); if (match) { const year=match[1].length===2?`20${match[1]}`:match[1]; return `${year}-${String(month).padStart(2,'0')}-01`; } }
  return null;
}
function normalizeManagementDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const monthMatch = raw.match(/^(\d{4})[-\/.](\d{2})$/);
  const localMonthMatch = raw.match(/^(\d{2})\/(\d{4})$/);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : match ? `${match[3]}-${match[2]}-${match[1]}` : monthMatch ? `${monthMatch[1]}-${monthMatch[2]}-01` : localMonthMatch ? `${localMonthMatch[2]}-${localMonthMatch[1]}-01` : null;
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? iso : null;
}
function detectedManagementProjectName(text, fileName = '') {
  const clean = (value) => String(value || '').replace(/[\f\r\n]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').trim();
  const usable = (value, source) => {
    const name = clean(value); const normalized = normalizeTableTermText(name);
    if (name.length < 3 || name.length > 64 || !/[a-zà-ÿ]/i.test(name)) return null;
    if (/^(tabela|atualizada|vendas|disponibilidade|radar dos clientes|lancamento|agosto|setembro|outubro|novembro|dezembro|janeiro|fevereiro|marco|abril|maio|junho|julho)(\s|$)/i.test(name) || /^(tabela\s+)?atualizada\s+(agosto|setembro|outubro|novembro|dezembro)$/i.test(name)) return null;
    if (normalized.split(' ').length === 1 && /^(tabela|vendas|atualizada|lancamento)$/i.test(normalized)) return null;
    return { nome:name, origem:source };
  };
  const source = String(text || '').slice(0, 16000);
  const title = source.match(/tabela\s+de\s+vendas\s*[-–—:]?\s*(?:lan[cç]amento\s+)?([a-zà-ÿ0-9][a-zà-ÿ0-9 '\-]{2,55})/i);
  const titleCandidate = usable(title?.[1], 'título da tabela'); if (titleCandidate) return titleCandidate;
  for (const rawLine of source.split(/\r?\n/).slice(0, 80)) {
    const line = clean(rawLine);
    if (/^(SIRIUS|UNI\s*\d{3}|N[ÓO]Z)$/i.test(line)) return usable(line, 'cabeçalho do PDF');
  }
  const stem = path.parse(fileName).name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const explicitFile = stem.match(/\b(SIRIUS|UNI\s*\d{3}|N[ÓO]Z)\b/i); if (explicitFile) return usable(explicitFile[1], 'nome do arquivo');
  const monthlyFile = stem.match(/^(.+?)\s*[- ]\s*(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:ço|co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\s*[-_. ]?\d{2,4}$/i);
  const monthlyCandidate = usable(monthlyFile?.[1], 'nome do arquivo'); if (monthlyCandidate) return monthlyCandidate;
  return null;
}
function identifyManagementEnterprise(data, text, fileName, fingerprint = null) {
  const source = managementIdentity(`${fileName} ${String(text || '').slice(0, 40000)}`), sourceTokens = new Set(source.split(' ').filter((token) => token.length > 2));
  const candidates = (data.empreendimentos || []).map((enterprise) => {
    const name = managementIdentity(enterprise.nome), builder = managementIdentity(enterprise.construtora), nameTokens = name.split(' ').filter((token) => token.length > 2), matched = nameTokens.filter((token) => sourceTokens.has(token)).length;
    let score = name && source.includes(name) ? 92 : nameTokens.length ? Math.round((matched / nameTokens.length) * 76) : 0;
    if (builder && source.includes(builder)) score += 8;
    const fingerprintMatch=Boolean(fingerprint?.hash&&(enterprise.tabelas||[]).some((table)=>table.documento?.fingerprint?.hash===fingerprint.hash));if(fingerprintMatch)score=Math.max(score,94);
    return { id:enterprise.id, nome:enterprise.nome, construtora:enterprise.construtora || 'Não informada', score:Math.min(99,score), evidencias:{nome:matched,fingerprint:fingerprintMatch} };
  }).filter((item) => item.score >= 25).sort((a,b) => b.score-a.score || a.nome.localeCompare(b.nome,'pt-BR'));
  return { suggested:candidates[0] || null, candidates:candidates.slice(0,5), identificadoNoPdf:detectedManagementProjectName(text, fileName) };
}
async function listManagementPdfs(data) {
  const names = (await fs.readdir(MANAGEMENT_PDF_INPUT_DIR, { withFileTypes:true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')).map((entry) => entry.name).sort((a,b) => a.localeCompare(b,'pt-BR'));
  const registeredHashes = new Set((data.empreendimentos || []).flatMap((enterprise) => (enterprise.tabelas || []).filter((table) => table.status === 'registered').map((table) => table.documento?.hash).filter(Boolean)));
  const discovered=[]; for (const fileName of names) { const filePath=path.join(MANAGEMENT_PDF_INPUT_DIR,fileName); discovered.push({fileName,filePath,stat:await fs.stat(filePath),hash:await managementPdfHash(filePath)}); }
  const primaryByHash=new Map(); for (const item of discovered) { const current=primaryByHash.get(item.hash); if(current&&managementPdfPreference(item.fileName,current)>0) continue; primaryByHash.set(item.hash,item.fileName); }
  return discovered.map(({fileName,stat,hash})=>{const job=(data.gestaoImportacoesPdf||[]).find((item)=>item.hash===hash);if(job?.state==='excluido_lista')return null;const isCopy=primaryByHash.get(hash)!==fileName;let state=registeredHashes.has(hash)?'duplicado':job?.state||'aguardando';if(!registeredHashes.has(hash)&&isCopy){state=job?.state==='revisao'?'duplicado_em_revisao':'duplicado_aguardando'}return {fileName,size:stat.size,modifiedAt:stat.mtime.toISOString(),hash,state,primaryFileName:primaryByHash.get(hash),job:job?{id:job.id,state:job.state,processedAt:job.processedAt,enterpriseId:job.enterpriseId||job.identification?.suggested?.id||null,tableId:job.tableId||null,confidence:job.identification?.suggested?.score||0,validityDate:job.validityDate||null,units:job.extraction?.unitCount??job.extraction?.units?.length??0,warnings:job.extraction?.warnings||[]}:null};}).filter(Boolean);
}
function managementJsonFileName(value) {
  const fileName = path.basename(String(value || ''));
  if (!fileName || fileName !== String(value || '') || !fileName.toLowerCase().endsWith('.json')) throw Object.assign(new Error('Arquivo JSON inválido.'), { status:422 });
  return fileName;
}
function managementJsonHash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function importedId(data, entity, prefix, candidate) {
  const value = String(candidate || '').trim(), used = new Set((data.empreendimentos || []).map((item) => item.id));
  if (entity === 'tabela') used.clear(), (data.empreendimentos || []).flatMap((item) => item.tabelas || []).forEach((item) => used.add(item.id));
  if (value && new RegExp(`^${prefix}-\\d{6}$`).test(value) && !used.has(value)) {
    const number = Number(value.slice(prefix.length + 1)); data.sequences[entity] = Math.max(Number(data.sequences[entity] || 0), number); return value;
  }
  return nextId(data, entity, prefix);
}
function normalizeEnterprisePhase(value) {
  const raw = typeof value === 'object' && value !== null ? (value.rotulo || value.label || value.codigo) : value;
  const normalized = String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (normalized === 'LANCAMENTO' || normalized === 'LANÇAMENTO') return 'Lançamento';
  if (normalized === 'EM OBRAS' || normalized === 'OBRAS' || normalized === 'EM CONSTRUCAO') return 'Em obras';
  if (normalized === 'ENTREGUE' || normalized === 'ENTREGUES' || normalized === 'PRONTO PARA MORAR' || normalized === 'PRONTO' || normalized === 'CONCLUIDO') return 'Entregue';
  if (normalized === 'NOVO' || normalized === 'NOVOS') return 'Novo';
  return 'Novo';
}
function normalizeConstructionStatus(value) {
  const normalized = normalizeDomainText(typeof value === 'object' && value !== null ? (value.codigo || value.status || value.rotulo) : value).replace(/\s+/g, '_').toUpperCase();
  const aliases = { EM_CONSTRUCAO:'EM_OBRAS', OBRAS:'EM_OBRAS', AVANCADA:'OBRA_AVANCADA', CONCLUIDA:'OBRA_CONCLUIDA', CONCLUIDO:'OBRA_CONCLUIDA', PRONTO_PARA_MORAR:'OBRA_CONCLUIDA', PRONTO:'OBRA_CONCLUIDA' };
  const result = aliases[normalized] || normalized;
  return CONSTRUCTION_STATUSES.includes(result) ? result : null;
}
function constructionStatusPriority(origin) {
  return { pesquisada_confirmada:3, manual:2, inferencia_data:1, nao_determinado:0 }[String(origin || '')] || 0;
}
function inferredConstructionStatus(launchDate, referenceDate = new Date()) {
  const launch = new Date(`${String(launchDate || '').slice(0, 10)}T12:00:00`), reference = referenceDate instanceof Date ? referenceDate : new Date(`${String(referenceDate || '').slice(0, 10)}T12:00:00`);
  if (Number.isNaN(launch.getTime()) || Number.isNaN(reference.getTime()) || reference < launch) return null;
  const months = (reference.getFullYear() - launch.getFullYear()) * 12 + reference.getMonth() - launch.getMonth();
  return months >= 12 ? 'OBRA_AVANCADA' : 'EM_OBRAS';
}
function refreshConstructionStatus(enterprise, referenceDate = new Date()) {
  const current = normalizeConstructionStatus(enterprise.statusObra || enterprise.status_obra), origin = enterprise.statusObraOrigem || enterprise.status_obra_origem || (current ? 'manual' : 'nao_determinado');
  const inferred = inferredConstructionStatus(enterprise.launchDate, referenceDate);
  if (constructionStatusPriority(origin) > constructionStatusPriority('inferencia_data') && current) {
    enterprise.statusObra = current; enterprise.statusObraOrigem = origin; return false;
  }
  if (!inferred) { enterprise.statusObra = current; enterprise.statusObraOrigem = current ? origin : 'nao_determinado'; return false; }
  const changed = enterprise.statusObra !== inferred || enterprise.statusObraOrigem !== 'inferencia_data';
  enterprise.statusObra = inferred; enterprise.statusObraOrigem = 'inferencia_data'; enterprise.statusObraVerificadoEm = now();
  return changed;
}
function applyConstructionPayload(enterprise, payload = {}) {
  enterprise.launchDate = normalizeManagementDate(payload.launchDate ?? payload.data_lancamento ?? enterprise.launchDate);
  enterprise.deliveryDate = normalizeManagementDate(payload.deliveryDate ?? payload.data_entrega ?? enterprise.deliveryDate);
  if (Object.prototype.hasOwnProperty.call(payload, 'prazoEntregaChaves')) enterprise.prazoEntregaChaves = String(payload.prazoEntregaChaves || '').trim();
  if (Object.prototype.hasOwnProperty.call(payload, 'statusObraFonte')) enterprise.statusObraFonte = String(payload.statusObraFonte || '').trim() || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'percentualObra')) {
    const percentage = Number(payload.percentualObra);
    enterprise.percentualObra = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'statusObra')) {
    const status = normalizeConstructionStatus(payload.statusObra);
    enterprise.statusObra = status;
    enterprise.statusObraOrigem = status ? 'manual' : 'nao_determinado';
    enterprise.statusObraVerificadoEm = status ? now() : null;
  }
  refreshConstructionStatus(enterprise);
  return enterprise;
}
function jsonImportUnit(sourceUnit, enterpriseId) {
  const originalKey = String(sourceUnit?.chave || sourceUnit?.unidade || sourceUnit?.numero || sourceUnit?.apartamento || sourceUnit?.apart || '').trim();
  const unit = String(sourceUnit?.unidade || sourceUnit?.numero || sourceUnit?.apartamento || sourceUnit?.apart || originalKey.split('::').at(-1) || originalKey.split(':').at(-1) || '').replace(/^Apto\s+/i, '').replace(/\s*\(VGM\)\s*$/i, '').trim();
  const grouping = String(sourceUnit?.agrupadorOriginal || sourceUnit?.quadra || sourceUnit?.bloco || sourceUnit?.torre || '').trim() || 'Torre única';
  const statusSource = sourceUnit?.situacaoExtraida ?? sourceUnit?.situacaoPublicada ?? sourceUnit?.status;
  const normalizedStatus = normalizeUnitStatus(statusSource), comparisonIdentity = String(sourceUnit?.identificadorComparacao ?? sourceUnit?.identificador_comparacao ?? '').trim() || null;
  const numeric = (value) => value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const saleValue = numeric(sourceUnit?.valorExtraido ?? sourceUnit?.valorVenda ?? sourceUnit?.investimento ?? sourceUnit?.preco ?? sourceUnit?.preco_lancamento_minimo ?? sourceUnit?.preco_lancamento_maximo);
  const coveredArea = numeric(sourceUnit?.areaPrivativa ?? sourceUnit?.areaPrivativaM2 ?? sourceUnit?.area_coberta_m2 ?? sourceUnit?.area_m2);
  const uncoveredArea = numeric(sourceUnit?.areaDescoberta ?? sourceUnit?.area_descoberta_m2) || 0;
  const area = coveredArea;
  const conditions = sourceUnit?.condicoes && typeof sourceUnit.condicoes === 'object' ? sourceUnit.condicoes : { sinal:sourceUnit?.sinal_10, duasParcelas:sourceUnit?.['2x'], mensais:sourceUnit?.mensais_0, intercaladasSemestrais:sourceUnit?.intercaladas_semestrais_0, financiamento:sourceUnit?.financiamento_90, avaliacaoCaixa:sourceUnit?.avaliacao_caixa };
  return {
    id: crypto.randomUUID(), chave: buildUnitKey(enterpriseId, grouping, unit, comparisonIdentity), chaveOrigem: originalKey, identificadorComparacao: comparisonIdentity,
    quadra: grouping, unidade: unit, areaPrivativa:area, vagas:numeric(sourceUnit?.vagas) ?? numeric(String(sourceUnit?.vaga || '').match(/\d+/)?.[0]), vagaOriginal:sourceUnit?.vaga ?? null,
    areaCoberta:coveredArea, areaDescoberta:uncoveredArea, areaTotal:coveredArea == null ? null : coveredArea + uncoveredArea,
    descricaoExtraida:sourceUnit?.descricaoExtraida ?? sourceUnit?.posicao ?? sourceUnit?.tipologia ?? null, tipologia:sourceUnit?.tipologia ?? null, orientacao:sourceUnit?.orientacao ?? sourceUnit?.posicao ?? null, classificacaoPreco:sourceUnit?.classificacaoPreco ?? sourceUnit?.natureza_preco ?? null, dormitorios:numeric(sourceUnit?.dormitorios ?? sourceUnit?.quartos), suites:numeric(sourceUnit?.suites ?? sourceUnit?.suite), marcacaoVGM:Boolean(sourceUnit?.marcacaoVGM), desconto:numeric(sourceUnit?.desconto), statusOriginal:statusSource == null ? null : String(statusSource), statusRegra:null, situacaoExtraida:normalizedStatus,
    situacaoPublicada:statusSource == null ? null : normalizedStatus, status:'extracted',
    valorExtraido:saleValue, valorInterpretado:numeric(sourceUnit?.valorInterpretado ?? sourceUnit?.valorVenda) ?? saleValue,
    valorValidado:numeric(sourceUnit?.valorValidado), valorPublicado:numeric(sourceUnit?.valorPublicado ?? sourceUnit?.valorVenda) ?? saleValue,
    valorM2Extraido:numeric(sourceUnit?.valorM2Extraido) ?? (area && saleValue ? saleValue / area : null), valorAvaliacaoExtraido:numeric(sourceUnit?.valorAvaliacaoExtraido ?? sourceUnit?.valorAvaliacao),
    condicoes:conditions,
    linhaOriginal:sourceUnit?.linhaOriginal ?? null, origemJson:sourceUnit?.origem ?? null, classificacaoOrigem:sourceUnit?.classificacao || 'observado'
  };
}
function prepareJsonImport(source, fileName) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Object.assign(new Error('O JSON deve conter um objeto na raiz.'), { status:422 });
  const enterprise = source.empreendimento || {}, commercialTable = source.tabelaProcessada || source.tabela_comercial || source.tabela || {}, units = Array.isArray(source.unidades) ? source.unidades : (Array.isArray(commercialTable.unidades) ? commercialTable.unidades : []);
  if (!Object.keys(commercialTable).length || !Array.isArray(units)) throw Object.assign(new Error('JSON incompatível: informe tabelaProcessada.unidades[], tabela_comercial.unidades[] ou tabela.unidades[].'), { status:422 });
  const builder = typeof enterprise.construtora === 'object' && enterprise.construtora !== null ? enterprise.construtora.nome : (enterprise.construtora || source.construtora?.nome || source.construtora || ''), rawDates = enterprise.datas || {}, operatorDates = source.dados_fornecidos_operador || {};
  const dateFrom = (value) => normalizeManagementDate(value && typeof value === 'object' ? value.valor || value.data : value);
  const launchDate = dateFrom(rawDates.launchDate || rawDates.lancamento || rawDates.data_lancamento || enterprise.launchDate || enterprise.lancamento || enterprise.data_lancamento || operatorDates.lancamento);
  const deliveryDate = dateFrom(rawDates.deliveryDate || rawDates.entrega || rawDates.entrega_prevista || rawDates.data_entrega || enterprise.deliveryDate || enterprise.entrega_prevista || enterprise.data_entrega || enterprise.data_entrega_prevista || operatorDates.entrega);
  const sourceAddress = enterprise.endereco;
  enterprise.endereco = typeof sourceAddress === 'string'
    ? { logradouro:sourceAddress, numero:enterprise.numero, bairro:enterprise.bairro, cidade:enterprise.cidade, estado:enterprise.estado || enterprise.uf, cep:enterprise.cep }
    : { ...(sourceAddress || {}), logradouro:sourceAddress?.logradouro || sourceAddress?.rua || '', cidade:sourceAddress?.cidade || sourceAddress?.municipio || enterprise.cidade || '' };
  let validityDate = dateFrom(commercialTable.validityDate || commercialTable.vigencia || commercialTable.dataReferencia || commercialTable.data_referencia || commercialTable.data_tabela || source.validityDate);
  const fileDate = String(commercialTable.arquivo_origem || fileName).match(/(?:^|[^\d])(\d{2})[\/. -](\d{2})(?:[\/. -](20\d{2}))?(?:[^\d]|$)/);
  if (!validityDate && fileDate) validityDate = `${fileDate[3] || new Date().getFullYear()}-${fileDate[2]}-${fileDate[1]}`;
  const warnings = [...(source.diagnostico?.avisos || [])];
  if (Array.isArray(source.pendencias)) warnings.push(...source.pendencias.map((item) => `${item.campo || 'Pendência'}: ${item.observacao || item.status || 'revisar'}`));
  if (!validityDate) warnings.push('A vigência da tabela não foi informada; confirme a data antes de cadastrar.');
  else if (!commercialTable.validityDate && !commercialTable.vigencia && !commercialTable.dataReferencia && !commercialTable.data_referencia && !commercialTable.data_tabela && !source.validityDate) warnings.push(`Vigência derivada do nome do arquivo/origem: ${validityDate}. Confirme antes de cadastrar.`);
  if (!units.length) warnings.push('O JSON não contém unidades para importar.');
  if (units.some((unit) => !String(unit?.unidade || unit?.numero || unit?.apartamento || unit?.chave || '').trim())) warnings.push('Há unidades sem identificador textual.');
  const sourceUnitKey = (unit) => `${unit?.agrupadorOriginal || unit?.quadra || unit?.bloco || unit?.torre || 'SEM_BLOCO'}:${unit?.chave || unit?.unidade || unit?.numero || unit?.apartamento || ''}`;
  if (new Set(units.map(sourceUnitKey)).size !== units.length) warnings.push('Existem chaves estruturais repetidas no JSON.');
  const sourceStatus = enterprise.status_atual?.status || enterprise.statusAtual || enterprise.fase;
  const processStatus = String(source.status_processamento || source.diagnostico?.status || '').toUpperCase();
  const status = ['CONSOLIDADO','CONCLUIDO','SUCESSO'].includes(processStatus) ? 'sucesso' : (source.diagnostico?.status || 'revisao');
  const convertedStatuses = units.reduce((summary, unit) => { const key=normalizeUnitStatus(unit?.situacaoExtraida ?? unit?.situacaoPublicada ?? unit?.status); if(key==='Reservada')summary.reservadas++;if(key==='Ausente')summary.ausentes++;return summary }, { reservadas:0, ausentes:0 });
  if (convertedStatuses.reservadas || convertedStatuses.ausentes) warnings.push(`${convertedStatuses.reservadas} reservada(s) e ${convertedStatuses.ausentes} ausente(s) foram preservadas sem conversão automática em venda.`);
  const features = { ...(source.empreendimento_caracteristicas || {}), ...(enterprise.caracteristicas || {}), ...(enterprise.caracteristicas_imovel || {}), ...(enterprise.caracteristicasImovel || {}) };
  const commercial = { ...(source.resumo_comercial || {}), ...(source.leitura_comercial || {}), ...(source.leituraComercial || {}), ...(enterprise.leitura_comercial || {}), ...(enterprise.leituraComercial || {}) };
  commercial.formasPagamento = commercial.formasPagamento || commercial.formas_pagamento || commercial.condicoes_pagamento || features.financiamento || null;
  commercial.caracteristicasComerciais = commercial.caracteristicasComerciais || commercial.caracteristicas_comerciais || commercial.diferenciais || commercial.publico_alvo || null;
  commercial.observacoes = commercial.observacoes || commercial.observacao || null;
  commercial.prazoEntregaChaves = commercial.prazoEntregaChaves || commercial.prazo_entrega_chaves || enterprise.prazo_entrega_chaves || null;
  const rawConstructionStatus = enterprise.statusObra || enterprise.status_obra || enterprise.situacao_obra || null;
  const constructionStatus = normalizeConstructionStatus(rawConstructionStatus);
  const percentageRaw = enterprise.percentualObra ?? enterprise.percentual_obra;
  const constructionOrigin = constructionStatus ? (/PESQUIS|CONFIRM/i.test(String(enterprise.proveniencia || enterprise.status_obra_origem || '')) ? 'pesquisada_confirmada' : 'manual') : 'nao_determinado';
  return { sourceVersion:source.schema_version || source.schema || null, fileName, diagnosticStatus:status, warnings, enterprise:{ id:String(enterprise.id || '').trim() || null, nome:String(enterprise.nome || enterprise.nome_comercial || '').trim() || path.parse(fileName).name, nomesAlternativos:enterprise.nomesAlternativos || enterprise.nomes_alternativos || [], fase:enterprise.fase || sourceStatus || null, statusObra:constructionStatus, statusObraOrigem:constructionOrigin, percentualObra:Number.isFinite(Number(percentageRaw)) ? Number(percentageRaw) : null, statusObraFonte:enterprise.status_obra_fonte || enterprise.fonte_status_obra || null, construtora:String(builder || '').trim() || '', incorporadora:enterprise.incorporadora || null, datas:{ launchDate, deliveryDate }, endereco:enterprise.endereco || {}, caracteristicasImovel:features, leituraComercial:commercial, classificacao:enterprise.classificacao || enterprise.padrao || enterprise.padrao_economico || null, tipo:enterprise.tipo || null, coordenadas:enterprise.coordenadas || enterprise.endereco || null }, table:{ id:String(commercialTable.id || '').trim() || null, name:String(commercialTable.name || commercialTable.nome || commercialTable.tipoTabelaLabel || commercialTable.tipo || path.parse(fileName).name).trim(), validityDate, tipoTabela:canonicalTableType(commercialTable.tipoTabela || commercialTable.tipoTabelaLabel || commercialTable.tipo), status:String(commercialTable.status || '').trim() || 'registered', regrasComerciais:commercialTable.regrasComerciais || commercialTable.regras_comerciais || commercial.formasPagamento || '', document:commercialTable.documento || { originalName:commercialTable.arquivo_origem || fileName } }, units:units.map((unit) => jsonImportUnit(unit, String(enterprise.id || 'IMPORT'))), unitCount:units.length, convertedStatuses };
}
function listManagementJsonJobs(data) {
  return (data.gestaoImportacoesJson || []).slice(-20).reverse().map((job) => ({ id:job.id, fileName:job.fileName, hash:job.hash, state:job.state, processedAt:job.processedAt, importedAt:job.importedAt || null, enterpriseId:job.enterpriseId || null, tableId:job.tableId || null, enterpriseCreatedByJob:Boolean(job.enterpriseCreatedByJob), unitCount:job.preview?.unitCount || 0, diagnosticStatus:job.preview?.diagnosticStatus || 'revisao', warnings:job.preview?.warnings || [], preview:job.preview || null }));
}
function jsonEnterpriseOption(item) {
  return { id:item.id, nome:item.nome, nomesAlternativos:item.nomesAlternativos || [], construtora:item.construtora || '', incorporadora:item.incorporadora || '', endereco:item.endereco || '', numero:item.numero || '', bairro:item.bairro || '', cidade:item.cidade || '', estado:item.estado || '', cep:item.cep || '', status:item.status || 'active' };
}
async function removeJsonImport(data, job, req) {
  const enterprise = (data.empreendimentos || []).find((item) => item.id === job.enterpriseId);
  const table = enterprise && (enterprise.tabelas || []).find((item) => item.id === job.tableId);
  const removeEnterprise = Boolean(enterprise && table && job.enterpriseCreatedByJob === true && (enterprise.tabelas || []).length === 1 && (table.origem?.gestaoJobId === job.id || enterprise.gestaoJsonJobId === job.id));
  let deletion = null;
  if (table) deletion = await executeTableDeletion(data, enterprise, table, { incluirDependencias:false, motivo:'Exclusão da importação JSON para correção e novo envio.' }, req);
  const files = new Set();
  if (job.storedInputName) files.add(path.join(MANAGEMENT_JSON_INPUT_DIR, path.basename(job.storedInputName)));
  if (table?.documento?.path) files.add(path.resolve(ROOT, table.documento.path));
  for (const filePath of files) if (isManagedDocumentPath(filePath)) await fs.rm(filePath, { recursive:true, force:true });
  if (removeEnterprise) {
    data.empreendimentos = (data.empreendimentos || []).filter((item) => item.id !== enterprise.id);
    data.userFavorites = (data.userFavorites || []).filter((item) => item.enterprise_id !== enterprise.id);
  }
  data.gestaoImportacoesJson = (data.gestaoImportacoesJson || []).filter((item) => item.id !== job.id);
  log(data, 'json_gestao_excluido', { arquivo:job.fileName, hash:job.hash, empreendimentoId:job.enterpriseId || null, tabelaId:job.tableId || null, tabelaRemovida:Boolean(table) });
  await writeData(data);
  return { ok:true, fileName:job.fileName, tableDeleted:Boolean(table), deletion };
}
function jsonEnterpriseDraft(data, sourceEnterprise, enterpriseId, stamp) {
  const address = sourceEnterprise.endereco || {}, commercial = sourceEnterprise.leituraComercial || {}, features = sourceEnterprise.caracteristicasImovel || {};
  const coordinates = sourceEnterprise.coordenadas || {};
  const standard=standardByValue(data, typeof sourceEnterprise.classificacao==='object' ? sourceEnterprise.classificacao?.padraoEconomico || sourceEnterprise.classificacao?.padrao : sourceEnterprise.classificacao);
  const text = (value, separator = '; ') => Array.isArray(value) ? value.filter(Boolean).join(separator) : String(value || '');
  const draft = { id:enterpriseId, nome:sourceEnterprise.nome, nomesAlternativos:sourceEnterprise.nomesAlternativos || [], construtora:sourceEnterprise.construtora, incorporadora:sourceEnterprise.incorporadora || null, endereco:address.logradouro || '', numero:address.numero || '', complemento:address.complemento || '', bairro:address.bairro || '', cidade:address.cidade || '', estado:address.estado || address.uf || '', cep:address.cep || '', latitude:Number.isFinite(Number(coordinates.latitude)) ? Number(coordinates.latitude) : null, longitude:Number.isFinite(Number(coordinates.longitude)) ? Number(coordinates.longitude) : null, geocodeStatus:Number.isFinite(Number(coordinates.latitude)) && Number.isFinite(Number(coordinates.longitude)) ? 'json_operador' : 'nao_determinado', geocodeLabel:coordinates.precisao || null, tipo:sourceEnterprise.tipo || (features.dormitorios || features.quartos || features.areasEncontradasM2 ? 'Apartamento' : 'Outro'), padrao:standard?.nome || 'Indefinido', padraoEconomicoId:standard?.id || null, fase:normalizeEnterprisePhase(sourceEnterprise.fase), launchDate:sourceEnterprise.datas?.launchDate || null, deliveryDate:sourceEnterprise.datas?.deliveryDate || null, prazoEntregaChaves:text(commercial.prazoEntregaChaves), formasPagamento:text(commercial.formasPagamento), caracteristicasComerciais:text(commercial.caracteristicasComerciais), observacoes:text(commercial.observacoes, ' ') || 'Importado por JSON estruturado; revisar apenas os campos sem evidência.', informacoesEstruturais:'', caracteristicasImovel:normalizeEnterpriseCharacteristics(features), statusObra:normalizeConstructionStatus(sourceEnterprise.statusObra), statusObraOrigem:sourceEnterprise.statusObraOrigem || 'nao_determinado', statusObraFonte:sourceEnterprise.statusObraFonte || null, percentualObra:Number.isFinite(Number(sourceEnterprise.percentualObra)) ? Math.min(100,Math.max(0,Number(sourceEnterprise.percentualObra))) : null, status:'active', createdAt:stamp, updatedAt:stamp, origemCadastro:'json_skill', gestaoJsonJobId:null, tabelas:[], unidades:[], pontosQuentes:[], tabelasExcluidas:[], fatosComerciais:[], intervalosComerciais:[], auditoria:[] };
  refreshConstructionStatus(draft, draft.deliveryDate || draft.launchDate || stamp);
  return draft;
}
function tableHeaderCandidates(text) {
  const candidates = new Map(); const add = (value) => { const original = String(value || '').replace(/\s+/g, ' ').trim(); const key = normalizeTableTermText(original); if (original && key.length > 1 && key.length <= 80 && !/^r\$|^\d+[,.\d]*$/.test(key)) candidates.set(key, original); };
  const headerSignal=/\b(posi[cç][aã]o|bloco|unidade|[aá]rea|planta|avalia[cç][aã]o|situa[cç][aã]o|valor|pre[cç]o|entrada|sinal|ato|parcela|intercalad|chave|financiamento|quadra|lote|vaga)\b/i;
  for (const page of String(text || '').split('\f')) {
    const lines=page.split(/\r?\n/).map((line)=>line.trim()).filter(Boolean); let headerFound=false;
    for (const line of lines) {
      if (line.length>220) continue; const cells=line.split(/\s{2,}/).map((cell)=>cell.replace(/\s+/g,' ').trim()).filter(Boolean);
      // Só a linha estrutural da tabela pode gerar pendência. Linhas de dados
      // (apartamentos, áreas, blocos, posições e preços) nunca são termos.
      if (!headerFound&&cells.length>=3&&cells.filter((cell)=>headerSignal.test(cell)).length>=2) { cells.forEach(add); headerFound=true; }
    }
  }
  const compact = String(text || '').replace(/\s+/g, ' ');
  for (const phrase of ['Preço do imóvel', 'Preço da unidade', 'Valor do imóvel', 'Valor da unidade', 'Valor de avaliação', 'Valor m²', 'Preço', 'Valor', 'Entrada', 'Sinal', 'Ato', 'Parcelas mensais', 'Mensais', 'Intercaladas semestrais', 'Intercaladas anuais', 'Intermediárias', 'Balão semestral', 'Balões', 'Reforços', 'Entrega das chaves', 'Chaves', 'Financiamento bancário', 'Quadra', 'Situação', 'Lote', 'Vagas']) {
    const expression = new RegExp(`(^|[^A-Za-zÀ-ÿ])(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-zÀ-ÿ])`, 'i'); if (expression.test(compact)) add(phrase);
  }
  return [...candidates.values()];
}
function buildNormalization(text, extraction, manualEntries = []) {
  const compact = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); const fields = []; const seenFields = new Set();
  const resolved = tableHeaderCandidates(text).map((term) => resolveTableTerm(term, manualEntries));
  const fieldFor = (term) => term.campoPadrao || CANONICAL_TABLE_TERMS.get(normalizeTableTermText(term.termoNormalizado))?.campoPadrao || null;
  for (const term of resolved.filter((entry) => entry.encontradoNoDicionario && !entry.ignorado)) {
    const campoPadrao = fieldFor(term); if (!campoPadrao) continue;
    const fieldKey = `${term.termoTecnico}:${campoPadrao}`; if (seenFields.has(fieldKey)) continue; seenFields.add(fieldKey);
    fields.push({ origem: term.termoOriginal, origemTecnica: term.termoTecnico, termoNormalizado: term.termoNormalizado, categoria: term.categoria, campoPadrao, confianca: term.origemResolucao === 'csv' ? 'alta' : 'alta', origemResolucao: term.origemResolucao });
  }
  const termosNaoMapeadosDetalhes = resolved.filter((entry) => !entry.encontradoNoDicionario).map((entry) => ({ termoOriginal: entry.termoOriginal, termoTecnico: entry.termoTecnico, categoria: 'nao_mapeado' }));
  const termosDesconhecidos = termosNaoMapeadosDetalhes.map((entry) => entry.termoOriginal);
  const apartmentColumns = /APARTAMENTOS\s+BLOCO\s+METRAGEM\s+VENDAS\s+VALORES\s+R\$/.test(compact);
  return { versaoLeitura:2, formato: apartmentColumns ? 'tabela_comercial_colunas_por_unidade' : (extraction.commercialRules ? 'tabela_financeira_por_unidade' : 'tabela_comercial_por_unidade'), campos: fields, termosDesconhecidos, termosNaoMapeadosDetalhes, dicionario: { arquivo: path.relative(ROOT, TERM_DICTIONARY_FILE), quantidadeTermos: TABLE_TERM_DICTIONARY.quantidade, estrategia: 'cabecalhos_estruturais_exatos' } };
}
function learnMappings(data, normalization) {
  // Confirmações nunca escrevem equivalências automaticamente. O histórico de
  // termos pendentes é apenas observabilidade para revisão humana posterior.
  for (const term of normalization.termosNaoMapeadosDetalhes || []) {
    const known = (data.termosNaoMapeados || []).some((entry) => entry.termoTecnico === term.termoTecnico);
    if (!known) data.termosNaoMapeados.push({ ...term, primeiraOcorrenciaEm: now() });
  }
}
function moneyNumber(value) { const parsed = typeof value === 'object' && value !== null ? value.valor : value; return Number.isFinite(Number(parsed)) ? Number(parsed) : null; }
function average(values) { const valid = values.filter((value) => Number.isFinite(value)); return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null; }
function commercialModality(table) {
  const codigo = canonicalTableType(table.tipoTabela || table.name);
  return { codigo, nome: TABLE_TYPE_LABELS[codigo] || 'Outra modalidade', versaoId: table.id, versaoNome: table.name, validade: table.validityDate };
}
function declaredPlans(unit) {
  const conditions = unit.condicoes || {};
  if (Array.isArray(conditions.planos) && conditions.planos.length) return conditions.planos.map((plan) => ({
    codigo: plan.codigo || sanitize(plan.nome || 'plano'), nome: plan.nome || plan.codigo || 'Plano', prazoMeses: Number(plan.prazoMeses || plan.meses || plan.mensal?.parcelas || 0) || null,
    entrada: moneyNumber(conditions.entrada),
    mensais: { quantidade: Number(plan.mensal?.quantidade || plan.mensal?.parcelas || plan.meses || 0) || null, valor: moneyNumber(plan.mensal?.valor) },
    intercaladas: { quantidade: Number(plan.mensal?.intercaladasAnuais?.quantidade || plan.intercaladas?.quantidade || 0) || null, valor: moneyNumber(plan.mensal?.intercaladasAnuais?.valor || plan.intercaladas?.valor), periodicidade: plan.mensal?.intercaladasAnuais?.periodicidade || plan.intercaladas?.periodicidade || 'anual' },
    chave: { quantidade: Number(plan.chave?.quantidade || 0) || null, valor: moneyNumber(plan.chave?.valor) }, percentuaisDeclarados: {}, referencia: plan
  }));
  if (conditions.sinal || conditions.parcelas || conditions.intercaladas || conditions.chave) return [{
    codigo: 'PLANO_PADRAO', nome: 'Condição publicada', prazoMeses: Number(conditions.parcelas?.quantidade || 0) || null,
    entrada: moneyNumber(conditions.sinal), mensais: { quantidade: Number(conditions.parcelas?.quantidade || 0) || null, valor: moneyNumber(conditions.parcelas?.valor) },
    intercaladas: { quantidade: Number(conditions.intercaladas?.quantidade || 0) || null, valor: moneyNumber(conditions.intercaladas?.valor), periodicidade: conditions.intercaladas?.periodicidade || 'nao_informada' },
    chave: { quantidade: 1, valor: moneyNumber(conditions.chave?.valor) },
    percentuaisDeclarados: { entrada: Number(conditions.sinal?.percentual) || null, mensais: Number(conditions.parcelas?.percentual) || null, intercaladas: Number(conditions.intercaladas?.percentual) || null, chave: Number(conditions.chave?.percentual) || null }, referencia: conditions
  }];
  return [];
}
function componentCandidate(samples, component, bases) {
  const values = samples.map((sample) => ({ ...sample, quantidade: Number(sample[component]?.quantidade || 1) || 1, total: Number(sample[component]?.valor || 0) * (Number(sample[component]?.quantidade || 1) || 1) })).filter((sample) => sample.total > 0 && sample.valor > 0);
  if (!values.length) return null;
  const candidates = [];
  const fixedValue = average(values.map((sample) => sample[component].valor));
  candidates.push({ tipo: 'valor_fixo', base: 'valor_imovel', valor: fixedValue, erro: average(values.map((sample) => Math.abs(sample[component].valor - fixedValue))) });
  for (const base of bases) {
    const applicable = values.filter((sample) => Number(sample[base.chave]) > 0);
    if (!applicable.length) continue;
    const percentual = average(applicable.map((sample) => (sample.total / Number(sample[base.chave])) * 100));
    candidates.push({ tipo: 'percentual', base: base.base, percentual, erro: average(applicable.map((sample) => Math.abs(sample.total - ((Number(sample[base.chave]) * percentual) / 100)))) / average(applicable.map((sample) => sample.quantidade)) });
  }
  candidates.sort((left, right) => left.erro - right.erro || (left.tipo === 'valor_fixo' ? -1 : 1));
  const best = candidates[0]; const scale = Math.max(0.01, average(values.map((sample) => sample[component].valor)) || 1);
  const alternativasBase = best.tipo === 'percentual' ? [...new Set(candidates.filter((candidate) => candidate.tipo === 'percentual' && Math.abs(candidate.erro - best.erro) <= 0.005).map((candidate) => candidate.base))] : [];
  const baseAmbigua = alternativasBase.length > 1;
  const confidence = Math.max(0, Math.min(100, Math.round(100 - ((best.erro / scale) * 10000))));
  return { ...best, quantidade: Number(values[0][component].quantidade || 1), natureza: 'sugerida', confianca: baseAmbigua ? Math.min(confidence, 65) : confidence, amostras: values.length, baseAmbigua, alternativasBase, origemInterpretacao: 'inferida' };
}
function declaredPercentageComponent(id, nome, percentual, quantidade, periodicidade, textoOriginal, natureza) {
  if (!Number.isFinite(Number(percentual)) || Number(percentual) <= 0) return null;
  return { id, nome, tipo: 'percentual', tipoCalculo: 'percentual', base: 'valor_imovel', baseCalculo: 'valor_imovel', percentual: Number(percentual), quantidade: Number(quantidade || 1) || 1, periodicidade, natureza, confianca: 100, amostras: 0, baseAmbigua: false, alternativasBase: [], origemInterpretacao: 'declarada', textoOriginal, posicaoDocumental: { secao: 'cabecalho', referencia: textoOriginal } };
}
function normalizeRuleComponent(component, index = 0) {
  const tipoCalculo = component.tipoCalculo || (component.tipo === 'saldo' ? 'residual' : component.tipo) || 'valor_fixo';
  const baseCalculo = component.baseCalculo || component.base || (tipoCalculo === 'residual' ? 'saldo_remanescente' : 'valor_imovel');
  return { ...component, tipoCalculo, tipo: tipoCalculo === 'residual' ? 'saldo' : tipoCalculo, baseCalculo, base: baseCalculo, ordem: Number(component.ordem || index + 1), dependencias: component.dependencias || (baseCalculo === 'saldo_remanescente' ? ['componentes_anteriores'] : []), origemInterpretacao: component.origemInterpretacao || 'inferida', textoOriginal: component.textoOriginal || component.nome || '', posicaoDocumental: component.posicaoDocumental || null };
}
function declaredSightDiscount(table) {
  const text = String(table.extracao?.texto || table.regrasComerciais || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!/A\s+VISTA/.test(text) || !/DESCONTO/.test(text)) return null;
  const match = text.match(/(\d+(?:[,.]\d+)?)\s*%/);
  return match ? Number(String(match[1]).replace(',', '.')) : null;
}
function calculatedComponents(plan, price) {
  const components = []; let remaining = price; let entryTotal = 0;
  for (const rule of [...(plan.componentes || [])].sort((left, right) => Number(left.ordem || 0) - Number(right.ordem || 0))) {
    const quantity = Number(rule.quantidade || 1) || 1;
    let base = price;
    const baseCalculo = rule.baseCalculo || rule.base;
    const tipoCalculo = rule.tipoCalculo || (rule.tipo === 'saldo' ? 'residual' : rule.tipo);
    if (baseCalculo === 'saldo_apos_entrada') base = price - entryTotal;
    if (baseCalculo === 'saldo_remanescente') base = remaining;
    let total = 0;
    if (tipoCalculo === 'valor_fixo') total = Number(rule.valor || 0) * quantity;
    else if (tipoCalculo === 'percentual') total = base * (Number(rule.percentual || 0) / 100);
    else if (tipoCalculo === 'residual') total = remaining;
    const value = quantity ? total / quantity : total;
    components.push({ id: rule.id, quantidade: quantity, total, valor: value, base: baseCalculo, baseCalculo, tipo: tipoCalculo === 'residual' ? 'saldo' : tipoCalculo, tipoCalculo });
    if (rule.id === 'entrada') entryTotal = total;
    if (tipoCalculo !== 'residual') remaining -= total; else remaining = 0;
  }
  return components;
}
function inferCommercialRule(table, previousRule = null) {
  const grouped = new Map();
  for (const unit of table.unidades || []) {
    const price = unitValue(unit); if (!price) continue;
    for (const plan of declaredPlans(unit)) {
      if (!grouped.has(plan.codigo)) grouped.set(plan.codigo, []);
      grouped.get(plan.codigo).push({ valor: price, saldoAposEntrada: price - Number(plan.entrada || 0), ...plan });
    }
  }
  const previousPlans = new Map((previousRule?.planos || []).map((plan) => [plan.codigo, plan]));
  let planos = [...grouped.entries()].map(([codigo, samples]) => {
    const first = samples[0]; const prior = previousPlans.get(codigo); const priorComponents = new Map((prior?.componentes || []).map((component) => [component.id, component]));
    const explicit = first.percentuaisDeclarados || {};
    const entrada = declaredPercentageComponent('entrada', 'Entrada', explicit.entrada, 1, 'unica', `Sinal / entrada (${explicit.entrada || 0}%)`, 'minima') || componentCandidate(samples.map((sample) => ({ ...sample, entrada: { quantidade: 1, valor: sample.entrada } })), 'entrada', [{ chave: 'valor', base: 'valor_imovel' }]);
    const intercaladas = declaredPercentageComponent('intercaladas', 'Intercaladas', explicit.intercaladas, first.intercaladas.quantidade, first.intercaladas.periodicidade || 'anual', `Intercaladas ${first.intercaladas.quantidade || ''}x (${explicit.intercaladas || 0}%)`, 'minima') || componentCandidate(samples, 'intercaladas', [{ chave: 'valor', base: 'valor_imovel' }, { chave: 'saldoAposEntrada', base: 'saldo_apos_entrada' }]);
    const chave = declaredPercentageComponent('chave', 'Parcela na chave', explicit.chave, first.chave.quantidade || 1, 'unica', `Chave (${explicit.chave || 0}%)`, 'fixa') || componentCandidate(samples, 'chave', [{ chave: 'valor', base: 'valor_imovel' }, { chave: 'saldoAposEntrada', base: 'saldo_apos_entrada' }]);
    const mensaisDeclaradas = declaredPercentageComponent('mensais', 'Parcelas mensais', explicit.mensais, first.mensais.quantidade, 'mensal', `Parcelas ${first.mensais.quantidade || ''}x (${explicit.mensais || 0}%)`, 'sugerida');
    const components = [];
    const add = (component, defaults) => { if (!component) return; const priorComponent = priorComponents.get(component.id); const selectedBase = priorComponent?.baseConfirmadaPorRevisao ? (priorComponent.baseCalculo || priorComponent.base) : (component.baseCalculo || component.base); components.push(normalizeRuleComponent({ ...defaults, ...component, natureza: priorComponent?.natureza || component.natureza || defaults.natureza, base: selectedBase, baseCalculo: selectedBase, baseAmbigua: priorComponent?.baseConfirmadaPorRevisao ? false : component.baseAmbigua, baseConfirmadaPorRevisao: Boolean(priorComponent?.baseConfirmadaPorRevisao), origemInterpretacao: priorComponent?.origemInterpretacao || component.origemInterpretacao }, components.length)); };
    add(entrada, { id: 'entrada', nome: 'Entrada', periodicidade: 'unica', natureza: 'minima' });
    if (mensaisDeclaradas) add(mensaisDeclaradas, { id: 'mensais', nome: 'Parcelas mensais', periodicidade: 'mensal', natureza: 'sugerida' });
    add(intercaladas, { id: 'intercaladas', nome: 'Intercaladas', periodicidade: first.intercaladas.periodicidade || 'anual', natureza: 'minima' });
    add(chave, { id: 'chave', nome: 'Parcela na chave', periodicidade: 'unica', natureza: 'fixa' });
    if (!mensaisDeclaradas && first.mensais?.valor != null && first.mensais?.quantidade) add({ id: 'mensais', nome: 'Parcelas mensais', tipo: 'saldo', tipoCalculo: 'residual', base: 'saldo_remanescente', baseCalculo: 'saldo_remanescente', quantidade: first.mensais.quantidade, natureza: 'sugerida', periodicidade: 'mensal', confianca: 100, amostras: samples.length, origemInterpretacao: 'inferida', textoOriginal: 'Parcelas mensais calculadas pelo saldo remanescente', dependencias: components.map((component) => component.id) }, {});
    return { codigo, nome: first.nome, prazoMeses: first.prazoMeses || first.mensais?.quantidade || null, ordem: 1, componentes: components.map((component, index) => normalizeRuleComponent(component, index)) };
  });
  const sightDiscount = declaredSightDiscount(table);
  if (!planos.length && Number.isFinite(sightDiscount) && sightDiscount > 0 && sightDiscount < 100) planos = [{ codigo: 'PLANO_A_VISTA', nome: 'Plano à vista', prazoMeses: 0, ordem: 1, componentes: [normalizeRuleComponent({ id: 'desconto', nome: 'Desconto à vista', tipoCalculo: 'percentual', baseCalculo: 'valor_imovel', percentual: sightDiscount, quantidade: 1, periodicidade: 'unica', natureza: 'fixa', efeito: 'desconto', origemInterpretacao: 'declarada', textoOriginal: `${sightDiscount}% de desconto à vista`, posicaoDocumental: { secao: 'cabecalho_ou_observacao', referencia: `${sightDiscount}% de desconto à vista` }, confianca: 100, amostras: (table.unidades || []).length }, 0), normalizeRuleComponent({ id: 'valor_a_vista', nome: 'Valor à vista', tipoCalculo: 'residual', baseCalculo: 'saldo_remanescente', quantidade: 1, periodicidade: 'unica', natureza: 'fixa', origemInterpretacao: 'derivada', textoOriginal: 'Valor do imóvel menos o desconto publicado', dependencias: ['desconto'], confianca: 100, amostras: (table.unidades || []).length }, 1)] }];
  const totalSamples = planos.reduce((total, plan) => total + Math.max(...plan.componentes.map((component) => component.amostras || 0), 0), 0);
  const confidenceValues = planos.flatMap((plan) => plan.componentes.map((component) => component.confianca).filter(Number.isFinite));
  const estrutura = planos.length > 1 ? 'alternativas' : 'composicao'; const modalidade = commercialModality(table); const origins = new Set(planos.flatMap((plan) => plan.componentes.map((component) => component.origemInterpretacao)));
  return { versaoModelo: 4, status: 'atencao', editada: Boolean(previousRule?.editada), origemInterpretacao: origins.size === 1 ? ([...origins][0] || 'inferida') : 'mista', metodo: 'interpretacao_documental_e_validacao_em_massa', geradaEm: now(), modalidade, identidade: { empreendimentoId: String((table.unidades || [])[0]?.chave || '').split(':')[0] || null, modalidade: modalidade.codigo, versao: table.id }, estrutura, confianca: { percentual: confidenceValues.length ? Math.round(average(confidenceValues)) : 0, amostras: totalSamples, justificativa: 'Cabeçalhos declarados prevalecem; as hipóteses restantes são comparadas em massa entre as unidades.' }, planos };
}
function reconcileCommercialRule(table, rule) {
  let conformes = 0; let divergentes = 0;
  const rulesByCode = new Map(rule.planos.map((plan) => [plan.codigo, plan]));
  for (const unit of table.unidades || []) {
    unit.alertasFinanceiros = [];
    const price = unitValue(unit); if (!price) continue;
    for (const declared of declaredPlans(unit)) {
      const planRule = rulesByCode.get(declared.codigo); if (!planRule) continue;
      const calculated = calculatedComponents(planRule, price); const byId = new Map(calculated.map((component) => [component.id, component]));
      const declaredComponents = [{ id: 'entrada', quantidade: 1, valor: declared.entrada }, { id: 'intercaladas', ...declared.intercaladas }, { id: 'chave', ...declared.chave }, { id: 'mensais', ...declared.mensais }].filter((component) => component.valor != null && component.quantidade);
      const declaredTotal = declaredComponents.reduce((total, component) => total + (Number(component.valor) * Number(component.quantidade)), 0);
      const tolerance = 0.01 * declaredComponents.reduce((total, component) => total + Number(component.quantidade), 0) + 0.01;
      const differences = declaredComponents.map((component) => { const expected = byId.get(component.id); const declaredValue = Number(component.valor) * Number(component.quantidade); return { componente: component.id, declarado: declaredValue, calculado: expected?.total ?? null, desvio: expected ? declaredValue - expected.total : null }; });
      const conforme = Math.abs(price - declaredTotal) <= tolerance && differences.every((difference) => difference.calculado != null && Math.abs(difference.desvio) <= tolerance);
      const payload = { status: conforme ? 'conforme' : 'divergente', declaradoTotal: declaredTotal, valorImovel: price, tolerancia: tolerance, diferencaTotal: price - declaredTotal, componentes: differences, valoresDerivados: calculated };
      if (declared.referencia) { delete declared.referencia.conciliação; declared.referencia.conciliacao = payload; }
      if (conforme) conformes += 1; else { divergentes += 1; unit.alertasFinanceiros.push({ plano: declared.nome, codigo: declared.codigo, diferenca: price - declaredTotal, tolerancia: tolerance, mensagem: `${declared.nome}: a soma publicada não fecha com o valor do imóvel.` }); }
    }
    if (!declaredPlans(unit).length) for (const planRule of rule.planos || []) if (planRule.componentes?.some((component) => component.efeito === 'desconto')) {
      const calculated = calculatedComponents(planRule, price), valueAtSight = calculated.find((component) => component.id === 'valor_a_vista')?.total ?? null;
      const payload = { status: valueAtSight != null && valueAtSight >= 0 ? 'conforme' : 'divergente', declaradoTotal: null, valorImovel: price, valorComercial: valueAtSight, tolerancia: 0.01, diferencaTotal: 0, componentes: [], valoresDerivados: calculated, observacao: 'Valor final derivado de desconto explicitamente publicado; não há valor final declarado para comparar.' };
      unit.valoresDerivadosComerciais = unit.valoresDerivadosComerciais || {}; unit.valoresDerivadosComerciais[planRule.codigo] = payload;
      if (payload.status === 'conforme') conformes += 1; else divergentes += 1;
    }
  }
  rule.conciliacao = { conformes, divergentes, total: conformes + divergentes, status: divergentes ? 'divergencia' : (conformes ? 'validado_automaticamente' : 'sem_dados') };
  rule.status = divergentes ? 'divergencia' : (hasAmbiguousCommercialBase({ regraInterpretada: rule }) ? 'atencao' : (conformes ? 'validado_automaticamente' : 'sem_dados'));
  table.regraInterpretada = rule;
  table.modalidadesComerciais = rule.planos.length ? [{ ...rule.modalidade, estrutura: rule.estrutura, status: rule.status, origemInterpretacao: rule.origemInterpretacao, editada: rule.editada, quantidadePlanos: rule.planos.length, planos: rule.planos.map((plan) => ({ codigo: plan.codigo, nome: plan.nome, prazoMeses: plan.prazoMeses })), conciliacao: rule.conciliacao }] : [];
  return rule;
}
function applyCommercialRule(table, resetStatus = false) {
  const prior = Number(table.regraInterpretada?.versaoModelo || 0) >= 3 ? table.regraInterpretada : null;
  return reconcileCommercialRule(table, inferCommercialRule(table, prior));
}
function normalizeDeclaredPaymentPlans(table) {
  for (const unit of table.unidades || []) for (const plan of unit.condicoes?.planos || []) {
    if (Number(plan.mensal?.parcelas) === 1 && Number(plan.meses) > 1) plan.mensal.parcelas = Number(plan.meses);
    if (plan.mensal?.intercaladasAnuais && !plan.mensal.intercaladasAnuais.periodicidade) plan.mensal.intercaladasAnuais.periodicidade = 'anual';
  }
}
function applyRuleNatureOverrides(table, overrides) {
  if (!Array.isArray(overrides)) return;
  const plans = new Map((table.regraInterpretada?.planos || []).map((plan) => [plan.codigo, plan]));
  for (const override of overrides) {
    const component = plans.get(String(override.plano || ''))?.componentes?.find((item) => item.id === String(override.componente || ''));
    if (component && ['fixa', 'minima', 'sugerida'].includes(override.natureza)) { component.natureza = override.natureza; component.origemInterpretacao = 'editada'; table.regraInterpretada.editada = true; }
  }
}
function applyRuleBaseOverrides(table, overrides) {
  if (!Array.isArray(overrides)) return;
  const plans = new Map((table.regraInterpretada?.planos || []).map((plan) => [plan.codigo, plan]));
  for (const override of overrides) {
    const component = plans.get(String(override.plano || ''))?.componentes?.find((item) => item.id === String(override.componente || ''));
    if (component && (component.alternativasBase?.includes(override.base) || ['valor_imovel', 'saldo_apos_entrada', 'saldo_apos_componente', 'saldo_remanescente'].includes(override.base))) { component.base = override.base; component.baseCalculo = override.base; component.baseAmbigua = false; component.baseConfirmadaPorRevisao = true; component.origemInterpretacao = 'editada'; table.regraInterpretada.editada = true; }
  }
}
function hasAmbiguousCommercialBase(table) { return (table.regraInterpretada?.planos || []).some((plan) => (plan.componentes || []).some((component) => component.baseAmbigua)); }
function applyCommercialRuleEdits(table, payload) {
  const rule = table.regraInterpretada; if (!rule?.planos?.length) throw new Error('Não há condições comerciais para editar.');
  const plans = new Map(rule.planos.map((plan) => [plan.codigo, plan]));
  for (const change of payload?.componentes || []) {
    const plan = plans.get(String(change.plano || '')); const component = plan?.componentes?.find((item) => item.id === String(change.componente || ''));
    if (!component) throw new Error('Um componente informado não pertence a esta versão comercial.');
    if (change.tipoCalculo != null) {
      if (!['valor_fixo', 'percentual', 'residual'].includes(change.tipoCalculo)) throw new Error('Tipo de cálculo inválido.');
      component.tipoCalculo = change.tipoCalculo; component.tipo = change.tipoCalculo === 'residual' ? 'saldo' : change.tipoCalculo;
    }
    if (change.baseCalculo != null) {
      if (!['valor_imovel', 'saldo_apos_entrada', 'saldo_apos_componente', 'saldo_remanescente'].includes(change.baseCalculo)) throw new Error('Base de cálculo inválida.');
      component.baseCalculo = change.baseCalculo; component.base = change.baseCalculo; component.baseAmbigua = false; component.baseConfirmadaPorRevisao = true;
    }
    if (change.natureza != null) {
      if (!['fixa', 'minima', 'sugerida'].includes(change.natureza)) throw new Error('Natureza comercial inválida.');
      component.natureza = change.natureza;
    }
    if (change.percentual != null && change.percentual !== '') { const value = Number(change.percentual); if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Percentual inválido.'); component.percentual = value; }
    if (change.valor != null && change.valor !== '') { const value = Number(change.valor); if (!Number.isFinite(value) || value < 0) throw new Error('Valor fixo inválido.'); component.valor = value; }
    if (change.quantidade != null && change.quantidade !== '') { const value = Number(change.quantidade); if (!Number.isInteger(value) || value < 1) throw new Error('Quantidade inválida.'); component.quantidade = value; if (component.id === 'mensais') plan.prazoMeses = value; }
    if (change.periodicidade != null) component.periodicidade = String(change.periodicidade || 'unica').slice(0, 40);
    component.origemInterpretacao = 'editada'; component.editadaEm = now();
  }
  rule.editada = true; rule.origemInterpretacao = 'editada'; rule.editadaEm = now();
  return reconcileCommercialRule(table, rule);
}
function eventMoment(event) {
  const value = event.at || event.validade || event.confirmadoEm || '';
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0;
}
function historyEvent(unit, event) {
  const history = [...(unit.historicoEventos || unit.historicoSituacao || [])];
  const index = history.findIndex((item) => item.eventKey === event.eventKey);
  if (index === -1) history.push(event); else history[index] = { ...history[index], ...event };
  return history.sort((a, b) => eventMoment(a) - eventMoment(b) || Date.parse(a.confirmadoEm || 0) - Date.parse(b.confirmadoEm || 0) || String(a.eventKey).localeCompare(String(b.eventKey)));
}
function withCentralHistory(unit, event) {
  const history = historyEvent(unit, event);
  return { ...unit, historicoEventos: history, historicoSituacao: history.filter((item) => (item.tipo || 'situacao') === 'situacao') };
}
function currentStatusEvent(unit) {
  const events = (unit.historicoEventos || unit.historicoSituacao || []).filter((item) => (item.tipo || 'situacao') === 'situacao' && item.situacao);
  return events.length ? [...events].sort((a, b) => eventMoment(a) - eventMoment(b) || Date.parse(a.confirmadoEm || 0) - Date.parse(b.confirmadoEm || 0)).at(-1) : null;
}
function applyCurrentStatusFromHistory(unit) {
  const event = currentStatusEvent(unit); if (!event) return unit;
  return { ...unit, situacaoComercial: normalizeUnitStatus(event.situacao), situacaoExtraida: normalizeUnitStatus(event.situacao), situacaoOrigem: event.origem || 'tabela_confirmada', tabelaStatusAtualId: event.tabelaId || null, situacaoAtualizadaEm: event.at || event.validade || unit.situacaoAtualizadaEm || null, updatedAt: event.at || unit.updatedAt };
}
function recordStandardValue(unit, sourceUnit, table) {
  const value = unitValue(sourceUnit); if (value === null) return unit;
  const at = table.validityDate ? `${table.validityDate}T00:00:00.000Z` : (table.validatedAt || table.updatedAt || now());
  const event = { eventKey: `value:${table.id}:${unit.chave}`, tipo: 'valor', at, confirmadoEm: table.validatedAt || table.updatedAt || null, tabelaId: table.id, validade: table.validityDate, valor: value, origem: 'tabela_padrao' };
  return withCentralHistory(unit, event);
}
function applyCurrentValueFromHistory(unit, standardTableIds) {
  const event = [...(unit.historicoEventos || [])].filter((item) => item.tipo === 'valor' && standardTableIds.has(item.tabelaId)).sort((a, b) => eventMoment(a) - eventMoment(b) || Date.parse(a.confirmadoEm || 0) - Date.parse(b.confirmadoEm || 0)).at(-1);
  if (!event) return { ...unit, valorAtual: null, valorTabelaId: null, valorAtualizadoEm: null, valorExtraido: null, valorInterpretado: null, valorValidado: null };
  return { ...unit, valorAtual: event.valor, valorTabelaId: event.tabelaId, valorAtualizadoEm: event.at, valorExtraido: event.valor, valorInterpretado: event.valor, valorValidado: event.valor };
}
function centralFromSource(existing, unit, table, status, origin = 'tabela_confirmada') {
  const at = table.validityDate ? `${table.validityDate}T00:00:00.000Z` : (table.validatedAt || table.updatedAt || now());
  const event = { eventKey: `table:${table.id}:${unit.chave}:${status}`, tipo: 'situacao', at, confirmadoEm: table.validatedAt || table.updatedAt || null, tabelaId: table.id, validade: table.validityDate, situacao: status, origem: origin };
  const currentValue = unitValue(unit);
  const record = {
    ...existing,
    chave: unit.chave,
    bloco: unit.quadra || existing?.bloco || '',
    unidade: unit.unidade || existing?.unidade || '',
    descricaoExtraida: unit.descricaoExtraida ?? existing?.descricaoExtraida ?? null,
    areaPrivativa: unit.areaPrivativa ?? existing?.areaPrivativa ?? null,
    vagas: unit.vagas ?? existing?.vagas ?? null,
    situacaoComercial: status,
    situacaoExtraida: status,
    situacaoOrigem: origin,
    tabelaStatusAtualId: table.id,
    situacaoAtualizadaEm: at,
    valorAtual: currentValue ?? existing?.valorAtual ?? null,
    valorTabelaId: currentValue !== null ? table.id : existing?.valorTabelaId || null,
    valorAtualizadoEm: currentValue !== null ? at : existing?.valorAtualizadoEm || null,
    valorExtraido: currentValue ?? existing?.valorExtraido ?? null,
    valorInterpretado: currentValue ?? existing?.valorInterpretado ?? null,
    valorValidado: currentValue ?? existing?.valorValidado ?? null,
    createdFromTableId: existing?.createdFromTableId || table.id,
    updatedAt: at
  };
  return withCentralHistory(record, event);
}
function previousSourceTable(empreendimento, table) { return previousRegisteredTable(empreendimento, table); }
function hotPointId(tableId, key) { return `HOT:${tableId}:${key}`; }
function ensureHotPoint(empreendimento, table, previous, sourceUnit, createdAt = null) {
  empreendimento.pontosQuentes = empreendimento.pontosQuentes || [];
  const id = hotPointId(table.id, sourceUnit.chave); let point = empreendimento.pontosQuentes.find((item) => item.id === id);
  if (!point) {
    point = { id, tipo: 'UNIDADE_AUSENTE', status: 'aberto', criticidade: 'critico', chave: sourceUnit.chave, bloco: sourceUnit.quadra || '', unidade: sourceUnit.unidade || '', situacaoAnterior: normalizeUnitStatus(sourceUnit.situacaoExtraida), empreendimentoId: empreendimento.id, tabelaAnteriorId: previous.id, tabelaId: table.id, createdAt: createdAt || table.validatedAt || table.updatedAt || now(), updatedAt: createdAt || now() };
    empreendimento.pontosQuentes.push(point);
  }
  return point;
}
function resolveHotPoint(empreendimento, table, key, status, observation = '', at = now()) {
  const point = (empreendimento.pontosQuentes || []).find((item) => item.id === hotPointId(table.id, key));
  if (point) Object.assign(point, { status: 'resolvido', situacaoDefinida: status, observacao: observation, resolvedAt: at, updatedAt: at });
}
function applyCentralStatus(empreendimento, key, status, detail = {}) {
  const catalog = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])); const current = catalog.get(key);
  if (!current) throw new Error('Unidade não encontrada no Cadastro Central.');
  const at = detail.at || now(); const next = normalizeUnitStatus(status);
  const event = { eventKey: detail.eventKey || `manual:${key}:${at}`, tipo: 'situacao', at, tabelaId: detail.tableId || null, validade: detail.validityDate || null, situacao: next, situacaoAnterior: current.situacaoComercial || null, origem: detail.origin || 'edicao_manual', confirmadoPor: detail.confirmadoPor || null, pontoQuenteId: detail.pontoQuenteId || null, observacao: String(detail.observacao || '') };
  const updated = applyCurrentStatusFromHistory(withCentralHistory(current, event));
  catalog.set(key, updated); empreendimento.unidades = [...catalog.values()]; return updated;
}
function standardTableType(empreendimento, tables) {
  const explicit = tables.find((table) => table.id === (empreendimento.tabelaBaseId || empreendimento.tabelaPadraoTableId)); return explicit?.tipoTabela || empreendimento.tabelaPadraoTipo || tables.at(-1)?.tipoTabela || null;
}
function rebuildCentralCatalog(empreendimento) {
  const tables = sortTables(empreendimento.tabelas || []).sort((a, b) => String(a.validityDate || '').localeCompare(String(b.validityDate || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || ((a.id === empreendimento.tabelaBaseId ? 1 : 0) - (b.id === empreendimento.tabelaBaseId ? 1 : 0)) || String(a.id).localeCompare(String(b.id)));
  const sourceKeys = new Set(tables.flatMap((table) => (table.unidades || []).map((unit) => unit.chave)));
  const activeTableIds = new Set(tables.map((table) => table.id));
  empreendimento.pontosQuentes = (empreendimento.pontosQuentes || []).filter((point) => (!point.tabelaId || activeTableIds.has(point.tabelaId)) && (!point.tabelaAnteriorId || activeTableIds.has(point.tabelaAnteriorId)));
  const existing = new Map((empreendimento.unidades || []).filter((unit) => sourceKeys.has(unit.chave)).map((unit) => {
    const history = (unit.historicoEventos || []).filter((event) => (!event.tabelaId || activeTableIds.has(event.tabelaId)) && (!event.tabelaAnteriorId || activeTableIds.has(event.tabelaAnteriorId)) && !['ausencia_assumida_venda', 'ausencia_na_fotografia'].includes(event.origem));
    return [unit.chave, { ...unit, historicoEventos: history, historicoSituacao: history.filter((event) => (event.tipo || 'situacao') === 'situacao') }];
  })); const catalog = new Map(existing);
  for (const table of tables) for (const unit of table.unidades || []) {
    const current = catalog.get(unit.chave); const status = normalizeUnitStatus(unit.situacaoExtraida);
    catalog.set(unit.chave, centralFromSource(current, unit, table, status));
  }
  empreendimento.unidades = [...catalog.values()];
  const commercialType = standardTableType(empreendimento, tables);
  const standardTables = commercialType ? tables.filter((table) => table.tipoTabela === commercialType) : [];
  const standardTableIds = new Set(standardTables.map((table) => table.id));
  if (standardTables.length) {
    const catalogByKey = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit]));
    for (const [key, initial] of catalogByKey) {
      let record = initial;
      for (const table of standardTables) {
        const sourceUnit = (table.unidades || []).find((unit) => unit.chave === key);
        if (sourceUnit) record = recordStandardValue(record, sourceUnit, table);
      }
      catalogByKey.set(key, applyCurrentValueFromHistory(record, standardTableIds));
    }
    empreendimento.unidades = [...catalogByKey.values()];
  }
  const base = tables.find((table) => table.id === (empreendimento.tabelaBaseId || empreendimento.tabelaPadraoTableId)); const baseUnits = new Map((base?.unidades || []).map((unit) => [unit.chave, unit]));
  empreendimento.unidades = (empreendimento.unidades || []).map((unit) => {
    const source = baseUnits.get(unit.chave); if (!source) return { ...unit, origemEstruturalTabelaId: unit.origemEstruturalTabelaId || unit.createdFromTableId };
    return { ...unit, bloco: source.quadra || unit.bloco, unidade: source.unidade || unit.unidade, descricaoExtraida: source.descricaoExtraida ?? unit.descricaoExtraida, areaPrivativa: source.areaPrivativa ?? unit.areaPrivativa, vagas: source.vagas ?? unit.vagas, origemEstruturalTabelaId: base.id };
  });
  for (const table of tables) {
    const previous = previousSourceTable(empreendimento, table); if (!previous) continue;
    const currentKeys = new Set((table.unidades || []).map((unit) => unit.chave));
    for (const sourceUnit of previous.unidades || []) if (!currentKeys.has(sourceUnit.chave)) {
      const classification = table.classificacoesRemocao?.[sourceUnit.chave];
      if (classification?.status && classification.status !== 'PENDENTE') {
        const resolved = removalStatusToUnitStatus(classification.status);
        // A classificação confirma o que a fotografia já demonstrava. O marco
        // cronológico é a validade da tabela, não o instante posterior em que
        // ela foi revisada; assim uma unidade reapresentada na fotografia
        // seguinte volta corretamente ao saldo atual.
        const at = table.validityDate ? `${table.validityDate}T00:00:00.000Z` : (classification.at || table.validatedAt || now());
        let record = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])).get(sourceUnit.chave) || centralFromSource(null, sourceUnit, previous, normalizeUnitStatus(sourceUnit.situacaoExtraida));
        const point = ensureHotPoint(empreendimento, table, previous, sourceUnit, at);
        const event = { eventKey: `absence:${table.id}:${sourceUnit.chave}:${resolved}`, tipo: 'situacao', at, confirmadoEm: classification.at || table.validatedAt || table.updatedAt || null, tabelaId: table.id, tabelaAnteriorId: previous.id, validade: table.validityDate, situacao: resolved, situacaoAnterior: record.situacaoComercial || normalizeUnitStatus(sourceUnit.situacaoExtraida), origem: 'ausencia_confirmada', pontoQuenteId: point.id, observacao: String(classification.observacao || '') };
        record = applyCurrentStatusFromHistory(withCentralHistory(record, event));
        const nextCatalog = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])); nextCatalog.set(sourceUnit.chave, record); empreendimento.unidades = [...nextCatalog.values()];
        resolveHotPoint(empreendimento, table, sourceUnit.chave, resolved, classification.observacao || '', at);
      } else {
        // Ausência é apenas ausência na fotografia: não prova venda, não
        // alimenta IVV/VSO e permanece como pendência de conciliação.
        const point = ensureHotPoint(empreendimento, table, previous, sourceUnit);
        const at = table.validityDate ? `${table.validityDate}T00:00:00.000Z` : (table.validatedAt || table.updatedAt || now());
        let record = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])).get(sourceUnit.chave) || centralFromSource(null, sourceUnit, previous, normalizeUnitStatus(sourceUnit.situacaoExtraida));
        const event = {
          eventKey: `absence:${table.id}:${sourceUnit.chave}:Ausente:pendente`,
          tipo: 'situacao',
          at,
          tabelaId: table.id,
          tabelaAnteriorId: previous.id,
          validade: table.validityDate,
          situacao: 'Ausente',
          situacaoAnterior: record.situacaoComercial || normalizeUnitStatus(sourceUnit.situacaoExtraida),
          origem: 'ausencia_na_fotografia',
          pontoQuenteId: point.id,
          observacao: 'Unidade não publicada na fotografia atual; ausência pendente de classificação e sem conversão automática em venda.'
        };
        record = applyCurrentStatusFromHistory(withCentralHistory(record, event));
        const nextCatalog = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit]));
        nextCatalog.set(sourceUnit.chave, record);
        empreendimento.unidades = [...nextCatalog.values()];
      }
    }
  }
  empreendimento.unidades = (empreendimento.unidades || []).map(applyCurrentStatusFromHistory);
  return empreendimento.unidades;
}
function syncPhysicalUnits(empreendimento, table) { rebuildCentralCatalog(empreendimento); return table; }
function projectedPhysicalUnits(empreendimento) { return [...(empreendimento.unidades || [])]; }
function snapshotOrder(a, b) {
  return String(a?.validityDate || '').localeCompare(String(b?.validityDate || '')) || String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')) || String(a?.id || '').localeCompare(String(b?.id || ''));
}
function calendarMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/); if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]); return month >= 1 && month <= 12 ? { key: `${match[1]}-${match[2]}`, year, month, index: year * 12 + month } : null;
}
function calendarMonthDifference(initial, final) {
  const start = calendarMonth(initial), end = calendarMonth(final); return start && end ? end.index - start.index : null;
}
function coveredCalendarMonths(initial, final) {
  const start = calendarMonth(initial), end = calendarMonth(final); if (!start || !end || end.index <= start.index) return [];
  const result = []; for (let index = start.index + 1; index <= end.index; index++) { const year = Math.floor((index - 1) / 12), month = ((index - 1) % 12) + 1; result.push(`${year}-${String(month).padStart(2, '0')}`); } return result;
}
function monthlySnapshotGroups(tables) {
  const groups = new Map();
  for (const table of sortTables(tables).sort(snapshotOrder)) {
    const month = calendarMonth(table.validityDate); if (!month) continue;
    const key = `${table.tipoTabela}:${month.key}`; if (!groups.has(key)) groups.set(key, { modalidade: table.tipoTabela, mes: month.key, fotografias: [] }); groups.get(key).fotografias.push(table);
  }
  return [...groups.values()].map((group) => ({ ...group, fotografias: group.fotografias.sort(snapshotOrder), fechamento: group.fotografias.sort(snapshotOrder).at(-1) })).sort((left, right) => left.mes.localeCompare(right.mes) || left.modalidade.localeCompare(right.modalidade));
}
function manualSaleFacts(empreendimento) {
  const tables = new Map((empreendimento.tabelas || []).map((table) => [table.id, table]));
  return (empreendimento.unidades || []).map((unit) => {
    const event = currentStatusEvent(unit), table = (event?.tabelaId ? tables.get(event.tabelaId) : null) || sortTables(empreendimento.tabelas || []).filter((candidate) => (candidate.unidades || []).some((candidateUnit) => candidateUnit.chave === unit.chave)).at(-1) || null;
    if (!event || event.origem !== 'edicao_manual' || event.situacao !== 'Vendida' || !table) return null;
    return historicalFact(empreendimento, 'VENDA_IDENTIFICADA', table, null, unit, { origem: 'edicao_manual', confirmado: true, confirmadoPor: event.confirmadoPor || 'usuario', confirmadoEm: event.at || table.updatedAt || table.createdAt, evidencia: 'situação operacional confirmada manualmente' });
  }).filter(Boolean);
}
function factId(...parts) { return `FAT-${crypto.createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 20).toUpperCase()}`; }
function stableRulePlan(plan) {
  return JSON.stringify({ codigo: plan?.codigo || '', prazoMeses: plan?.prazoMeses || null, componentes: (plan?.componentes || []).map((component) => ({ id: component.id, tipoCalculo: component.tipoCalculo || component.tipo, baseCalculo: component.baseCalculo || component.base, natureza: component.natureza, percentual: component.percentual ?? null, valor: component.valor ?? null, quantidade: component.quantidade ?? 1, periodicidade: component.periodicidade || 'unica', ordem: component.ordem ?? null, dependencias: component.dependencias || [] })) });
}
function historicalFact(empreendimento, type, table, previous, unit, detail = {}) {
  const unitKey = unit?.chave || detail.unidadeChave || null; const plan = detail.plano || null;
  return {
    id: factId(empreendimento.id, type, previous?.id, table.id, unitKey, plan), tipo: type, empreendimentoId: empreendimento.id, unidadeChave: unitKey,
    modalidade: table.tipoTabela, plano: plan, tabelaAnteriorId: previous?.id || null, tabelaAtualId: table.id, dataValidade: table.validityDate,
    origem: detail.origem || 'comparacao_automatica', confirmado: detail.confirmado ?? true, confirmadoPor: detail.confirmadoPor || (detail.confirmado === false ? null : 'sistema'), confirmadoEm: detail.confirmado === false ? null : (detail.confirmadoEm || table.validatedAt || table.updatedAt || table.createdAt),
    createdAt: table.validatedAt || table.updatedAt || table.createdAt, ...detail
  };
}
function snapshotComparison(empreendimento, previous, current, earlierTables = []) {
  const prior = new Map((previous?.unidades || []).map((unit) => [unit.chave, unit])); const after = new Map((current?.unidades || []).map((unit) => [unit.chave, unit]));
  const seenBefore = new Set(earlierTables.flatMap((table) => (table.unidades || []).map((unit) => unit.chave))); const novas = [], retornadas = [], removidas = [], alteracoesValor = [], alteracoesStatus = [], facts = [], comparableAdjustments = [];
  for (const unit of current.unidades || []) {
    const priorUnit = prior.get(unit.chave);
    if (!priorUnit) {
      if (seenBefore.has(unit.chave)) retornadas.push(unit.chave); else {
        novas.push(unit.chave); facts.push(historicalFact(empreendimento, 'UNIDADE_NOVA', current, previous, unit, { statusAtual: normalizeUnitStatus(unit.situacaoExtraida), valorAtual: unitValue(unit) }));
      }
      continue;
    }
    const priorStatus = normalizeUnitStatus(priorUnit.situacaoExtraida), currentStatus = normalizeUnitStatus(unit.situacaoExtraida); const priorValue = unitValue(priorUnit), currentValue = unitValue(unit);
    if (priorStatus !== currentStatus) {
      alteracoesStatus.push({ chave: unit.chave, anterior: priorStatus, atual: currentStatus });
      facts.push(historicalFact(empreendimento, 'ALTERACAO_STATUS', current, previous, unit, { statusAnterior: priorStatus, statusAtual: currentStatus }));
      if (currentStatus === 'Vendida' && priorStatus !== 'Vendida') facts.push(historicalFact(empreendimento, 'VENDA_IDENTIFICADA', current, previous, unit, { statusAnterior: priorStatus, statusAtual: currentStatus, origem: 'status_publicado' }));
    }
    if (priorValue !== null && currentValue !== null) {
      const delta = currentValue - priorValue, priorArea = Number(priorUnit.areaPrivativa || priorUnit.areaTotal || 0), currentArea = Number(unit.areaPrivativa || unit.areaTotal || 0);
      const hasComparableArea = priorArea > 0 && currentArea > 0 && Math.abs(currentArea - priorArea) / priorArea <= 0.01;
      const hasNoArea = priorArea <= 0 && currentArea <= 0;
      const aggregateSimulatedBase = current?.reconciliacaoEstrutural?.precoBase === 'SIMULADO' && current.reconciliacaoEstrutural?.tabelaZeroId === previous?.id;
      const metric = hasComparableArea ? 'PRECO_M2' : aggregateSimulatedBase ? 'PRECO_UNIDADE_BASE_SIMULADA' : 'PRECO_UNIDADE';
      const priorMetric = hasComparableArea ? priorValue / priorArea : priorValue, currentMetric = hasComparableArea ? currentValue / currentArea : currentValue;
      const percent = priorMetric > 0 ? (currentMetric - priorMetric) / priorMetric : null;
      const comparable = priorStatus === 'Disponível' && currentStatus === 'Disponível' && (hasComparableArea || hasNoArea || aggregateSimulatedBase) && Number.isFinite(percent);
      if (delta !== 0) {
        const change = { chave: unit.chave, anterior: priorValue, atual: currentValue, valorReajuste: delta, percentualReajuste: percent, metricaReajuste: metric, origemReajuste: aggregateSimulatedBase ? 'BASE_SIMULADA_ESTRUTURAL' : 'COMPARACAO_UNIDADE', direcao: delta < 0 ? 'reducao' : 'aumento', comparavelReajuste: comparable, divergenciaRelevante: Number.isFinite(percent) ? Math.abs(percent) >= 0.1 : false };
        alteracoesValor.push(change); facts.push(historicalFact(empreendimento, 'REAJUSTE_PRECO', current, previous, unit, { valorAnterior: priorValue, valorAtual: currentValue, valorReajuste: delta, percentualReajuste: percent, metricaReajuste: metric, statusAnterior: priorStatus, statusAtual: currentStatus, comparavelReajuste: comparable }));
        if (comparable) comparableAdjustments.push(change);
      } else if (comparable) comparableAdjustments.push({ chave: unit.chave, anterior: priorValue, atual: currentValue, valorReajuste: 0, percentualReajuste: 0, metricaReajuste: metric, comparavelReajuste: true });
    }
  }
  for (const unit of previous?.unidades || []) if (!after.has(unit.chave)) {
    removidas.push(unit.chave); const classification = current.classificacoesRemocao?.[unit.chave] || null;
    facts.push(historicalFact(empreendimento, 'UNIDADE_AUSENTE', current, previous, unit, { statusAnterior: normalizeUnitStatus(unit.situacaoExtraida), statusAtual: null, valorAnterior: unitValue(unit), confirmado: false, classificacao: classification?.status || 'PENDENTE' }));
    if (classification?.status === 'VENDIDA') facts.push(historicalFact(empreendimento, 'VENDA_IDENTIFICADA', current, previous, unit, { statusAnterior: normalizeUnitStatus(unit.situacaoExtraida), statusAtual: 'Vendida', origem: 'ausencia_confirmada', confirmadoPor: classification.usuario || 'usuario', confirmadoEm: classification.at || current.updatedAt }));
  }
  const oldPlans = new Map((previous?.regraInterpretada?.planos || []).map((plan) => [plan.codigo, plan]));
  for (const plan of current.regraInterpretada?.planos || []) {
    const priorPlan = oldPlans.get(plan.codigo); if (previous && stableRulePlan(priorPlan) !== stableRulePlan(plan)) facts.push(historicalFact(empreendimento, 'ALTERACAO_CONDICAO', current, previous, null, { plano: plan.codigo, regraAnterior: priorPlan ? stableRulePlan(priorPlan) : null, regraAtual: stableRulePlan(plan) }));
  }
  const percentages = comparableAdjustments.map((item) => item.percentualReajuste).filter(Number.isFinite); const values = comparableAdjustments.map((item) => item.valorReajuste).filter(Number.isFinite);
  const resumoReajuste = { unidadesComparaveis: comparableAdjustments.length, unidadesReajustadas: comparableAdjustments.filter((item) => item.valorReajuste !== 0).length, unidadesSemAlteracao: comparableAdjustments.filter((item) => item.valorReajuste === 0).length, reajusteMedioPercentual: average(percentages), reajusteMedioValor: average(values), maiorReajustePercentual: percentages.length ? Math.max(...percentages) : null, menorReajustePercentual: percentages.length ? Math.min(...percentages) : null, impactoVgv: sum(values), origem: current?.reconciliacaoEstrutural?.precoBase === 'SIMULADO' && current.reconciliacaoEstrutural?.tabelaZeroId === previous?.id ? 'BASE_SIMULADA_ESTRUTURAL' : 'COMPARACAO_UNIDADE' };
  return { previousTableId: previous?.id || null, novas, removidas, retornadas, alteracoesValor, alteracoesStatus, alteracoesComerciais: facts.filter((fact) => fact.tipo === 'ALTERACAO_CONDICAO').map((fact) => ({ plano: fact.plano, fatoId: fact.id })), ausentesTratadas: Object.keys(current.classificacoesRemocao || {}).filter((key) => removidas.includes(key)), resumoReajuste, facts };
}
function rebuildCommercialHistory(empreendimento, options = {}) {
  const all = [...(empreendimento.tabelas || [])].sort(snapshotOrder); const registered = sortTables(all); const generated = [], intervals = [];
  const modalities = [...new Set(all.map((table) => table.tipoTabela))];
  for (const modality of modalities) {
    const chain = registered.filter((table) => table.tipoTabela === modality).sort(snapshotOrder); const groups = monthlySnapshotGroups(chain); const knownStatus = new Map(); let previousGroup = null;
    for (const group of groups) {
      const closing = group.fechamento; const previousClosing = previousGroup?.fechamento || null; const earlier = chain.filter((candidate) => snapshotOrder(candidate, closing) < 0); const baseComparison = snapshotComparison(empreendimento, previousClosing, closing, earlier);
      const facts = baseComparison.facts.filter((fact) => fact.tipo !== 'VENDA_IDENTIFICADA'); const saleEvidence = new Map();
      if (previousGroup) for (const table of group.fotografias) {
        const priorUnits = new Map((previousClosing?.unidades || []).map((unit) => [unit.chave, unit]));
        for (const unit of table.unidades || []) {
          const status = normalizeUnitStatus(unit.situacaoExtraida || unit.situacaoPublicada); const priorStatus = knownStatus.get(unit.chave);
          if (status === 'Vendida' && priorStatus !== 'Vendida' && !saleEvidence.has(unit.chave)) saleEvidence.set(unit.chave, { unit, origem: 'situacao_revisada', fotografias: [table.id], confirmadoPor: 'sistema', confirmadoEm: table.validatedAt || table.updatedAt || table.createdAt });
          else if (status === 'Vendida' && saleEvidence.has(unit.chave)) saleEvidence.get(unit.chave).fotografias.push(table.id);
        }
        for (const [key, classification] of Object.entries(table.classificacoesRemocao || {})) if (classification?.status === 'VENDIDA' && knownStatus.get(key) !== 'Vendida') {
          const evidence = saleEvidence.get(key); if (evidence) { evidence.fotografias.push(table.id); evidence.origem = evidence.origem === 'status_publicado' ? 'status_publicado_e_ausencia_confirmada' : 'ausencia_confirmada'; }
          else saleEvidence.set(key, { unit: priorUnits.get(key) || { chave: key }, origem: 'ausencia_confirmada', fotografias: [table.id], confirmadoPor: classification.usuario || 'usuario', confirmadoEm: classification.at || table.updatedAt });
        }
        for (const unit of table.unidades || []) knownStatus.set(unit.chave, normalizeUnitStatus(unit.situacaoExtraida || unit.situacaoPublicada));
        for (const [key, classification] of Object.entries(table.classificacoesRemocao || {})) if (classification?.status && classification.status !== 'PENDENTE') knownStatus.set(key, removalStatusToUnitStatus(classification.status));
      } else for (const table of group.fotografias) for (const unit of table.unidades || []) knownStatus.set(unit.chave, normalizeUnitStatus(unit.situacaoExtraida || unit.situacaoPublicada));
      for (const [key, evidence] of saleEvidence) facts.push(historicalFact(empreendimento, 'VENDA_IDENTIFICADA', closing, previousClosing, evidence.unit, { unidadeChave: key, statusAnterior: null, statusAtual: 'Vendida', origem: evidence.origem, confirmado: true, confirmadoPor: evidence.confirmadoPor, confirmadoEm: evidence.confirmadoEm, fotografiasEvidenciaIds: [...new Set(evidence.fotografias)] }));
      closing.comparacao = { ...baseComparison, vendasConfirmadas: saleEvidence.size, fotografiasEvidenciaIds: group.fotografias.map((table) => table.id) }; delete closing.comparacao.facts; closing.fatosGeradosIds = facts.map((fact) => fact.id); generated.push(...facts);
      for (const table of group.fotografias.filter((candidate) => candidate.id !== closing.id)) { const preview = snapshotComparison(empreendimento, previousClosing, table, earlier); table.comparacao = { ...preview, consolidadaNoFechamentoId: closing.id, mesmaCompetencia: true }; delete table.comparacao.facts; table.fatosGeradosIds = []; }
      if (previousClosing) {
        const months = calendarMonthDifference(previousClosing.validityDate, closing.validityDate), sales = saleEvidence.size;
        if (months > 0 && (sales > 0 || baseComparison.removidas.length === 0)) {
          const baseStock = tableMetrics(previousClosing).available, ivv = sales / months, periodVso = baseStock > 0 ? (sales / baseStock) * 100 : null;
          intervals.push({ id: `INT-${crypto.createHash('sha1').update(`${empreendimento.id}|${modality}|${previousGroup.mes}|${group.mes}`).digest('hex').slice(0, 20).toUpperCase()}`, empreendimentoId: empreendimento.id, modalidade:modality, fotografiaAnteriorId: previousClosing.id, fotografiaAtualId: closing.id, fotografiasEvidenciaIds: group.fotografias.map((table) => table.id), mesInicial: previousGroup.mes, mesFinal: group.mes, mesesIntervalo: months, mesesCobertos: coveredCalendarMonths(previousClosing.validityDate, closing.validityDate), estoqueBase: baseStock, vendasConfirmadas: sales, vendasChaves: [...saleEvidence.keys()], ivv, vsoPeriodo: periodVso, vsoMedioMensal: periodVso == null ? null : periodVso / months, tipoObservacao: months === 1 ? 'OBSERVADO' : 'DERIVADO_INTERVALO', formulaVersao: 'analytics_historico_v1', calculadoEm: closing.validatedAt || closing.updatedAt || closing.createdAt });
        }
      }
      previousGroup = group;
    }
    for (const table of all.filter((candidate) => candidate.tipoTabela === modality && candidate.status !== 'registered')) {
      const prior = chain.filter((candidate) => snapshotOrder(candidate, table) < 0).at(-1) || null; const earlier = registered.filter((candidate) => snapshotOrder(candidate, table) < 0); const comparison = snapshotComparison(empreendimento, prior, table, earlier);
      table.comparacao = { ...comparison, preview: true }; delete table.comparacao.facts; table.fatosGeradosIds = [];
    }
  }
  const manualFacts = manualSaleFacts(empreendimento), generatedKeys = new Set(generated.map((fact) => `${fact.tipo}|${fact.tabelaAtualId}|${fact.unidadeChave}`));
  for (const fact of manualFacts) {
    const key = `${fact.tipo}|${fact.tabelaAtualId}|${fact.unidadeChave}`;
    if (!generatedKeys.has(key)) { generated.push(fact); generatedKeys.add(key); }
    const table = (empreendimento.tabelas || []).find((item) => item.id === fact.tabelaAtualId); if (table) table.fatosGeradosIds = [...new Set([...(table.fatosGeradosIds || []), fact.id])];
  }
  empreendimento.fatosComerciais = generated.sort((a, b) => String(a.dataValidade || '').localeCompare(String(b.dataValidade || '')) || String(a.id).localeCompare(String(b.id))); empreendimento.intervalosComerciais = intervals.sort((a, b) => a.mesFinal.localeCompare(b.mesFinal) || a.modalidade.localeCompare(b.modalidade));
  empreendimento.historicoReconstruidoEm = now(); empreendimento.historicoVersao = 9; empreendimento.historicoUltimoMotivo = options.reason || 'recalculo';
  return empreendimento.fatosComerciais;
}
function compareWithPrevious(empreendimento, currentUnits, tableType = null) {
  const currentType = tableType;
  const previous = [...(empreendimento.tabelas || [])].filter((table) => table.status === 'registered' && (!currentType || table.tipoTabela === currentType)).sort(snapshotOrder).at(-1);
  if (!previous) return { previousTableId: null, novas: currentUnits.map((unit) => unit.chave), removidas: [], retornadas: [], alteracoesValor: [], alteracoesComerciais: [] };
  const prior = new Map((previous.unidades || []).map((unit) => [unit.chave, unit])); const current = new Map(currentUnits.map((unit) => [unit.chave, unit]));
  const allEarlier = new Set((empreendimento.tabelas || []).flatMap((table) => (table.unidades || []).map((unit) => unit.chave)));
  const novas = []; const retornadas = []; const alteracoesValor = [];
  for (const unit of currentUnits) { if (!prior.has(unit.chave)) (allEarlier.has(unit.chave) ? retornadas : novas).push(unit.chave); else { const oldValue = prior.get(unit.chave).valorValidado ?? prior.get(unit.chave).valorInterpretado; const newValue = unit.valorValidado ?? unit.valorInterpretado; if (oldValue != null && newValue != null && oldValue !== newValue) alteracoesValor.push({ chave: unit.chave, anterior: oldValue, atual: newValue, direcao: newValue < oldValue ? 'reducao' : 'aumento', divergenciaRelevante: Math.abs(oldValue - newValue) / oldValue >= 0.1 }); } }
  return { previousTableId: previous.id, novas, removidas: [...prior.keys()].filter((key) => !current.has(key)), retornadas, alteracoesValor, alteracoesComerciais: [] };
}
function normalizeUnitStatus(value) {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  if (/^DISPONIVEL$/.test(normalized)) return 'Disponível';
  if (/^VENDID[AO]?$/.test(normalized)) return 'Vendida';
  if (/^BLOQUEAD[AO]?$/.test(normalized)) return 'Bloqueada';
  if (/^BLOQ\.?/.test(normalized)) return 'Bloqueada';
  if (/^RESERVAD[AO]?$/.test(normalized)) return 'Reservada';
  if (/^NOVO$/.test(normalized)) return 'Novo';
  if (/^INDISPONIVEL$/.test(normalized)) return 'Indisponível';
  if (/^RETIRAD[AO]?$/.test(normalized)) return 'Retirada';
  if (/^AUSENTE$/.test(normalized)) return 'Ausente';
  return 'Não identificado';
}
function tableOriginLabel(table) { return table?.origem?.label || (table?.documento ? 'PDF importado' : 'Cadastro manual'); }
function readingConfidence(extraction) {
  const imageOnly = Boolean(extraction?.imageOnly),ocrUsed=Boolean(extraction?.ocrUsed); const units = extraction?.units?.length || 0; const hasText = Boolean(String(extraction?.text || '').replace(/\f/g, '').trim());
  const percentual = ocrUsed ? (units ? 78 : 45) : imageOnly ? 0 : units ? 95 : hasText ? 60 : 0;
  return { percentual, classificacao: percentual >= 90 ? 'alta' : percentual >= 70 ? 'media' : 'baixa', metodo: ocrUsed?'ocr_fallback':imageOnly ? 'pdf_imagem_sem_ocr' : 'texto_embutido' };
}
function reviewAlerts(empreendimento, table, units = table.unidades || []) {
  const alerts = []; const keys = new Map();
  for (const unit of units) {
    const key = unit.chave || buildUnitKey(empreendimento.id, unit.quadra, unit.unidade); if (!keys.has(key)) keys.set(key, []); keys.get(key).push(unit);
  }
  for (const [key, duplicates] of keys) if (duplicates.length > 1) alerts.push({ id: `duplicada:${key}`, tipo: 'UNIDADE_DUPLICADA', nivel: 'critico', chave: key, mensagem: `A unidade ${key.split(':').slice(-2).join(' · ')} está duplicada.` });
  for (const [index, warning] of (table.extracao?.warnings || []).entries()) if (warning && typeof warning === 'object') alerts.push({ id:`extracao:${index}:${warning.tipo || 'aviso'}`, tipo:warning.tipo || 'CONFLITO_EXTRACAO', nivel:warning.nivel || 'atencao', chave:warning.chave || null, mensagem:warning.mensagem || 'A estrutura da fonte exige revisão.' });
  const previous = previousRegisteredTable(empreendimento, table); const prior = new Map((previous?.unidades || []).map((unit) => [unit.chave, unit]));
  for (const unit of units) {
    const current = unitValue(unit); const previousUnit = prior.get(unit.chave); const priorValue = unitValue(previousUnit);
    if (current !== null && priorValue !== null && current < priorValue) alerts.push({ id: `preco:${unit.chave}`, tipo: 'REDUCAO_PRECO', nivel: 'critico', chave: unit.chave, anterior: priorValue, atual: current, variacao: (current - priorValue) / priorValue, mensagem: `Redução de preço detectada em ${unit.quadra || 'Sem bloco'} · ${unit.unidade || 'Sem unidade'}.` });
    if (unit.origemLeitura === 'nova_na_tabela_atual' && normalizeUnitStatus(unit.situacaoExtraida) === 'Disponível') alerts.push({ id: `nova:${unit.chave}`, tipo: 'NOVA_UNIDADE_DISPONIVEL', nivel: 'critico', chave: unit.chave, mensagem: `${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'} é nova nesta tabela e foi incluída como Disponível. Confirme ou ajuste a situação.` });
    if (normalizeUnitStatus(unit.situacaoExtraida) === 'Reservada') alerts.push({ id:`reserva:${unit.chave}`, tipo:'RESERVA_EM_REVISAO', nivel:'atencao', chave:unit.chave, mensagem:`${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'} foi publicada como Reservada. A reserva foi preservada e não entra como venda sem confirmação.` });
    for (const financial of unit.alertasFinanceiros || []) alerts.push({ id: `financeiro:${unit.chave}:${financial.codigo}`, tipo: 'CONDICAO_FINANCEIRA_INCONSISTENTE', nivel: 'critico', chave: unit.chave, plano: financial.plano, diferenca: financial.diferenca, mensagem: `${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'}: ${financial.mensagem}` });
  }
  if (hasAmbiguousCommercialBase(table)) alerts.push({ id: 'regra:base_ambigua', tipo: 'BASE_CALCULO_AMBIGUA', nivel: 'atencao', mensagem: 'A regra financeira possui uma base de cálculo ambígua. Os valores publicados foram preservados e o simulador não usará esse plano até a revisão.' });
  if (table.normalizacao?.termosDesconhecidos?.length) alerts.push({ id: 'regra:termos_desconhecidos', tipo: 'TERMO_COMERCIAL_DESCONHECIDO', nivel: 'atencao', mensagem: `Termos comerciais não reconhecidos: ${table.normalizacao.termosDesconhecidos.join(', ')}. Nenhuma regra foi criada por suposição.` });
  for (const key of table.comparacao?.removidas || []) {
    const unit = prior.get(key); if (!unit) continue;
    const classification = table.classificacoesRemocao?.[key]; const suffix = classification?.status ? ` Classificação selecionada: ${classification.status}.` : ' Ausência pendente: não entra como venda até classificação ou confirmação.';
    if (table.status === 'registered' && classification?.status) continue;
    alerts.push({ id: `ausente:${key}`, tipo: 'UNIDADE_AUSENTE', nivel: 'critico', chave: key, mensagem: `${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'} não foi encontrada nesta tabela.${suffix}` });
  }
  if (table.confiancaLeitura?.classificacao === 'baixa') alerts.push({ id: 'ocr:baixa', tipo: 'CONFIANCA_BAIXA', nivel: 'atencao', mensagem: 'Leitura automática com baixa confiança. Revise os campos destacados antes de concluir.' });
  return alerts;
}
function rebuildTableDerived(empreendimento, table) {
  normalizeTableComparisonIdentities(empreendimento, table);
  table.unidades = (table.unidades || []).map((unit) => ({ ...unit, chave: buildUnitRecordKey(empreendimento.id, unit), valorPublicado:unit.valorPublicado ?? unit.valorExtraido ?? null, situacaoPublicada:unit.situacaoPublicada ?? unit.situacaoExtraida ?? 'Não identificado', situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida) }));
  const previous = previousRegisteredTable(empreendimento, table); const priorKeys = new Set((previous?.unidades || []).map((unit) => unit.chave));
  if (previous) table.unidades = table.unidades.map((unit) => !priorKeys.has(unit.chave) && unit.origemLeitura !== 'ausente_na_tabela_atual' ? { ...unit, origemLeitura: 'nova_na_tabela_atual', confirmadoPeloUsuario: false } : unit);
  const registered = sortTables((empreendimento.tabelas || []).filter((item) => item.id !== table.id && item.tipoTabela === table.tipoTabela)); const previousForPreview = registered.filter((candidate) => snapshotOrder(candidate, table) < 0).at(-1) || null; const earlier = sortTables((empreendimento.tabelas || []).filter((item) => item.id !== table.id && snapshotOrder(item, table) < 0));
  const comparison = snapshotComparison(empreendimento, previousForPreview, table, earlier); table.comparacao = { ...comparison, preview: table.status !== 'registered' }; delete table.comparacao.facts;
  if (table.status === 'registered') rebuildCommercialHistory(empreendimento, { reason: 'recalculo_tabela' });
  table.alertas = reviewAlerts(empreendimento, table);
  return table;
}
function copyForReview(empreendimento, source) {
  return (source.unidades || []).map((unit) => { const cloned = JSON.parse(JSON.stringify(unit)); return { ...cloned, id: crypto.randomUUID(), chave: buildUnitKey(empreendimento.id, cloned.quadra, cloned.unidade), valorExtraido: cloned.valorExtraido ?? unitValue(cloned), valorInterpretado: cloned.valorInterpretado ?? unitValue(cloned), valorValidado: cloned.valorValidado ?? unitValue(cloned), situacaoExtraida: normalizeUnitStatus(cloned.situacaoExtraida), status: 'referenced_previous' }; });
}
function tableDependencies(empreendimento, tableId) {
  return (empreendimento.tabelas || []).filter((table) => table.id !== tableId && (table.manualReviewBaseTableId === tableId || table.origem?.tabelaBaseId === tableId || table.documentoReferencia?.tabelaId === tableId || table.comparacao?.previousTableId === tableId)).map((table) => ({ id: table.id, name: table.name, validityDate: table.validityDate, relation: table.manualReviewBaseTableId === tableId || table.origem?.tabelaBaseId === tableId ? 'base_de_revisao' : table.documentoReferencia?.tabelaId === tableId ? 'documento_referenciado' : 'comparacao_historica' }));
}
function nullableNumber(value) { if (value === '' || value == null) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function normalizeReviewedUnits(empreendimento, existingUnits, submittedUnits) {
  if (!Array.isArray(submittedUnits) || !submittedUnits.length) throw new Error('Informe ao menos uma unidade para revisão.');
  const previous = new Map((existingUnits || []).map((unit) => [unit.id, unit]));
  return submittedUnits.map((submitted) => {
    const prior = previous.get(submitted.id) || {};
    const unit = { ...prior, ...submitted, id: submitted.id || crypto.randomUUID(), valorExtraido: prior.valorExtraido ?? submitted.valorExtraido ?? null, valorPublicado: prior.valorPublicado ?? prior.valorExtraido ?? submitted.valorExtraido ?? null, situacaoPublicada: prior.situacaoPublicada ?? prior.situacaoExtraida ?? submitted.situacaoExtraida ?? 'Não identificado', condicoes: prior.condicoes ?? submitted.condicoes, linhaOriginal: prior.linhaOriginal ?? submitted.linhaOriginal };
    unit.quadra = String(unit.quadra || '').trim(); unit.unidade = String(unit.unidade || '').trim();
    if (!unit.quadra || !unit.unidade) throw new Error('Bloco e unidade são obrigatórios em todas as linhas.');
    for (const field of ['areaPrivativa', 'vagas', 'valorExtraido', 'valorInterpretado', 'valorValidado', 'valorAvaliacaoExtraido']) unit[field] = nullableNumber(unit[field]);
    unit.valorInterpretado = unit.valorInterpretado ?? unit.valorValidado ?? unit.valorExtraido;
    unit.valorValidado = unit.valorValidado ?? unit.valorInterpretado;
    unit.situacaoExtraida = normalizeUnitStatus(unit.situacaoExtraida || prior.situacaoExtraida || 'Disponível');
    unit.chave = buildUnitKey(empreendimento.id, unit.quadra, unit.unidade); unit.status = 'validated'; unit.revisao = { ...(prior.revisao || {}), valorValidado: unit.valorValidado, situacaoValidada: unit.situacaoExtraida, updatedAt: now() };
    return unit;
  });
}
function unitValue(unit) { const value = unit?.valorValidado ?? unit?.valorInterpretado; return Number.isFinite(Number(value)) ? Number(value) : null; }
function sum(values) { return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0); }
function sortTables(tables) { return [...tables].filter((table) => table.status === 'registered').sort((a, b) => a.validityDate.localeCompare(b.validityDate) || a.createdAt.localeCompare(b.createdAt)); }
function tableMetrics(table) {
  const units = table?.unidades || []; const priced = units.map(unitValue).filter((value) => value !== null);
  const area = sum(units.map((unit) => Number(unit.areaPrivativa) || 0)); const vgv = sum(priced);
  const byStatus = Object.fromEntries(Object.entries(units.reduce((map, unit) => { const status = unit.situacaoExtraida || 'Não identificado'; map[status] = (map[status] || 0) + 1; return map; }, {})).sort());
  const available = units.filter((unit) => /^dispon[ií]vel$/i.test(String(unit.situacaoExtraida || '').trim())).length;
  const unknownAvailability = units.filter((unit) => !String(unit.situacaoExtraida || '').trim() || /n[aã]o identificado/i.test(unit.situacaoExtraida)).length;
  const sold = units.filter((unit) => normalizeUnitStatus(unit.situacaoExtraida) === 'Vendida').length; const newAvailable = units.filter((unit) => unit.origemLeitura === 'nova_na_tabela_atual' && normalizeUnitStatus(unit.situacaoExtraida) === 'Disponível').length;
  return { units: units.length, available, sold, newAvailable, unknownAvailability, pricedUnits: priced.length, vgv, area, pricePerM2: area ? vgv / area : null, averagePrice: priced.length ? vgv / priced.length : null, byStatus };
}
function comparisonMetrics(previous, current) {
  if (!previous || !current) return { base: false, retained: 0, added: 0, removed: 0, returned: 0, priceChanged: 0, priceIncrease: 0, priceDecrease: 0, samePrice: 0, priceDelta: 0, priceDeltaPercent: null, removedVgv: 0 };
  const before = new Map((previous.unidades || []).map((unit) => [unit.chave, unit])); const after = new Map((current.unidades || []).map((unit) => [unit.chave, unit]));
  let retained = 0, added = 0, removed = 0, returned = 0, priceChanged = 0, priceIncrease = 0, priceDecrease = 0, samePrice = 0, priceDelta = 0, priceBase = 0, priceCurrent = 0, removedVgv = 0;
  const historicalKeys = new Set();
  for (const table of []) { void table; }
  for (const [key, unit] of after) {
    if (!before.has(key)) { added++; continue; }
    retained++; const prior = unitValue(before.get(key)); const currentValue = unitValue(unit);
    if (prior !== null && currentValue !== null) { const delta = currentValue - prior; priceDelta += delta; priceBase += prior; priceCurrent += currentValue; if (delta > 0) { priceChanged++; priceIncrease++; } else if (delta < 0) { priceChanged++; priceDecrease++; } else samePrice++; }
  }
  for (const [key, unit] of before) if (!after.has(key)) { removed++; removedVgv += unitValue(unit) || 0; }
  return { base: true, retained, added, removed, returned, priceChanged, priceIncrease, priceDecrease, samePrice, priceDelta, priceDeltaPercent: priceBase ? (priceCurrent - priceBase) / priceBase : null, removedVgv };
}
function monthlyIvv(previous, current, sales) {
  if (!previous || !current) return { available: false, monthly: null, sales: 0, intervalMonths: null, tipoObservacao: null };
  const intervalMonths = calendarMonthDifference(previous.validityDate, current.validityDate);
  if (!Number.isFinite(intervalMonths) || intervalMonths <= 0) return { available: false, monthly: null, sales: 0, intervalMonths, tipoObservacao: null };
  const confirmedSales = Math.max(0, Number(sales) || 0);
  return { available: true, monthly: confirmedSales / intervalMonths, sales: confirmedSales, intervalMonths, tipoObservacao: intervalMonths === 1 ? 'OBSERVADO' : 'DERIVADO_INTERVALO', mesInicial: calendarMonth(previous.validityDate)?.key || null, mesFinal: calendarMonth(current.validityDate)?.key || null };
}
function launchVelocityFallback(empreendimento, table, filter = () => true, effectiveUnits = null) {
  const launch = calendarMonth(empreendimento?.launchDate), closing = calendarMonth(table?.validityDate);
  if (!launch || !closing || closing.index < launch.index) return null;
  const sourceUnits = Array.isArray(effectiveUnits) && effectiveUnits.length ? effectiveUnits : (table?.unidades || []);
  const views = sourceUnits.map((unit) => { const view = analyticsUnit(unit); return unit?.situacaoComercial ? { ...view, situacao: normalizeUnitStatus(unit.situacaoComercial) } : view; }).filter(filter);
  const knownKeys = new Set(views.map((unit) => unit.chave).filter(Boolean));
  const soldKeys = new Set(views.filter((unit) => unit.situacao === 'Vendida').map((unit) => unit.chave).filter(Boolean));
  for (const fact of empreendimento?.fatosComerciais || []) {
    if (fact.tipo !== 'VENDA_IDENTIFICADA' || fact.confirmado === false || fact.tabelaAtualId !== table?.id || !knownKeys.has(fact.unidadeChave)) continue;
    soldKeys.add(fact.unidadeChave);
  }
  const months = Math.max(1, closing.index - launch.index), sales = soldKeys.size, totalUnits = views.length;
  const vsoPeriodo = totalUnits > 0 ? (sales / totalUnits) * 100 : null;
  return { available: true, monthly: sales / months, ivv: sales / months, sales, intervalMonths: months, mesesIntervalo: months, mesesCobertos: coveredCalendarMonths(empreendimento.launchDate, table.validityDate), tipoObservacao: 'DERIVADO_LANCAMENTO', mesInicial: launch.key, mesFinal: closing.key, vsoPeriodo, vsoMedioMensal: vsoPeriodo == null ? null : vsoPeriodo / months, estoqueBase: totalUnits, fotografiaAnteriorId: null, fotografiaAtualId: table.id, modalidade: table.tipoTabela, vendasConfirmadas: sales, vendasChaves: [...soldKeys], formulaVersao: 'analytics_historico_lancamento_v1' };
}
const REMOVAL_STATUSES = ['PENDENTE', 'DISPONIVEL', 'VENDIDA', 'BLOQUEADA', 'INDISPONIVEL', 'RESERVADA', 'RETIRADA_COMERCIALIZACAO', 'OUTRA'];
function removalStatusToUnitStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'DISPONIVEL') return 'Disponível';
  if (value === 'VENDIDA') return 'Vendida';
  if (value === 'BLOQUEADA') return 'Bloqueada';
  if (value === 'INDISPONIVEL') return 'Indisponível';
  if (value === 'RESERVADA') return 'Reservada';
  if (value === 'RETIRADA_COMERCIALIZACAO') return 'Retirada';
  return 'Não identificado';
}
function previousRegisteredTable(empreendimento, table) {
  const tables = sortTables(empreendimento.tabelas || []).filter((item) => !table?.tipoTabela || item.tipoTabela === table.tipoTabela).sort(snapshotOrder); const index = tables.findIndex((item) => item.id === table?.id);
  if (index > 0) return tables[index - 1];
  return tables.filter((item) => item.id !== table?.id && (!table || snapshotOrder(item, table) < 0)).at(-1) || null;
}
function removalDetails(previous, current, classifications = {}) {
  if (!previous || !current) return [];
  const after = new Set((current.unidades || []).map((unit) => unit.chave));
  return (previous.unidades || []).filter((unit) => !after.has(unit.chave)).map((unit) => {
    const classification = classifications[unit.chave] || null;
    return { chave: unit.chave, bloco: unit.quadra || 'Sem bloco', unidade: unit.unidade, areaPrivativa: unit.areaPrivativa ?? null, valor: unitValue(unit), situacaoAnterior: unit.situacaoExtraida || 'Não identificado', classificacao: classification?.status || 'PENDENTE', observacao: classification?.observacao || '', classifiedAt: classification?.at || null };
  });
}
function removalSummary(details) {
  const summary = { total: details.length, pendentes: 0, vendidas: 0, indisponiveis: 0, reservadas: 0, retiradas: 0, outras: 0 };
  for (const item of details) {
    if (item.classificacao === 'VENDIDA') summary.vendidas++;
    else if (item.classificacao === 'INDISPONIVEL') summary.indisponiveis++;
    else if (item.classificacao === 'RESERVADA') summary.reservadas++;
    else if (item.classificacao === 'RETIRADA_COMERCIALIZACAO') summary.retiradas++;
    else if (item.classificacao === 'OUTRA') summary.outras++;
    else summary.pendentes++;
  }
  return summary;
}
function soldStatusTransitions(previous, current) {
  const prior = new Map((previous?.unidades || []).map((unit) => [unit.chave, normalizeUnitStatus(unit.situacaoExtraida)]));
  return (current?.unidades || []).filter((unit) => normalizeUnitStatus(unit.situacaoExtraida) === 'Vendida' && prior.get(unit.chave) !== 'Vendida');
}
function generalInventoryTable(empreendimento, reference) {
  if (!reference) return null;
  const catalog = new Map((reference.unidades || []).map((unit) => [unit.chave, { ...unit, situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida) }]));
  const tables = sortTables(empreendimento.tabelas || []);
  for (const table of tables) for (const unit of table.unidades || []) {
    const existing = catalog.get(unit.chave);
    if (existing) catalog.set(unit.chave, { ...existing, situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida), statusGeralOriginadoEm: table.id });
    else catalog.set(unit.chave, { ...unit, situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida), statusGeralOriginadoEm: table.id, origemLeitura: unit.origemLeitura || 'nova_em_modalidade' });
  }
  return { ...reference, unidades: [...catalog.values()], nomeVisao: 'Saldo disponível geral', isGeneralInventory: true };
}
function buildRadar(empreendimento, modalidadeSelecionada = null) {
  // Indicadores decisórios nunca usam uma versão ainda em validação.
  // O empreendimento pode aparecer no mapa desde já, mas VGV, IVV e vendas
  // só passam a refletir uma tabela após a confirmação explícita.
  const allTables = [...(empreendimento.tabelas || [])].sort(snapshotOrder); const registeredTables = sortTables(allTables); const pendingTable = allTables.filter((table) => table.status === 'pending_validation').at(-1) || null; const pendingCurrent = pendingTable ? tableMetrics(pendingTable) : null; const base = registeredTables.find((table) => table.id === empreendimento.tabelaBaseId); const modality = modalidadeSelecionada || base?.tipoTabela || empreendimento.tabelaPadraoTipo || registeredTables.at(-1)?.tipoTabela || null; const referenceTables = modality ? registeredTables.filter((table) => table.tipoTabela === modality) : []; const monthlyGroups = monthlySnapshotGroups(referenceTables); const reference = monthlyGroups.at(-1)?.fechamento || null; const latest = generalInventoryTable(empreendimento, reference) || registeredTables.at(-1) || null; const tables = monthlyGroups.map((group) => group.fechamento); const previous = monthlyGroups.at(-2)?.fechamento || null;
  const comparisonCurrent = reference || latest;
  const central = { unidades: projectedPhysicalUnits(empreendimento) }; const current = tableMetrics(central); const prior = tableMetrics(previous); const removedDetails = removalDetails(previous, comparisonCurrent, comparisonCurrent?.classificacoesRemocao || {}); const removals = removalSummary(removedDetails); const pairFacts = (empreendimento.fatosComerciais || []).filter((fact) => fact.tabelaAtualId === comparisonCurrent?.id && fact.tabelaAnteriorId === previous?.id); const manualCurrentFacts = (empreendimento.fatosComerciais || []).filter((fact) => fact.tabelaAtualId === comparisonCurrent?.id && fact.tipo === 'VENDA_IDENTIFICADA' && fact.origem === 'edicao_manual' && fact.confirmado !== false); const salesFacts = [...new Map([...pairFacts.filter((fact) => fact.tipo === 'VENDA_IDENTIFICADA'), ...manualCurrentFacts].map((fact) => [fact.unidadeChave, fact])).values()]; const interval = (empreendimento.intervalosComerciais || []).find((item) => item.modalidade === modality && item.fotografiaAtualId === comparisonCurrent?.id && item.fotografiaAnteriorId === previous?.id) || null; const launchFallback = !previous && registeredTables.length === 1 ? launchVelocityFallback(empreendimento, comparisonCurrent, () => true, central.unidades) : null; const rawComparison = comparisonMetrics(previous, comparisonCurrent); const returned = comparisonCurrent?.comparacao?.retornadas?.length || 0; const comparison = { ...rawComparison, added: Math.max(0, rawComparison.added - returned), returned, removedPending: removals.pendentes, salesConfirmed: interval?.vendasConfirmadas ?? launchFallback?.sales ?? salesFacts.length, salesByStatus: interval?.vendasChaves || launchFallback?.vendasChaves || salesFacts.map((fact) => fact.unidadeChave), removals, reajuste: comparisonCurrent?.comparacao?.resumoReajuste || null }; const incompleteCoverage = Boolean(previous && removals.pendentes > 0 && !interval && !launchFallback); const ivv = interval ? { available: true, monthly: interval.ivv, sales: interval.vendasConfirmadas, intervalMonths: interval.mesesIntervalo, tipoObservacao: interval.tipoObservacao, mesInicial: interval.mesInicial, mesFinal: interval.mesFinal, vsoPeriodo: interval.vsoPeriodo, vsoMedioMensal: interval.vsoMedioMensal, estoqueBase: interval.estoqueBase } : launchFallback || (incompleteCoverage ? { available:false, monthly:null, sales:comparison.salesConfirmed, intervalMonths:calendarMonthDifference(previous?.validityDate, comparisonCurrent?.validityDate), tipoObservacao:'COBERTURA_PARCIAL', motivo:'Existem unidades ausentes sem classificação; não é possível inferir vendas ou IVV.' } : monthlyIvv(previous, comparisonCurrent, comparison.salesConfirmed));
  const keys = new Set([...(central.unidades || []), ...(previous?.unidades || [])].map((unit) => unit.quadra || unit.bloco || 'Sem bloco'));
  const byBlock = [...keys].sort().map((block) => {
    const latestTable = { unidades: (central.unidades || []).filter((unit) => (unit.quadra || unit.bloco || 'Sem bloco') === block) }; const previousTable = { unidades: (previous?.unidades || []).filter((unit) => (unit.quadra || unit.bloco || 'Sem bloco') === block) };
    const currentBlock = tableMetrics(latestTable); const priorBlock = tableMetrics(previousTable); const blockDetails = removedDetails.filter((item) => item.bloco === block); const blockRemoval = removalSummary(blockDetails); const blockSales = soldStatusTransitions(previousTable, latestTable); const blockComparison = { ...comparisonMetrics(previousTable, latestTable), removedPending: blockRemoval.pendentes, salesConfirmed: blockRemoval.vendidas + blockSales.length, salesByStatus: blockSales.map((unit) => unit.chave), removals: blockRemoval };
    return { block, current: currentBlock, previous: priorBlock, comparison: blockComparison, vgvDelta: currentBlock.vgv - priorBlock.vgv, vgvDeltaPercent: priorBlock.vgv ? (currentBlock.vgv - priorBlock.vgv) / priorBlock.vgv : null };
  });
  const timeline = tables.map((table, index) => ({ id: table.id, name: table.name, validityDate: table.validityDate, ...tableMetrics(table), comparison: index ? { ...comparisonMetrics(tables[index - 1], table), reajuste: table.comparacao?.resumoReajuste || null, vendas: (empreendimento.fatosComerciais || []).filter((fact) => fact.tabelaAtualId === table.id && fact.tipo === 'VENDA_IDENTIFICADA').length, retornadas: table.comparacao?.retornadas?.length || 0, ausentesPendentes: removalSummary(removalDetails(tables[index - 1], table, table.classificacoesRemocao || {})).pendentes } : null }));
  return {
    id: empreendimento.id, nome: empreendimento.nome, construtora: empreendimento.construtora || '', tipo: empreendimento.tipo || 'Outro', padrao: empreendimento.padrao || 'Indefinido', padraoEconomicoId:empreendimento.padraoEconomicoId || null, neighborhoodId:empreendimento.neighborhoodId || null, caracteristicasImovel:normalizeEnterpriseCharacteristics(empreendimento.caracteristicasImovel), imagem: enterpriseImage(empreendimento), endereco: empreendimento.endereco, numero: empreendimento.numero, bairro: empreendimento.bairro, cidade: empreendimento.cidade, estado: empreendimento.estado, cep: empreendimento.cep,
    latitude: empreendimento.latitude ?? null, longitude: empreendimento.longitude ?? null, geocodeStatus: empreendimento.geocodeStatus || null, geocodeLabel: empreendimento.geocodeLabel || null,
    tableCount: allTables.length, registeredTableCount: registeredTables.length, pendingTableCount: allTables.filter((table) => table.status === 'pending_validation').length, pendingTable: pendingTable ? { id: pendingTable.id, name: pendingTable.name, validityDate: pendingTable.validityDate, unidadesReconhecidas: pendingCurrent.units, confianca: pendingTable.confiancaLeitura?.percentual ?? null } : null, latestTable: comparisonCurrent ? { id: comparisonCurrent.id, name: comparisonCurrent.name, validityDate: comparisonCurrent.validityDate, tipoTabela: comparisonCurrent.tipoTabela, tipoTabelaLabel: comparisonCurrent.tipoTabelaLabel, isDemo: Boolean(comparisonCurrent.isDemo) } : null, previousTable: previous ? { id: previous.id, name: previous.name, validityDate: previous.validityDate } : null,
    current, pendingCurrent, previous: prior, comparison, ivv, normalizedAdjustment:latestEnterpriseAdjustment(empreendimento), removedDetails, modalidadeSelecionada: modality, tabelaBaseId: empreendimento.tabelaBaseId || null, vgvDelta: current.vgv - prior.vgv, vgvDeltaPercent: prior.vgv ? (current.vgv - prior.vgv) / prior.vgv : null, byBlock, timeline, tiposTabela: [...new Map(registeredTables.map((table) => [table.tipoTabela, table.tipoTabelaLabel || TABLE_TYPE_LABELS[table.tipoTabela] || 'Outro'])).entries()].map(([id, label]) => ({ id, label }))
  };
}
function publicEmpreendimento(empreendimento) { const tables = empreendimento.tabelas || []; const latest = [...tables].sort((a, b) => b.validityDate.localeCompare(a.validityDate))[0]; return { ...empreendimento, imagem: enterpriseImage(empreendimento), unidades: projectedPhysicalUnits(empreendimento), tableCount: tables.length, latestTable: latest ? { id: latest.id, name: latest.name, validityDate: latest.validityDate, status: latest.status } : null, ivv: buildRadar(empreendimento).ivv }; }
function publicEnterpriseSummary(empreendimento) { const { tabelas, unidades, fatosComerciais, intervalosComerciais, auditoria, tabelasExcluidas, ...metadata } = empreendimento; return { ...metadata, imagem: enterpriseImage(empreendimento), pontosQuentes: empreendimento.pontosQuentes || [], tabelaBaseId: empreendimento.tabelaBaseId || null, tableCount: (tabelas || []).length, unitCount: (unidades || []).length }; }
function tableSummary(table, empreendimento) {
  const comparison = table.comparacao || {}, rule = table.regraInterpretada || {}; return { id: table.id, name: table.name, tipoTabela: table.tipoTabela, tipoTabelaLabel: table.tipoTabelaLabel, validityDate: table.validityDate, createdAt: table.createdAt, updatedAt: table.updatedAt, status: table.status, isDemo: Boolean(table.isDemo), isBase: table.id === empreendimento.tabelaBaseId, origem: table.origem, documento: table.documento ? { originalName: table.documento.originalName, hash: table.documento.hash, path: table.documento.path } : null, unidades: (table.unidades || []).length, planos: (rule.planos || []).length, regraStatus: rule.status || 'sem_dados', conciliacoes: rule.conciliacao || { conformes: 0, divergentes: 0 }, alertas: (table.alertas || []).length, criticos: (table.alertas || []).filter((alert) => alert.nivel === 'critico').length, anteriorId: comparison.previousTableId || null, novas: (comparison.novas || []).length, ausentes: (comparison.removidas || []).length, reajuste: comparison.resumoReajuste || null };
}
function modalitySummaries(empreendimento) {
  const registered = sortTables(empreendimento.tabelas || []); const groups = new Map();
  for (const table of registered) {
    if (!groups.has(table.tipoTabela)) groups.set(table.tipoTabela, []); groups.get(table.tipoTabela).push(table);
  }
  return [...groups.entries()].map(([id, tables]) => { const current = tables.sort(snapshotOrder).at(-1); return { id, label: current.tipoTabelaLabel || TABLE_TYPE_LABELS[id] || id, atual: tableSummary(current, empreendimento), versoes: tables.map((table) => tableSummary(table, empreendimento)), planos: current.regraInterpretada?.planos?.map((plan) => ({ codigo: plan.codigo, nome: plan.nome, prazoMeses: plan.prazoMeses })) || [] }; });
}
function unitPublishedPlan(unit, code) {
  const declared = (unit?.condicoes?.planos || []).find((plan) => plan.codigo === code); if (declared) return declared;
  const derived = unit?.valoresDerivadosComerciais?.[code]; if (derived) return { codigo: code, conciliacao: derived };
  const conditions = unit?.condicoes || {}; if (code === 'PLANO_PADRAO' && (conditions.sinal || conditions.parcelas || conditions.intercaladas || conditions.chave)) return { codigo: code, mensal: { parcelas: conditions.parcelas?.quantidade, valor: conditions.parcelas?.valor }, intercaladas: conditions.intercaladas, chave: conditions.chave, conciliacao: conditions.conciliacao };
  return null;
}
function unitPlanReconciliation(unit, code) { const plan = unitPublishedPlan(unit, code); return plan?.conciliacao || null; }
function projectedCommercialValue(unit, planCode) {
  const reconciliation = unitPlanReconciliation(unit, planCode); if (Number.isFinite(Number(reconciliation?.valorComercial))) return Number(reconciliation.valorComercial);
  return unitValue(unit);
}
function generalCatalogProjection(empreendimento, query = {}) {
  const modalities = modalitySummaries(empreendimento); const base = (empreendimento.tabelas || []).find((table) => table.id === empreendimento.tabelaBaseId); const defaultModality = base?.tipoTabela || modalities[0]?.id || null;
  const modality = modalities.find((item) => item.id === query.modalidade) || modalities.find((item) => item.id === defaultModality) || modalities[0] || null;
  const versions = modality?.versoes || []; const requestedVersion = (empreendimento.tabelas || []).find((table) => table.id === query.versao && table.status === 'registered' && table.tipoTabela === modality?.id); const table = requestedVersion || (empreendimento.tabelas || []).find((candidate) => candidate.id === modality?.atual?.id) || null;
  const plans = table?.regraInterpretada?.planos || []; const plan = plans.find((candidate) => candidate.codigo === query.plano) || plans[0] || null; const published = new Map((table?.unidades || []).map((unit) => [unit.chave, unit])); const openReview = new Set((empreendimento.pontosQuentes || []).filter((point) => point.status === 'aberto').map((point) => point.chave));
  const unidades = projectedPhysicalUnits(empreendimento).map((unit) => { const source = published.get(unit.chave), reconciliation = plan && source ? unitPlanReconciliation(source, plan.codigo) : null; return { ...unit, valorModalidade: source ? projectedCommercialValue(source, plan?.codigo) : null, valorPublicado: source ? unitValue(source) : null, statusPublicado: source?.situacaoExtraida || null, tabelaModalidadeId: table?.id || null, planoCodigo: plan?.codigo || null, condicao: reconciliation, emRevisao: openReview.has(unit.chave), origemEstruturalTabelaId: unit.origemEstruturalTabelaId || unit.createdFromTableId || null }; });
  const available = unidades.filter((unit) => unit.situacaoComercial === 'Disponível'); const prices = available.map((unit) => unit.valorModalidade).filter(Number.isFinite); const status = Object.fromEntries(UNIT_STATUSES.map((value) => [value, unidades.filter((unit) => unit.situacaoComercial === value).length]));
  return { empreendimentoId: empreendimento.id, tabelaBase: base ? tableSummary(base, empreendimento) : null, modalidade: modality ? { id: modality.id, label: modality.label } : null, modalidades: modalities, versao: table ? tableSummary(table, empreendimento) : null, plano: plan ? { codigo: plan.codigo, nome: plan.nome, prazoMeses: plan.prazoMeses } : null, planos: plans.map((item) => ({ codigo: item.codigo, nome: item.nome, prazoMeses: item.prazoMeses })), statusOptions: UNIT_STATUSES, unidades, metricas: { total: unidades.length, disponiveis: status['Disponível'] || 0, reservadas: status.Reservada || 0, vendidas: status.Vendida || 0, bloqueadas: status.Bloqueada || 0, retiradas: status.Retirada || 0, ausentesRevisao: openReview.size, ticketDisponivel: average(prices) } };
}
function commercialVisualization(empreendimento, table, selectedCodes = []) {
  const availablePlans = table.regraInterpretada?.planos || []; const codes = selectedCodes.length ? selectedCodes : availablePlans.map((plan) => plan.codigo); const plans = availablePlans.filter((plan) => codes.includes(plan.codigo));
  const rows = (table.unidades || []).map((unit) => ({ chave: unit.chave, quadra: unit.quadra, unidade: unit.unidade, situacao: unit.situacaoExtraida, valorImovel: unitValue(unit), planos: plans.map((plan) => { const reconciliation = unitPlanReconciliation(unit, plan.codigo); const derived = reconciliation?.valoresDerivados || calculatedComponents(plan, unitValue(unit)); const indexed = new Map(derived.map((component) => [component.id, component])); return { codigo: plan.codigo, nome: plan.nome, status: reconciliation?.status || 'derivado', diferenca: reconciliation?.diferencaTotal ?? 0, valorComercial: reconciliation?.valorComercial ?? unitValue(unit), componentes: ['entrada', 'intercaladas', 'mensais', 'chave'].map((id) => ({ id, ...(indexed.get(id) || { valor: null, total: null, quantidade: 0 }) })) }; }) }));
  return { empreendimentoId: empreendimento.id, tabela: tableSummary(table, empreendimento), modalidade: { id: table.tipoTabela, label: table.tipoTabelaLabel }, planos: plans.map((plan) => ({ codigo: plan.codigo, nome: plan.nome, prazoMeses: plan.prazoMeses, componentes: plan.componentes })), rows };
}
function historicalView(empreendimento, query = {}) {
  const facts = (empreendimento.fatosComerciais || []).filter((fact) => (!query.modalidade || fact.modalidade === query.modalidade) && (!query.unidade || fact.unidadeChave === query.unidade) && (!query.de || String(fact.dataValidade || '') >= query.de) && (!query.ate || String(fact.dataValidade || '') <= query.ate));
  const defaultModality = query.modalidade || (empreendimento.tabelas || []).find((table) => table.id === empreendimento.tabelaBaseId)?.tipoTabela; const tables = sortTables(empreendimento.tabelas || []).filter((table) => !defaultModality || table.tipoTabela === defaultModality).sort(snapshotOrder);
  const timeline = tables.map((table) => { const tableFacts = facts.filter((fact) => fact.tabelaAtualId === table.id), metrics = tableMetrics(table), priceFacts = tableFacts.filter((fact) => fact.tipo === 'REAJUSTE_PRECO' && fact.comparavelReajuste), sales = tableFacts.filter((fact) => fact.tipo === 'VENDA_IDENTIFICADA').length; return { ...tableSummary(table, empreendimento), metricas: metrics, reajusteMedioPercentual: average(priceFacts.map((fact) => fact.percentualReajuste)), reajusteMedioValor: average(priceFacts.map((fact) => fact.valorReajuste)), vendas: sales }; });
  const intervalos = (empreendimento.intervalosComerciais || []).filter((interval) => (!defaultModality || interval.modalidade === defaultModality) && (!query.de || interval.mesFinal >= String(query.de).slice(0,7)) && (!query.ate || interval.mesInicial <= String(query.ate).slice(0,7)));
  return { empreendimentoId: empreendimento.id, modalidade: defaultModality || null, modalidades: modalitySummaries(empreendimento), fatos: facts.sort((a, b) => String(b.dataValidade || '').localeCompare(String(a.dataValidade || ''))), intervalos, timeline, auditoria: [...(empreendimento.auditoria || [])].reverse() };
}
function analyticsUnit(unit) {
  const value = unitValue(unit); const area = Number(unit?.areaPrivativa || 0);
  return { chave: unit?.chave || null, quadra: unit?.quadra || unit?.bloco || 'Sem identificação', unidade: unit?.unidade || '—', situacao: normalizeUnitStatus(unit?.situacaoExtraida || unit?.situacaoPublicada || 'Não identificado'), valor: value, area: area || null, valorM2: value !== null && area > 0 ? value / area : null, tipologia: unit?.tipologia || (area > 0 ? `${area.toLocaleString('pt-BR')} m²` : 'Não informada') };
}
function analyticsMedian(values) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return null; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function analyticsSnapshot(table, filter = () => true) {
  const units = (table?.unidades || []).map(analyticsUnit).filter(filter); const available = units.filter((unit) => unit.situacao === 'Disponível'); const m2 = available.map((unit) => unit.valorM2).filter(Number.isFinite); const prices = available.map((unit) => unit.valor).filter(Number.isFinite);
  return { tabelaId: table?.id || null, nome: table?.name || null, validade: table?.validityDate || null, unidades: units.length, disponiveis: available.length, vgvDisponivel: sum(prices), precoMedioM2: m2.length ? sum(m2) / m2.length : null, precoMedianoM2: analyticsMedian(m2), precoMedio: prices.length ? sum(prices) / prices.length : null, status: Object.fromEntries(UNIT_STATUSES.map((status) => [status, units.filter((unit) => unit.situacao === status).length])) };
}
function analyticsUnitFilter(query = {}) {
  return (unit) => { const view = unit?.chave && Object.hasOwn(unit, 'situacao') ? unit : analyticsUnit(unit); const block = query.quadra || query.bloco || ''; return (!block || view.quadra === block) && (!query.tipologia || view.tipologia === query.tipologia) && (!query.status || view.situacao === query.status); };
}
function comparablePriceAdjustment(previous, current, filter = () => true) {
  const before = new Map((previous?.unidades || []).map(analyticsUnit).filter(filter).map((unit) => [unit.chave, unit])); const percentuais = [], valores = [], comparaveis = [];
  const aggregateSimulatedBase = current?.reconciliacaoEstrutural?.precoBase === 'SIMULADO' && current.reconciliacaoEstrutural?.tabelaZeroId === previous?.id;
  for (const unit of (current?.unidades || []).map(analyticsUnit).filter(filter)) {
    const prior = before.get(unit.chave); const areaComparable = !Number.isFinite(prior?.area) || !Number.isFinite(unit.area) || prior.area <= 0 || unit.area <= 0 || Math.abs(unit.area - prior.area) / prior.area <= 0.01;
    const priorMetric = aggregateSimulatedBase ? prior?.valor : prior?.valorM2, currentMetric = aggregateSimulatedBase ? unit.valor : unit.valorM2;
    if (!prior || prior.situacao !== 'Disponível' || unit.situacao !== 'Disponível' || (!areaComparable && !aggregateSimulatedBase) || !Number.isFinite(priorMetric) || !Number.isFinite(currentMetric) || priorMetric <= 0) continue;
    percentuais.push((currentMetric - priorMetric) / priorMetric); comparaveis.push({ anterior:prior, atual:unit }); if (Number.isFinite(prior.valor) && Number.isFinite(unit.valor)) valores.push(unit.valor - prior.valor);
  }
  const anterioresM2 = comparaveis.map((item) => item.anterior.valorM2), atuaisM2 = comparaveis.map((item) => item.atual.valorM2), mediaAnteriorM2 = anterioresM2.length ? average(anterioresM2) : null, mediaAtualM2 = atuaisM2.length ? average(atuaisM2) : null;
  const reajusteTabelaM2 = Number.isFinite(mediaAnteriorM2) && mediaAnteriorM2 > 0 && Number.isFinite(mediaAtualM2) ? (mediaAtualM2 - mediaAnteriorM2) / mediaAnteriorM2 : null;
  return { unidadesComparaveis: percentuais.length, reajusteMedioM2: average(percentuais), reajusteTabelaM2, mediaAnteriorM2, mediaAtualM2, maiorReajusteM2: percentuais.length ? Math.max(...percentuais) : null, menorReajusteM2: percentuais.length ? Math.min(...percentuais) : null, impactoVgv: sum(valores), percentuais, metrica:aggregateSimulatedBase ? 'PRECO_UNIDADE_BASE_SIMULADA' : 'PRECO_M2', origem:aggregateSimulatedBase ? 'BASE_SIMULADA_ESTRUTURAL' : 'COMPARACAO_UNIDADE' };
}
function tableComparableDate(table) {
  const value = String(table?.validityDate || table?.validade || table?.dataValidade || '').slice(0, 10);
  return /^\d{4}-\d{2}(-\d{2})?$/.test(value) ? value : null;
}
function monthsBetweenTables(previous, current) {
  const before = tableComparableDate(previous), after = tableComparableDate(current);
  if (!before || !after) return null;
  const [beforeYear, beforeMonth] = before.slice(0, 7).split('-').map(Number), [afterYear, afterMonth] = after.slice(0, 7).split('-').map(Number);
  const months = (afterYear - beforeYear) * 12 + (afterMonth - beforeMonth);
  return Number.isFinite(months) && months > 0 ? months : null;
}
function tableIsSimulated(table) {
  const text = JSON.stringify({ name:table?.name, origem:table?.origem, natureza:table?.natureza, tipo:table?.tipoTabela, unidades:(table?.unidades || []).slice(0, 8).map((unit) => ({ origemJson:unit?.origemJson, classificacaoOrigem:unit?.classificacaoOrigem })) }).toLocaleLowerCase('pt-BR');
  return /simulad|tabela_zero/.test(text);
}
function normalizedEnterpriseAdjustment(previous, current) {
  const months = monthsBetweenTables(previous, current);
  if (!previous || !current || !months) return { elegivel:false, motivo:'sem_tabela_anterior_comparavel', meses:months };
  // A Tabela Zero simulada é a referência histórica adotada pelo produto.
  // Portanto, Zero simulada → primeira fotografia observada é reajuste
  // estimado (nunca observado), com o rótulo de origem preservado. Uma
  // fotografia atual simulada, por outro lado, não representa reajuste.
  if (tableIsSimulated(current)) return { elegivel:false, motivo:'fotografia_atual_simulada', meses:months };
  const baseSimulada = tableIsSimulated(previous);
  const comparison = comparablePriceAdjustment(previous, current);
  // Regra do indicador: primeiro calcula a variação por m² de cada mesma
  // unidade comparável; depois tira a média dessas variações. Não usar a
  // diferença entre as médias das tabelas, pois o mix disponível pode mudar.
  const accumulated = Number(comparison.reajusteMedioM2);
  const origemBase = baseSimulada ? 'ZERO_SIMULADA' : 'FOTOGRAFIA_ANTERIOR_OBSERVADA';
  if (!comparison.unidadesComparaveis || !Number.isFinite(accumulated)) return { elegivel:false, comparavel:false, motivo:'dados_insuficientes', meses:months, origemBase, ...comparison };
  const rotuloOrigem = baseSimulada ? 'Estimado sobre Tabela Zero simulada' : 'Observado entre fotografias';
  // Toda variação entre fotografias é preservada no histórico. Apenas as
  // positivas participam do indicador médio mensal de reajuste do mercado.
  return { elegivel:accumulated > 0, comparavel:true, motivo:accumulated > 0 ? null : accumulated === 0 ? 'sem_variacao_de_preco' : 'reducao_de_preco', meses:months, origemBase, rotuloOrigem, reajusteAcumulado:accumulated, reajusteMensal:accumulated / months, ...comparison };
}
function latestEnterpriseAdjustment(enterprise) {
  const tables = sortTables(enterprise?.tabelas || []);
  const latest = tables.at(-1), sameModality = latest ? tables.filter((table) => table.tipoTabela === latest.tipoTabela) : [], previous = sameModality.at(-2) || null;
  return { atual:latest || null, anterior:previous, ...normalizedEnterpriseAdjustment(previous, latest) };
}
function intervalForTables(empreendimento, modality, previous, current) {
  return (empreendimento.intervalosComerciais || []).find((interval) => interval.modalidade === modality && interval.fotografiaAnteriorId === previous?.id && interval.fotografiaAtualId === current?.id) || null;
}
function componentCommercialSummary(component) {
  if (!component) return null; const type = component.tipoCalculo || component.tipo; const value = type === 'percentual' ? `${Number(component.percentual || 0).toLocaleString('pt-BR')}%` : type === 'valor_fixo' ? `R$ ${Number(component.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}` : 'saldo remanescente';
  return { id: component.id, tipoCalculo: type, natureza: component.natureza, valor: value, baseCalculo: component.baseCalculo || component.base || null, quantidade: component.quantidade || 1, periodicidade: component.periodicidade || 'unica' };
}
function commercialConditionsSummary(previous, current) {
  const before = new Map((previous?.regraInterpretada?.planos || []).map((plan) => [plan.codigo, plan])); const after = new Map((current?.regraInterpretada?.planos || []).map((plan) => [plan.codigo, plan])); const added = [...after.keys()].filter((code) => !before.has(code)), removed = [...before.keys()].filter((code) => !after.has(code)); const changes = [];
  for (const [code, plan] of after) if (before.has(code)) for (const componentId of ['entrada', 'intercaladas']) {
    const prior = before.get(code).componentes?.find((component) => component.id === componentId), actual = plan.componentes?.find((component) => component.id === componentId); if (stableRulePlan({ codigo:code, componentes:[prior].filter(Boolean) }) !== stableRulePlan({ codigo:code, componentes:[actual].filter(Boolean) })) changes.push({ plano: code, nomePlano: plan.nome, componente: componentId, anterior: componentCommercialSummary(prior), atual: componentCommercialSummary(actual) });
  }
  return { modalidade: current ? { id:current.tipoTabela, label:current.tipoTabelaLabel || TABLE_TYPE_LABELS[current.tipoTabela] } : null, planos: [...after.values()].map((plan) => ({ codigo:plan.codigo, nome:plan.nome, prazoMeses:plan.prazoMeses || null })), incluidos: added.map((code) => ({ codigo:code, nome:after.get(code)?.nome || code })), removidos: removed.map((code) => ({ codigo:code, nome:before.get(code)?.nome || code })), alteracoesRelevantes: changes };
}
function analyticsKey(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR'); }
function analyticsStockGroups(units, attribute, total) {
  const groups = new Map();
  for (const unit of units.filter((item) => item.situacao === 'Disponível')) {
    const label = attribute === 'tipologia' ? unit.tipologia : unit.quadra;
    const item = groups.get(label) || { atributo:label, unidades:0, vgvDisponivel:0, valoresM2:[] };
    item.unidades += 1; item.vgvDisponivel += unit.valor || 0; if (Number.isFinite(unit.valorM2)) item.valoresM2.push(unit.valorM2); groups.set(label, item);
  }
  return [...groups.values()].map((item) => ({ atributo:item.atributo, unidades:item.unidades, participacao:total ? item.unidades / total : null, vgvDisponivel:item.vgvDisponivel, precoMedioM2:item.valoresM2.length ? sum(item.valoresM2) / item.valoresM2.length : null })).sort((a, b) => b.vgvDisponivel - a.vgvDisponivel);
}
function analyticsExecutiveProfile(empreendimento, current) {
  const features = empreendimento.caracteristicasImovel || {}, attributes = features.atributos || {};
  const yes = Object.entries({ suite:'Suíte', area_lazer:'Área de lazer', piscina:'Piscina', financiavel:'Financiável', condominio_fechado:'Condomínio fechado', vaga_coberta:'Vaga coberta' }).filter(([key]) => analyticsKey(attributes[key]) === 'sim').map(([, label]) => label);
  return { imagem:enterpriseImage(empreendimento), tipo:empreendimento.tipo || null, bairro:empreendimento.bairro || null, cidade:empreendimento.cidade || null, endereco:empreendimento.endereco || null, construtora:empreendimento.construtora || null, padraoEconomico:empreendimento.padrao || null, fase:empreendimento.fase || null, modalidade:current?.tipoTabelaLabel || current?.tipoTabela || null, fotografia:current?.validityDate || null, lancamento:empreendimento.launchDate || null, entrega:empreendimento.deliveryDate || null, latitude:Number.isFinite(Number(empreendimento.latitude)) ? Number(empreendimento.latitude) : null, longitude:Number.isFinite(Number(empreendimento.longitude)) ? Number(empreendimento.longitude) : null, dormitorios:(features.dormitorios || []).filter(Boolean), vagas:(features.vagas?.quantidades || []).filter(Boolean), atributos:yes };
}
function analyticsDistanceKm(origin, target) {
  const values = [origin?.latitude, origin?.longitude, target?.latitude, target?.longitude].map(Number); if (!values.every(Number.isFinite)) return null;
  const [lat1, lon1, lat2, lon2] = values, radians = Math.PI / 180, a = Math.sin((lat2-lat1)*radians/2) ** 2 + Math.cos(lat1*radians) * Math.cos(lat2*radians) * Math.sin((lon2-lon1)*radians/2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function competitiveContext(empreendimento, enterprises = []) {
  const type = analyticsKey(empreendimento.tipo), pattern = analyticsKey(empreendimento.padrao), hasProfile = Boolean(type && pattern), hasCoordinates = Number.isFinite(Number(empreendimento.latitude)) && Number.isFinite(Number(empreendimento.longitude));
  const rows = enterprises.filter((item) => item.id !== empreendimento.id && item.status !== 'inactive').map((item) => ({ empreendimento:item, distanciaKm:analyticsDistanceKm(empreendimento, item) })).filter((item) => Number.isFinite(item.distanciaKm)).sort((a, b) => a.distanciaKm - b.distanciaKm);
  const compatible = hasProfile ? rows.filter((item) => analyticsKey(item.empreendimento.tipo) === type && analyticsKey(item.empreendimento.padrao) === pattern) : [];
  // A área de influência individual é limitada a 3 km; só amplia para 5 km
  // quando o primeiro raio não oferece comparáveis suficientes. Nunca usa
  // ativos acima de 5 km como concorrência ou referência territorial direta.
  const selected = [];
  for (const band of [[0,3],[3,5]]) {
    for (const item of compatible.filter((candidate) => candidate.distanciaKm >= band[0] && candidate.distanciaKm < band[1])) {
      if (selected.length < 3) selected.push(item);
    }
    if (selected.length >= 3) break;
  }
  const candidate = (item, compatibleProduct) => { const distance = item.distanciaKm, band = distance <= 3 ? '0–3 km' : '3–5 km'; const evidence = compatibleProduct ? 'alta' : 'territorial', radar=buildRadar(item.empreendimento); return { id:item.empreendimento.id, nome:item.empreendimento.nome, tipo:item.empreendimento.tipo || null, padraoEconomico:item.empreendimento.padrao || null, bairro:item.empreendimento.bairro || null, cidade:item.empreendimento.cidade || null, latitude:Number.isFinite(Number(item.empreendimento.latitude)) ? Number(item.empreendimento.latitude) : null, longitude:Number.isFinite(Number(item.empreendimento.longitude)) ? Number(item.empreendimento.longitude) : null, distanciaKm:Number(distance.toFixed(2)), faixaDistancia:band, evidencia:evidence, rotuloEvidencia:compatibleProduct ? (distance <= 3 ? 'Tipo e padrão equivalentes · raio primário' : 'Tipo e padrão equivalentes · raio ampliado') : 'Proximidade territorial; sem equivalência comprovada', metricas:{ vso:radar.ivv?.vsoMedioMensal ?? null, ivv:radar.ivv?.monthly ?? null, precoMedioM2:radar.current?.averageM2 ?? null, vendasConfirmadas:radar.comparison?.salesConfirmed ?? null, fotografia:radar.latestTable?.validityDate || null } }; };
  const farthestCompatible = selected.length ? Math.max(...selected.map((item) => item.distanciaKm)) : 0;
  const effectiveRadius = Number((farthestCompatible > 3 ? 5 : 3).toFixed(2));
  const references = rows.filter((item) => !selected.includes(item) && item.distanciaKm <= effectiveRadius).slice(0,3).map((item) => candidate(item, false));
  return { alvo:{ id:empreendimento.id, nome:empreendimento.nome, latitude:Number.isFinite(Number(empreendimento.latitude)) ? Number(empreendimento.latitude) : null, longitude:Number.isFinite(Number(empreendimento.longitude)) ? Number(empreendimento.longitude) : null }, raioEfetivoKm:effectiveRadius, raioPrimarioKm:3, raioMaximoKm:5, raioExpandido:effectiveRadius > 3, justificativaRaio:effectiveRadius > 3 ? 'O raio primário de 3 km não reuniu comparáveis suficientes; a leitura foi ampliada para 5 km.' : 'A leitura foi formada prioritariamente no raio primário de 3 km.', criterios:{ tipoPadrao:hasProfile, coordenada:hasCoordinates, regra:'3 km primeiro; ampliar para 5 km somente se insuficiente; nunca ultrapassar 5 km.' }, concorrentes:selected.map((item) => candidate(item, true)), referenciasMercado:references, insuficiencias:[!hasProfile ? 'Tipo ou padrão econômico não informado.' : null, !hasCoordinates ? 'Coordenada do empreendimento não informada.' : null, !selected.length ? 'Não há concorrente compatível com coordenada disponível até 5 km.' : null].filter(Boolean) };
}
function maturityDate(value) {
  const raw=String(value || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed=new Date(`${raw}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === raw ? parsed : null;
}
function maturityMonthsBetween(from, to) {
  const start=maturityDate(from), end=maturityDate(to);
  return !start || !end ? null : (end.getFullYear()-start.getFullYear())*12+end.getMonth()-start.getMonth();
}
function maturityDateOffset(value, months) {
  const date=maturityDate(value);
  if (!date || !Number.isFinite(Number(months))) return null;
  date.setMonth(date.getMonth()+Number(months));
  return date.toISOString().slice(0,10);
}
const IvvCurves = require('./ivv-curves');
const { forecastAbsorption } = require('./ivv-forecast');
const IVV_CURVES_FILE = path.join(DATA_DIR, 'ivv-curves.json');
let ivvCurveWriteQueue=Promise.resolve();
async function initializeIvvCurveStore() {
  const store=IvvCurves.read(IVV_CURVES_FILE), next=IvvCurves.initialize(store);
  if(next===store)return;
  const temporary=`${IVV_CURVES_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary,JSON.stringify(next,null,2),'utf8');
  await fs.rename(temporary,IVV_CURVES_FILE);
}
function updateIvvCurveStore(action,payload,actor) {
  const operation=ivvCurveWriteQueue.then(async()=>{
    const store=IvvCurves.read(IVV_CURVES_FILE);
    const next=IvvCurves.change(store,action,payload,actor),temporary=`${IVV_CURVES_FILE}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary,JSON.stringify(next,null,2),'utf8');
    await fs.rename(temporary,IVV_CURVES_FILE);
    return next;
  });
  ivvCurveWriteQueue=operation.catch(()=>{});
  return operation;
}
function buildMaturityBase(data, query = {}, userId = '') {
  return {...IvvCurves.base(IvvCurves.read(IVV_CURVES_FILE)),economicStandards:data.economicStandards || ECONOMIC_STANDARD_SEED};
}
function buildMaturityProjectionLegacy(empreendimento, current, interval, maturityBase) {
  // O forecast consome a fotografia e o IVV recebidos da camada analítica.
  // O histórico é consultado apenas para elegibilidade do lançamento sem vendas.
  const modality=current?.tipoTabela, tables=(empreendimento.tabelas||[]).filter(t=>['registered','superseded'].includes(t.status)), commercialIntervals=(empreendimento.intervalosComerciais||[]).filter(r=>!modality||r.modalidade===modality);
  const observedIvv=Number(interval?.ivv), stock=Number(current?.unidades?.filter((unit) => {
    const status=String(unit.situacao ?? unit.situacaoPublicada ?? unit.status ?? unit.situacaoExtraida ?? '').trim().toLocaleLowerCase('pt-BR');
    return status === 'disponível' || status === 'disponivel';
  }).length), totalUnits=Math.max(0,...tables.map(table=>Array.isArray(table.unidades)?table.unidades.length:0),Array.isArray(empreendimento?.unidades)?empreendimento.unidades.length:0), launch=String(empreendimento?.launchDate || '').slice(0,10), asOf=String(current?.validityDate || '').slice(0,10), age=maturityMonthsBetween(launch,asOf);
  if (!maturityBase?.available) return { available:false, reason:maturityBase?.reason || 'Base de maturação indisponível.', base:maturityBase || null };
  const standard=selectedEconomicStandard(maturityBase,empreendimento),segment=IvvCurves.segment(standard?.slug || empreendimento.padraoEconomicoId || empreendimento.padrao);
  if(!segment)return {available:false,reason:'Padrão econômico do cadastro sem correspondência nas curvas MCMV, Médio e Alto.',base:maturityBase};
  if (!Number.isFinite(age) || age < 0) return { available:false, reason:'Data de lançamento ou fotografia atual inválida para projetar maturidade.', base:maturityBase };
  const hasRealIvv=Number.isFinite(observedIvv)&&observedIvv>0, hasRegisteredSales=commercialIntervals.some(row=>Number(row.vendasConfirmadas??row.sales??0)>0)||(empreendimento.fatosComerciais||[]).some(fact=>fact.tipo==='VENDA_IDENTIFICADA'&&fact.confirmado!==false), syntheticIvv=!hasRealIvv&&!hasRegisteredSales&&age<=6&&totalUnits>0?totalUnits*.15/3:null, initialIvv=hasRealIvv?observedIvv:syntheticIvv, ivvSource=hasRealIvv?'OBSERVADO':'SINTETICO_LANCAMENTO';
  if (!Number.isFinite(initialIvv) || initialIvv <= 0 || !Number.isFinite(stock) || stock <= 0) return { available:false, reason:age<=6&&hasRegisteredSales?'Há vendas registradas, mas ainda não existe IVV observado suficiente para a projeção.':age<=6?'IVV inicial parametrizado requer unidades totais e estoque disponível.':'IVV real ou estoque disponível insuficiente para projetar.', base:maturityBase };
  const periods=maturityBase.periods || [], projectedIvvForMonth=month => ({ivv:IvvCurves.projectedRate(maturityBase,initialIvv,month,segment),origem:month>36?'CAUDA_ESTAVEL':'PARAMETRO_APROVADO'});
  let fixedRemaining=stock, projectedRemaining=stock, fixedDepletionMonths=null, projectedDepletionMonths=null;
  const memoriaMensal=[{ mes:0, label:'Atual', ivvMedio:initialIvv, ivvProjetado:initialIvv, vendasIvvMedio:0, vendasIvvProjetado:0, estoqueIvvMedio:stock, estoqueIvvProjetado:stock, origemProjetada:ivvSource }];
  // A cauda pós-36 meses é estável; 600 meses cobre estoques extensos sem
  // cortar uma das simulações antes de seu esgotamento.
  for (let month=1;month<=600;month++) {
    const projectedRule=projectedIvvForMonth(month), projected=projectedRule.ivv, fixedBefore=fixedRemaining, projectedBefore=projectedRemaining, fixedSold=Math.min(fixedBefore,initialIvv), projectedSold=Math.min(projectedBefore,projected);
    if (fixedDepletionMonths === null && fixedBefore > 0 && fixedSold >= fixedBefore) fixedDepletionMonths=(month-1)+(fixedBefore/initialIvv);
    if (projectedDepletionMonths === null && projectedBefore > 0 && projectedSold >= projectedBefore) projectedDepletionMonths=(month-1)+(projectedBefore/projected);
    if(!Number.isFinite(projected)||projected>(month===1?initialIvv:projectedIvvForMonth(month-1).ivv))throw new Error('Falha de validação: IVV projetado crescente no mês '+month);
    fixedRemaining=Math.max(0,fixedBefore-fixedSold); projectedRemaining=Math.max(0,projectedBefore-projectedSold);
    memoriaMensal.push({ mes:month, label:`+${month} mês${month===1?'':'es'}`, ivvMedio:fixedRemaining>0?initialIvv:0, ivvProjetado:projectedRemaining>0?projected:0, vendasIvvMedio:fixedSold, vendasIvvProjetado:projectedSold, estoqueIvvMedio:fixedRemaining, estoqueIvvProjetado:projectedRemaining, origemProjetada:projectedRule.origem });
    if (fixedRemaining <= 0 && projectedRemaining <= 0) break;
  }
  const displayMonths=new Set([0,Math.ceil(fixedDepletionMonths||0),Math.ceil(projectedDepletionMonths||0),memoriaMensal.at(-1).mes]);
  for (let month=3;month<=memoriaMensal.at(-1).mes;month+=3) displayMonths.add(month);
  const displayRows=memoriaMensal.filter(item=>displayMonths.has(item.mes)).sort((left,right)=>left.mes-right.mes);
  let previousMonth=0;
  const points=displayRows.map((row,index) => {
    const start=previousMonth; previousMonth=row.mes;const cycle=memoriaMensal.filter(item=>item.mes>start&&item.mes<=row.mes);
    const fixedCycle=sum(cycle.map(item=>item.vendasIvvMedio)), projectedCycle=sum(cycle.map(item=>item.vendasIvvProjetado));
    const curveIndex=row.mes===0?0:Math.min(periods.length-1,Math.floor((row.mes-1)/3));
    return { label:index===0?'Atual':`+${row.mes} meses`, meses:row.mes, faixaMaturidade:periods[curveIndex]?.faixa||null, idadeEmpreendimentoMeses:age+row.mes, dataProjetada:maturityDateOffset(asOf,row.mes), ivv:row.ivvMedio>0?row.ivvMedio:null, ivvProjetado:row.ivvProjetado>0?row.ivvProjetado:null, ivvTrimestral:row.ivvMedio*3, ivvProjetadoTrimestral:row.ivvProjetado*3, unidadesVendidas:Math.min(stock,stock-row.estoqueIvvMedio), vendasProjetadas:Math.min(stock,stock-row.estoqueIvvProjetado), vendasTrimestre:fixedCycle, vendasProjetadasTrimestre:projectedCycle, disponibilidade:row.estoqueIvvMedio, disponibilidadeProjetada:row.estoqueIvvProjetado, origemProjetada:row.origemProjetada };
  });
  const scenarioSeries=(kind,depletion,valueKey,stockKey,salesKey,terminalValue)=>{
    const rows=points.filter(row=>Number(row.meses)<depletion&&Number.isFinite(row[valueKey])).map(row=>({cenario:kind,meses:row.meses,label:row.label,idadeEmpreendimentoMeses:row.idadeEmpreendimentoMeses,dataProjetada:row.dataProjetada,faixaMaturidade:row.faixaMaturidade,valor:row[valueKey],saldo:row[stockKey],vendasCiclo:row[salesKey]}));
    const terminal={cenario:kind,meses:depletion,label:`+${Number(depletion).toLocaleString('pt-BR',{maximumFractionDigits:2})} meses`,idadeEmpreendimentoMeses:age+depletion,dataProjetada:maturityDateOffset(asOf,depletion),faixaMaturidade:periods[Math.min(periods.length-1,Math.floor((Math.max(1,depletion)-1)/3))]?.faixa||null,valor:terminalValue,saldo:0,vendasCiclo:null};
    if(!rows.length||Math.abs(rows.at(-1).meses-terminal.meses)>1e-9)rows.push(terminal);else rows[rows.length-1]=terminal;
    return rows;
  };
  const fixedIVVSeries=scenarioSeries('IVV_FIXO',fixedDepletionMonths,'ivv','disponibilidade','vendasTrimestre',initialIvv),fixedStockSeries=fixedIVVSeries.map(row=>({...row,valor:row.saldo})),projectedTerminal=projectedIvvForMonth(Math.max(1,Math.ceil(projectedDepletionMonths))).ivv,projectedIVVSeries=scenarioSeries('IVV_PROJETADO',projectedDepletionMonths,'ivvProjetado','disponibilidadeProjetada','vendasProjetadasTrimestre',projectedTerminal),projectedStockSeries=projectedIVVSeries.map(row=>({...row,valor:row.saldo}));
  const series={ivv_fixo:fixedIVVSeries,ivv_projetado:projectedIVVSeries,saldo_ivv_fixo:fixedStockSeries,saldo_ivv_projetado:projectedStockSeries};
  return { available:true, launchDate:launch, asOf, ageMonths:age, stock,totalUnits, currentIvv:initialIvv, initialIvv, ivvSource, observedSalesDetected:hasRegisteredSales, syntheticLaunchRate:ivvSource==='SINTETICO_LANCAMENTO'?initialIvv:null, segment, segmentLabel:IvvCurves.SEGMENTS[segment], appliedRate:periods[0]?.rates?.[segment]??null, firstProjectedIvv:projectedIvvForMonth(1).ivv, linearMonths:fixedDepletionMonths, actualDepletionMonths:fixedDepletionMonths, maturityMonths:projectedDepletionMonths, projectedDepletionMonths, projectedStockAtHorizon:projectedRemaining, projectionMethod:`${maturityBase.versionLabel} · ${IvvCurves.SEGMENTS[segment]} · fotografia vigente = mês 0; curva avança a cada 3 meses`, bins:periods, base:maturityBase, points, memoriaMensal, series, fixedIVVSeries,fixedStockSeries,projectedIVVSeries,projectedStockSeries, referenceGroup:0 };
}
function buildMaturityProjection(empreendimento, current, interval, maturityBase) {
  const modality=current?.tipoTabela;
  const tables=(empreendimento.tabelas||[]).filter(table=>['registered','superseded'].includes(table.status));
  const commercialIntervals=(empreendimento.intervalosComerciais||[]).filter(row=>!modality||row.modalidade===modality);
  const observedIvv=Number(interval?.ivv);
  const stock=Number(current?.unidades?.filter((unit) => {
    const status=String(unit.situacao ?? unit.situacaoPublicada ?? unit.status ?? unit.situacaoExtraida ?? '').trim().toLocaleLowerCase('pt-BR');
    return status === 'disponível' || status === 'disponivel';
  }).length);
  const totalUnits=Math.max(0,...tables.map(table=>Array.isArray(table.unidades)?table.unidades.length:0),Array.isArray(empreendimento?.unidades)?empreendimento.unidades.length:0);
  const launch=String(empreendimento?.launchDate || '').slice(0,10),asOf=String(current?.validityDate || '').slice(0,10),age=maturityMonthsBetween(launch,asOf);
  if(!maturityBase?.available)return {available:false,reason:maturityBase?.reason||'Base de maturação indisponível.',base:maturityBase||null};
  const standard=selectedEconomicStandard(maturityBase,empreendimento),segment=IvvCurves.segment(standard?.slug||empreendimento.padraoEconomicoId||empreendimento.padrao);
  if(!segment)return {available:false,reason:'Padrão econômico do cadastro sem correspondência nas curvas MCMV, Médio e Alto.',base:maturityBase};
  if(!Number.isInteger(age)||age<0)return {available:false,reason:'Data de lançamento ou fotografia atual inválida para projetar maturidade.',base:maturityBase};
  const hasRealIvv=Number.isFinite(observedIvv)&&observedIvv>0;
  const hasRegisteredSales=commercialIntervals.some(row=>Number(row.vendasConfirmadas??row.sales??0)>0)||(empreendimento.fatosComerciais||[]).some(fact=>fact.tipo==='VENDA_IDENTIFICADA'&&fact.confirmado!==false);
  const syntheticIvv=!hasRealIvv&&!hasRegisteredSales&&age<=6&&totalUnits>0?totalUnits*.15/3:null;
  const initialIvv=hasRealIvv?observedIvv:syntheticIvv,ivvSource=hasRealIvv?'OBSERVADO':'SINTETICO_LANCAMENTO';
  if(!Number.isFinite(stock)||stock<=0)return {available:false,reason:'Estoque disponível insuficiente para projeção de IVV.',base:maturityBase};
  if(!Number.isFinite(initialIvv)||initialIvv<1)return {available:false,reason:age<=6&&hasRegisteredSales?'Há vendas registradas, mas ainda não existe IVV observado suficiente para a projeção.':'Dados insuficientes para projeção de IVV.',base:maturityBase};
  let forecast;
  try { forecast=forecastAbsorption({curve:maturityBase,initialIvv,stock,segment}); }
  catch(error){return {available:false,reason:error.message,validationFailure:true,base:maturityBase};}
  const withDates=(rows)=>rows.map(row=>({...row,dataProjetada:maturityDateOffset(asOf,row.meses)}));
  const series={
    ivv_fixo:withDates(forecast.series.ivv_fixo),
    ivv_projetado:withDates(forecast.series.ivv_projetado),
    saldo_ivv_fixo:withDates(forecast.series.saldo_ivv_fixo),
    saldo_ivv_projetado:withDates(forecast.series.saldo_ivv_projetado)
  };
  const monthly=forecast.monthly.map(row=>({mes:row.month,label:row.month===0?'Atual':`+${row.month} mês${row.month===1?'':'es'}`,ivvMedio:row.fixedIvv,ivvProjetado:row.projectedIvv,vendasIvvMedio:row.fixedSales,vendasIvvProjetado:row.projectedSales,estoqueIvvMedio:row.fixedStock,estoqueIvvProjetado:row.projectedStock,origemProjetada:ivvSource}));
  const points=forecast.audit.map(row=>({
    label:row.horizonteMeses===0?'Atual':`+${row.horizonteMeses} meses`,meses:row.horizonteMeses,
    faixaMaturidade:row.faixa,dataProjetada:maturityDateOffset(asOf,row.horizonteMeses),
    ivv:row.estoqueFixo>0?initialIvv:null,ivvProjetado:row.estoqueProjetado>0?row.ivvProjetado:null,
    ivvTrimestral:Math.min(row.estoqueFixo,initialIvv*3),ivvProjetadoTrimestral:Math.min(row.estoqueProjetado,row.ivvProjetado*3),
    unidadesVendidas:Math.min(stock,stock-row.estoqueFixo),vendasProjetadas:Math.min(stock,stock-row.estoqueProjetado),
    vendasTrimestre:Math.min(row.estoqueFixo,initialIvv*3),vendasProjetadasTrimestre:Math.min(row.estoqueProjetado,row.ivvProjetado*3),
    disponibilidade:row.estoqueFixo,disponibilidadeProjetada:row.estoqueProjetado,origemProjetada:row.regra
  }));
  return {
    available:true,launchDate:launch,asOf,ageMonths:age,stock,totalUnits,currentIvv:initialIvv,initialIvv,ivvSource,
    observedSalesDetected:hasRegisteredSales,syntheticLaunchRate:ivvSource==='SINTETICO_LANCAMENTO'?initialIvv:null,
    segment,segmentLabel:IvvCurves.SEGMENTS[segment],appliedRate:forecast.audit[1]?.taxaAplicada??null,
    firstProjectedIvv:forecast.audit[1]?.ivvProjetado??initialIvv,linearMonths:forecast.fixedDepletionMonths,
    actualDepletionMonths:forecast.fixedDepletionMonths,maturityMonths:forecast.projectedDepletionMonths,
    projectedDepletionMonths:forecast.projectedDepletionMonths,projectedStockAtHorizon:0,
    projectionMethod:`${maturityBase.versionLabel} · ${IvvCurves.SEGMENTS[segment]} · T0 sem redução; curva prospectiva de 3 em 3 meses; cálculo recursivo; piso de 1 un./mês`,
    bins:maturityBase.periods,base:maturityBase,points,memoriaMensal:monthly,
    memoriaTrimestral:forecast.audit.map(row=>({...row,dataProjetada:maturityDateOffset(asOf,row.horizonteMeses)})),series,
    fixedIVVSeries:series.ivv_fixo,fixedStockSeries:series.saldo_ivv_fixo,projectedIVVSeries:series.ivv_projetado,projectedStockSeries:series.saldo_ivv_projetado,referenceGroup:0
  };
}
function buildAnalytics(empreendimento, query = {}) {
  const active = sortTables(empreendimento.tabelas || []); const requestedCurrent = active.find((table) => table.id === query.tabelaAtual); const defaultModality = query.modalidade || requestedCurrent?.tipoTabela || active.find((table) => table.id === empreendimento.tabelaBaseId)?.tipoTabela || active.at(-1)?.tipoTabela || null;
  const tables = active.filter((table) => table.tipoTabela === defaultModality).sort(snapshotOrder); const current = requestedCurrent || tables.at(-1) || null; const previous = active.find((table) => table.id === query.tabelaAnterior) || tables.filter((table) => table.id !== current?.id && snapshotOrder(table, current) < 0).at(-1) || null;
  if (!current) throw new Error('Não há fotografia confirmada nesta modalidade.');
  if (previous && previous.tipoTabela !== current.tipoTabela) { const error = new Error('As fotografias devem pertencer à mesma modalidade comercial.'); error.status = 422; throw error; }
  const filter = analyticsUnitFilter(query);
  const before = new Map((previous?.unidades || []).filter(filter).map((unit) => [unit.chave, analyticsUnit(unit)])); const after = new Map((current.unidades || []).filter(filter).map((unit) => [unit.chave, analyticsUnit(unit)])); const keys = new Set([...before.keys(), ...after.keys()]); const changes = [];
  for (const key of keys) {
    const anterior = before.get(key) || null, atual = after.get(key) || null; let tipo;
    if (!anterior) tipo = atual?.situacao === 'Disponível' ? 'entrou_disponibilidade' : 'unidade_nova';
    else if (!atual) tipo = anterior.situacao === 'Disponível' ? 'saiu_disponibilidade' : 'unidade_ausente';
    else if (anterior.situacao === 'Disponível' && atual.situacao === 'Disponível') tipo = 'permaneceu_disponivel';
    else if (anterior.situacao === 'Disponível') tipo = 'saiu_disponibilidade';
    else if (atual.situacao === 'Disponível') tipo = 'entrou_disponibilidade';
    else if (anterior.situacao !== atual.situacao) tipo = 'mudou_status';
    else tipo = 'sem_alteracao';
    const valueDelta = anterior?.valor != null && atual?.valor != null ? atual.valor - anterior.valor : null; const percentDelta = valueDelta !== null && anterior.valor ? valueDelta / anterior.valor : null; const m2Delta = anterior?.valorM2 != null && atual?.valorM2 != null ? atual.valorM2 - anterior.valorM2 : null; const m2PercentDelta = m2Delta !== null && anterior.valorM2 ? m2Delta / anterior.valorM2 : null;
    changes.push({ chave: key, quadra: atual?.quadra || anterior?.quadra, unidade: atual?.unidade || anterior?.unidade, tipologia: atual?.tipologia || anterior?.tipologia, situacaoAnterior: anterior?.situacao || null, situacaoAtual: atual?.situacao || null, valorAnterior: anterior?.valor ?? null, valorAtual: atual?.valor ?? null, valorM2Anterior: anterior?.valorM2 ?? null, valorM2Atual: atual?.valorM2 ?? null, diferenca: valueDelta, diferencaPercentual: percentDelta, diferencaM2: m2Delta, diferencaM2Percentual: m2PercentDelta, tipo });
  }
  const bridge = { permaneceramDisponiveis: changes.filter((row) => row.tipo === 'permaneceu_disponivel').length, sairamDisponibilidade: changes.filter((row) => row.tipo === 'saiu_disponibilidade').length, entraramDisponibilidade: changes.filter((row) => row.tipo === 'entrou_disponibilidade').length, mudaramStatus: changes.filter((row) => row.tipo === 'mudou_status').length, novas: changes.filter((row) => row.tipo === 'unidade_nova').length, ausentes: changes.filter((row) => row.tipo === 'unidade_ausente').length };
  const priceVariation = comparablePriceAdjustment(previous, current, filter); delete priceVariation.percentuais;
  const adjustmentMonths = monthsBetweenTables(previous, current);
  priceVariation.reajusteAcumulado = priceVariation.reajusteMedioM2;
  priceVariation.mesesReajuste = adjustmentMonths;
  priceVariation.reajusteMensal = Number.isFinite(Number(priceVariation.reajusteMedioM2)) && Number.isFinite(adjustmentMonths) && adjustmentMonths > 0 ? Number(priceVariation.reajusteMedioM2) / adjustmentMonths : null;
  const currentSnapshot = analyticsSnapshot(current, filter), previousSnapshot = analyticsSnapshot(previous, filter); const availableUnits = (current?.unidades || []).filter(filter).map(analyticsUnit); const byAttribute = analyticsStockGroups(availableUnits, 'quadra', currentSnapshot.disponiveis); const byTypology = analyticsStockGroups(availableUnits, 'tipologia', currentSnapshot.disponiveis);
  const plansBefore = previous?.regraInterpretada?.planos || [], plansAfter = current?.regraInterpretada?.planos || []; const sharedPlans = plansAfter.filter((plan) => plansBefore.some((prior) => prior.codigo === plan.codigo)).map((plan) => ({ codigo:plan.codigo, nome:plan.nome, anterior:plansBefore.find((prior) => prior.codigo === plan.codigo)?.componentes || [], atual:plan.componentes || [] })); const payment = !previous ? { status:'sem_comparacao', planos:[] } : sharedPlans.length ? { status:'comparavel', planos:sharedPlans } : { status:'estrutura_nao_comparavel', planos:[] };
  const timeline = monthlySnapshotGroups(tables).map((group) => analyticsSnapshot(group.fechamento, filter)); const topGroup = byAttribute[0]; const interval = intervalForTables(empreendimento, current.tipoTabela, previous, current) || (!previous && tables.length === 1 && active.length === 1 ? launchVelocityFallback(empreendimento, current, filter) : null); const pairFacts = (empreendimento.fatosComerciais || []).filter((fact) => fact.tabelaAnteriorId === previous?.id && fact.tabelaAtualId === current.id); const manualCurrentFacts = (empreendimento.fatosComerciais || []).filter((fact) => fact.tabelaAtualId === current.id && fact.tipo === 'VENDA_IDENTIFICADA' && fact.origem === 'edicao_manual' && fact.confirmado !== false); const facts = [...new Map([...pairFacts, ...manualCurrentFacts].map((fact) => [fact.id, fact])).values()]; const conditionsSummary = commercialConditionsSummary(previous, current);
  const relevantChanges = changes.filter((row) => row.tipo !== 'sem_alteracao' && (row.tipo !== 'permaneceu_disponivel' || Math.abs(row.diferenca || 0) > .005 || Math.abs(row.diferencaM2 || 0) > .005)).sort((a, b) => Math.abs(b.diferencaM2Percentual || 0) - Math.abs(a.diferencaM2Percentual || 0));
  const commercialEvidence = interval && Number(interval.vendasConfirmadas) >= 2 && Number(interval.ivv) >= .5;
  const signals = [previous ? { familia:'estoque', titulo:'Estoque em observação', leitura:`${previousSnapshot.disponiveis} → ${currentSnapshot.disponiveis} unidades disponíveis.`, evidencia:`Fotografias ${previous.id} → ${current.id}.` } : null, commercialEvidence ? { familia:'absorcao', titulo:'Ritmo de absorção', leitura:`${interval.vendasConfirmadas} venda(s) confirmada(s); IVV ${interval.ivv.toLocaleString('pt-BR',{maximumFractionDigits:2})} un./mês${interval.vsoMedioMensal == null ? '' : ` e VSO ${interval.vsoMedioMensal.toLocaleString('pt-BR',{maximumFractionDigits:2})}% a.m.`}.`, evidencia:`Intervalo de ${interval.mesesIntervalo} mês(es): ${interval.mesInicial} → ${interval.mesFinal}.` } : null, priceVariation.reajusteMedioM2 != null ? { familia:'preco', titulo:'Preço comparável', leitura:`Reajuste acumulado de ${(priceVariation.reajusteMedioM2 * 100).toLocaleString('pt-BR',{maximumFractionDigits:2})}% por m²${priceVariation.reajusteMensal == null ? '' : `, equivalente a ${(priceVariation.reajusteMensal * 100).toLocaleString('pt-BR',{maximumFractionDigits:2})}% a.m.`}.`, evidencia:`${priceVariation.unidadesComparaveis} unidade(s) comparável(is) em ${priceVariation.mesesReajuste || '—'} mês(es).` } : null, topGroup ? { familia:'concentracao', titulo:'Concentração de estoque', leitura:`${topGroup.atributo} concentra ${topGroup.participacao == null ? '—' : (topGroup.participacao * 100).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%'} do estoque disponível.`, evidencia:`${topGroup.unidades} unidade(s) e ${topGroup.vgvDisponivel.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})} na fotografia atual.` } : null, (conditionsSummary.incluidos.length || conditionsSummary.removidos.length || conditionsSummary.alteracoesRelevantes.length) ? { familia:'condicoes', titulo:'Condição comercial alterada', leitura:`${conditionsSummary.incluidos.length} plano(s) incluído(s), ${conditionsSummary.removidos.length} removido(s) e ${conditionsSummary.alteracoesRelevantes.length} ajuste(s) identificado(s).`, evidencia:`Comparação de condições: ${previous?.id || 'sem fotografia anterior'} → ${current.id}.` } : null].filter(Boolean).slice(0,4);
  const vendasManuais = facts.filter((fact) => fact.tipo === 'VENDA_IDENTIFICADA' && fact.confirmado !== false).length;
  const executiveSummary = { vgvOfertaAtual:currentSnapshot.vgvDisponivel, estoqueDisponivel:currentSnapshot.disponiveis, participacaoEstoque:currentSnapshot.unidades ? currentSnapshot.disponiveis / currentSnapshot.unidades : null, unidadesFotografia:currentSnapshot.unidades, vendasConfirmadas:interval?.vendasConfirmadas ?? (vendasManuais || null), ivv:interval?.ivv ?? interval?.monthly ?? null, vso:interval?.vsoMedioMensal ?? null, ticketMedio:currentSnapshot.precoMedio, precoMedioM2:currentSnapshot.precoMedioM2, reajusteMedio:priceVariation.reajusteMensal, reajusteAcumulado:priceVariation.reajusteAcumulado, mesesReajuste:priceVariation.mesesReajuste, unidadesComparaveis:priceVariation.unidadesComparaveis };
  const historicalIntervals = (empreendimento.intervalosComerciais || []).filter((item) => item.modalidade === current.tipoTabela && (!query.de || item.mesFinal >= String(query.de).slice(0,7)) && (!query.ate || item.mesInicial <= String(query.ate).slice(0,7))).map((item) => filteredHistoricalInterval(empreendimento,item,filter)).filter(Boolean); const fallbackHistory = interval?.tipoObservacao === 'DERIVADO_LANCAMENTO' ? [interval] : []; let cumulativeSales=0; const velocityHistory=[...historicalIntervals, ...fallbackHistory].sort((a,b) => a.mesFinal.localeCompare(b.mesFinal)).map((item) => ({ ...item, vendasAcumuladas:(cumulativeSales += item.vendasConfirmadas) }));
  return { empreendimento:{ id:empreendimento.id, nome:empreendimento.nome, launchDate:empreendimento.launchDate || null }, perfilExecutivo:analyticsExecutiveProfile(empreendimento, current), resumoExecutivo:executiveSummary, sinais:signals, modalidade:{ id:current.tipoTabela, label:current.tipoTabelaLabel }, modalidades:modalitySummaries(empreendimento).map((item) => ({ id:item.id, label:item.label, versoes:item.versoes?.length || 0 })), filtros:{ quadra:query.quadra || query.bloco || '', tipologia:query.tipologia || '', status:query.status || '' }, tabelas:tables.map((table) => tableSummary(table, empreendimento)), tabelaAtual:tableSummary(current, empreendimento), tabelaAnterior:previous ? tableSummary(previous, empreendimento) : null, atual:currentSnapshot, anterior:previousSnapshot, ponteEstoque:bridge, variacaoPreco:priceVariation, alteracoes:relevantChanges, alteracoesRelevantes:relevantChanges, evolucao:timeline, velocidadeHistorica:velocityHistory, porAtributo:byAttribute, estoquePorBloco:byAttribute, estoquePorTipologia:byTypology, condicoesPagamento:payment, condicoesResumo:conditionsSummary, intervalo:interval, ivv:interval?.ivv ?? null, vso:interval?.vsoMedioMensal ?? null, fatos:facts, insights:signals.map((item) => item.leitura), opcoes:{ quadras:[...new Set((current.unidades || []).map((unit) => analyticsUnit(unit).quadra))].sort(), tipologias:[...new Set((current.unidades || []).map((unit) => analyticsUnit(unit).tipologia))].sort(), status:UNIT_STATUSES } };
}
function enterpriseNexumReading(analytics) {
  const summary=analytics.resumoExecutivo || {}, interval=analytics.intervalo, pressure=analytics.marketPressure?.influence, context=analytics.contextoCompetitivo || {}, territoryRadius=Number(context.territorial?.raioKm || 2), influenceRadius=Number(context.raioEfetivoKm || 3), influenceIntro=context.raioExpandido ? 'Como o raio primário de 3 km não reuniu comparáveis suficientes, a leitura foi ampliada para 5 km.' : 'No raio primário de 3 km do empreendimento,', topStock=(analytics.estoquePorBloco || [])[0], radar=analytics.radarNexum || {}, iap=Number(radar.values?.iap), price=radar.price || {}, differential=radar.differential, hasComparablePrice=Number(price.value) > 0 && Number(price.reference) > 0, statements=[];
  const commercialEvidence=interval && Number(interval.vendasConfirmadas) >= 2 && Number(interval.ivv) >= .5, hasIap=Number.isFinite(iap), stockChanged=Boolean(analytics.tabelaAnterior && Number.isFinite(Number(analytics.anterior?.disponiveis)) && Number.isFinite(Number(analytics.atual?.disponiveis)));
  if (stockChanged) statements.push(`A oferta disponível passou de ${analytics.anterior.disponiveis} para ${analytics.atual.disponiveis} unidades entre as fotografias comparadas.`);
  else statements.push(`A fotografia atual reúne ${summary.estoqueDisponivel || 0} unidades disponíveis.`);
  if (commercialEvidence) { const ivv=Number(interval.ivv).toLocaleString('pt-BR',{maximumFractionDigits:2}), vso=Number.isFinite(Number(interval.vsoMedioMensal)) ? ` e VSO mensal de ${Number(interval.vsoMedioMensal).toLocaleString('pt-BR',{maximumFractionDigits:2})}%` : ''; statements.push(`O histórico disponível reúne ${interval.vendasConfirmadas} vendas distribuídas em aproximadamente ${interval.mesesIntervalo} meses, resultando em IVV de ${ivv} un./mês${vso}.`); const absorption=Number(summary.estoqueDisponivel)>0&&Number(interval.ivv)>0?Number(summary.estoqueDisponivel)/Number(interval.ivv):null; if (Number.isFinite(absorption)) statements.push(`Mantido esse ritmo de referência, as ${summary.estoqueDisponivel} unidades disponíveis representam aproximadamente ${absorption.toLocaleString('pt-BR',{maximumFractionDigits:1})} meses de absorção.`); }
  else if (hasIap) statements.push(`O IAP (Índice de Aceitação de Preço) está em ${iap.toLocaleString('pt-BR',{maximumFractionDigits:1})}/100, com ${String(radar.iap?.band || 'aceitação relativa').toLowerCase()}; a leitura combina preço relativo, VSO, IVV, absorção e cobertura disponíveis.`);
  else if (interval) statements.push('O intervalo comercial atual ainda não tem massa suficiente para caracterizar um ritmo; a próxima fotografia ajudará a confirmar a tendência.');
  if (hasIap && !statements.some((text) => text.includes('IAP'))) statements.push(`O IAP (Índice de Aceitação de Preço) está em ${iap.toLocaleString('pt-BR',{maximumFractionDigits:1})}/100, classificado como ${String(radar.iap?.band || 'aceitação relativa').toLowerCase()}.`);
  if (hasComparablePrice) { const relative=Number(price.relative), position=Number.isFinite(relative) ? `${Math.abs(relative).toLocaleString('pt-BR',{maximumFractionDigits:1})}% ${relative >= 0 ? 'acima da' : 'abaixo da'}` : 'frente à'; statements.push(`O preço médio por m² está em ${Number(price.value).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}, ${position} referência comparável de ${Number(price.reference).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}.`); }
  else if (analytics.variacaoPreco?.reajusteMedioM2 != null && analytics.variacaoPreco?.unidadesComparaveis) statements.push(`O recorte comparável registrou variação média de ${(Number(analytics.variacaoPreco.reajusteMedioM2) * 100).toLocaleString('pt-BR',{maximumFractionDigits:2})}% por m² em ${analytics.variacaoPreco.unidadesComparaveis} unidades.`);
  if (pressure?.calculation_status === 'calculated') statements.push(`No entorno territorial de ${territoryRadius.toLocaleString('pt-BR',{maximumFractionDigits:2})} km, a variação do IPD é ${pressure.ipd_indicator?.label || 'sem comparação'} e a do IPO é ${pressure.ipo_indicator?.label || 'sem comparação'}.`);
  const competitors=context.concorrentes||[], references=context.referenciasMercado||[], neighborhood=analytics.perfilExecutivo?.bairro||analytics.contextoCompetitivo?.territorial?.bairro||'';
  if (competitors.length) statements.push(`${influenceIntro} ${competitors.slice(0,2).map((item) => item.nome).join(' e ')} compõem a referência direta do ativo${neighborhood ? ` em ${neighborhood}` : ''}.`);
  else if (references.length) statements.push(`${influenceIntro} a leitura competitiva foi complementada por ${references.slice(0,2).map((item) => item.nome).join(' e ')}, como referência territorial próxima.`);
  else statements.push(`Não há dados comparáveis suficientes no raio de até ${influenceRadius.toLocaleString('pt-BR',{maximumFractionDigits:2})} km para atribuir uma leitura competitiva direta ao empreendimento.`);
  const differentialLabels={vso:'VSO',ivv:'IVV',absorption:'absorção',coverage:'cobertura',adjustment:'reajuste'};
  if (differential) statements.push(`Dentro do grupo comparável, o diferencial relativo está em ${differentialLabels[differential.metric] || differential.metric}, ${differential.direction === 'acima' ? 'acima' : 'abaixo'} da mediana de ${differential.groupCount} ativos.`);
  const differentialHeadline=differential ? `O diferencial do ativo está em ${differentialLabels[differential.metric] || differential.metric}, ${differential.direction === 'acima' ? 'acima' : 'abaixo'} do grupo comparável.` : null;
  const pressureDemand=Number(pressure?.ipd_indicator?.value ?? pressure?.ipd), pressureSupply=Number(pressure?.ipo_indicator?.value ?? pressure?.ipo), territorialHeadline=commercialEvidence && Number(interval.ivv) >= 3 && pressure?.calculation_status === 'calculated' && Number.isFinite(pressureDemand) && Number.isFinite(pressureSupply) && pressureDemand <= -80 && pressureSupply <= -80 ? `O entorno de ${neighborhood || 'referência'} registra retração de ${Math.abs(pressureDemand).toLocaleString('pt-BR',{maximumFractionDigits:1})}% na demanda e ${Math.abs(pressureSupply).toLocaleString('pt-BR',{maximumFractionDigits:1})}% na oferta.` : !commercialEvidence && pressure?.calculation_status === 'calculated' && Number.isFinite(pressureDemand) && Number.isFinite(pressureSupply) && pressureDemand >= 0 && pressureSupply < 0 ? `O entorno combina demanda em alta e oferta em retração, um sinal favorável para o posicionamento do ativo.` : !commercialEvidence && pressure?.calculation_status === 'calculated' && Number.isFinite(pressureSupply) && pressureSupply < 0 ? `A oferta do entorno registra retração de ${Math.abs(pressureSupply).toLocaleString('pt-BR',{maximumFractionDigits:1})}%, enquanto a demanda não tem base suficiente para uma conclusão equivalente.` : !commercialEvidence && pressure?.calculation_status === 'calculated' && Number.isFinite(pressureDemand) && pressureDemand > 0 ? `A demanda do entorno registra alta de ${pressureDemand.toLocaleString('pt-BR',{maximumFractionDigits:1})}%, sinalizando maior pressão sobre o mercado local.` : null;
  const priceHeadline=hasComparablePrice && Number.isFinite(Number(price.relative)) ? (Number(price.relative)>10 ? `O preço médio está acima da referência do grupo e pede validação de aceitação.` : Number(price.relative)<-10 ? `O preço médio está abaixo da referência do grupo, reforçando o posicionamento competitivo.` : `O preço médio permanece próximo da referência do grupo comparável.`) : null;
  const iapHeadline=hasIap ? (iap>=60 ? `A aceitação de preço aparece favorável no recorte atual.` : iap<=40 ? `A aceitação de preço requer atenção antes de ampliar a oferta.` : `A aceitação de preço permanece intermediária e precisa de nova evidência.`) : null;
  const pressureHeadline=pressure?.calculation_status === 'calculated' ? (Number(pressure.ipd)>0 && Number(pressure.ipo)<0 ? `O entorno combina demanda positiva com oferta em retração.` : Number(pressure.ipd)>0 && Number(pressure.ipo)>0 ? `O entorno mostra pressão simultânea de demanda e oferta.` : `O entorno apresenta pressão moderada no recorte territorial.`) : null;
  const headline=territorialHeadline || differentialHeadline || (commercialEvidence && analytics.atual.disponiveis < analytics.anterior.disponiveis ? `A oferta de ${summary.estoqueDisponivel} unidades acompanha um ritmo comercial de ${Number(interval.ivv).toLocaleString('pt-BR',{maximumFractionDigits:2})} unidades/mês.` : priceHeadline || iapHeadline || (stockChanged ? `A composição da oferta mudou entre as fotografias comparadas.` : pressureHeadline || `Ainda não há evidência suficiente para definir o principal diferencial deste empreendimento.`));
  let recommendation='Aguardar a próxima fotografia para confirmar tendência antes de alterar preço ou condição comercial.';
  if (topStock?.participacao >= .4) recommendation=`Priorizar o acompanhamento de ${topStock.atributo}, que concentra ${(topStock.participacao*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do estoque disponível.`;
  else if (hasIap) recommendation='Usar o IAP como referência de posicionamento e confirmar a decisão com a próxima fotografia comparável.';
  else if (commercialEvidence) recommendation='Manter o acompanhamento do ritmo de absorção e validar sua continuidade na próxima fotografia.';
  const editorialFacts = [];
  if (stockChanged) editorialFacts.push({ id:'estoque:variacao', kind:'offer_update', family:'oferta', text:statements[0], score:EDITORIAL_WEIGHTS.offer_update, confidence:analytics.tabelaAnterior ? 'MÉDIA' : 'BAIXA' });
  if (commercialEvidence) editorialFacts.push({ id:'performance:velocidade', kind:'performance_context', family:'performance', text:statements.find((text) => text.includes('vendas')) || statements[1], score:94, strategicWeight:1.5, confidence:interval.mesesIntervalo >= 6 ? 'ALTA' : interval.mesesIntervalo >= 3 ? 'MÉDIA' : 'BAIXA' });
  if (analytics.variacaoPreco?.reajusteMedioM2 != null || hasComparablePrice) editorialFacts.push({ id:'preco:posicionamento', kind:'price_update', family:'preco', text:statements.find((text) => text.includes('preço')) || statements[2], score:EDITORIAL_WEIGHTS.price_update, confidence:analytics.variacaoPreco?.unidadesComparaveis >= 3 ? 'MÉDIA' : 'BAIXA' });
  if (pressure?.calculation_status === 'calculated') editorialFacts.push({ id:'pressao:entorno', kind:'market_pressure', family:'pressao_de_mercado', text:statements.find((text) => text.includes('entorno')) || null, score:EDITORIAL_WEIGHTS.market_pressure, confidence:pressure.confidence || 'MÉDIA' });
  if (competitors.length || references.length) editorialFacts.push({ id:'competitivo:referencias', kind:'performance_context', family:'cenário_competitivo', text:statements.find((text) => text.includes('comparáveis') || text.includes('referência territorial')) || null, score:82, confidence:'MÉDIA' });
  if (differential) editorialFacts.push({ id:'diferencial:grupo', kind:'performance_context', family:'diferencial_relativo', text:statements.find((text) => text.includes('diferencial relativo')) || null, score:90, confidence:differential.groupCount>=5 ? 'MÉDIA' : 'BAIXA' });
  if (hasIap) editorialFacts.push({ id:'iap:aceitacao', kind:'performance_context', family:'posicionamento', text:`O IAP (Índice de Aceitação de Preço) está em ${iap.toLocaleString('pt-BR',{maximumFractionDigits:0})}/100, classificado como ${String(radar.iap?.band || 'aceitação relativa').toLowerCase()}. O resultado combina velocidade, absorção, cobertura e posicionamento de preço.`, score:88, confidence:radar.iap?.missing?.length ? 'BAIXA' : 'MÉDIA' });
  const editorial = buildEditorialReading(editorialFacts.filter((fact) => fact.text), { maxModules:4, hasPortfolio:true, context:{ type:'enterprise', enterpriseId:analytics.empreendimento?.id || null } });
  return { titulo:'Leitura NEXUM', headline, executiva:(editorial.paragraphs.length ? editorial.paragraphs : statements.slice(0,3)).slice(0,4), recomendacao:recommendation, editorial, evidencia:{ fotografiaAtual:analytics.tabelaAtual?.id || null, fotografiaAnterior:analytics.tabelaAnterior?.id || null, intervaloId:interval?.id || null, raioKm:context.raioEfetivoKm || null, concorrentesCompativeis:(context.concorrentes || []).length } };
}
function monthFromIndex(index) { const year = Math.floor((index - 1) / 12), month = ((index - 1) % 12) + 1; return `${year}-${String(month).padStart(2, '0')}`; }
function filteredHistoricalInterval(empreendimento, interval, filter = () => true) {
  const previous = (empreendimento.tabelas || []).find((table) => table.id === interval.fotografiaAnteriorId), current = (empreendimento.tabelas || []).find((table) => table.id === interval.fotografiaAtualId); if (!previous || !current) return null;
  const before = new Map((previous.unidades || []).map(analyticsUnit).map((unit) => [unit.chave, unit])), after = new Map((current.unidades || []).map(analyticsUnit).map((unit) => [unit.chave, unit]));
  const stockBase = [...before.values()].filter((unit) => unit.situacao === 'Disponível' && filter(unit)).length; const saleKeys = (interval.vendasChaves || []).filter((key) => { const unit = after.get(key) || before.get(key); return unit && filter(unit); }); const sales = saleKeys.length, months = interval.mesesIntervalo; const periodVso = stockBase > 0 ? (sales / stockBase) * 100 : null;
  return { ...interval, estoqueBase:stockBase, vendasConfirmadas:sales, vendasChaves:saleKeys, ivv:months > 0 ? sales / months : null, vsoPeriodo:periodVso, vsoMedioMensal:periodVso == null || months <= 0 ? null : periodVso / months };
}
function enterprisePortfolioContext(empreendimento, query = {}) {
  const active = sortTables(empreendimento.tabelas || []); const base = active.find((table) => table.id === empreendimento.tabelaBaseId); const modality = query.modalidade || base?.tipoTabela || active.at(-1)?.tipoTabela || null; const groups = monthlySnapshotGroups(active.filter((table) => table.tipoTabela === modality)); const until = query.ate ? calendarMonth(query.ate)?.key : null; const eligible = groups.filter((group) => !until || group.mes <= until); const group = eligible.at(-1), previousGroup = eligible.at(-2); if (!group) return null;
  const filter = analyticsUnitFilter(query), current = group.fechamento, previous = previousGroup?.fechamento || null, snapshot = analyticsSnapshot(current, filter), adjustment = comparablePriceAdjustment(previous, current, filter), reajusteMensal = normalizedEnterpriseAdjustment(previous, current); const intervals = (empreendimento.intervalosComerciais || []).filter((interval) => interval.modalidade === modality).map((interval) => filteredHistoricalInterval(empreendimento, interval, filter)).filter(Boolean); const fallback = !previous && active.length === 1 ? launchVelocityFallback(empreendimento, current, filter) : null;
  return { empreendimento, modalidade:modality, grupos:eligible, grupo:group, grupoAnterior:previousGroup || null, current, previous, snapshot, adjustment, reajusteMensal, intervals, fallback };
}
function buildRadarAnalyticalInput(data, query = {}) {
  const requested = new Set(queryEnterpriseIds(query)), unitFilter = analyticsUnitFilter({ ...query, status:'' });
  return (data.empreendimentos || []).filter(item => item.status !== 'inactive' && (!requested.size || requested.has(item.id)))
    .map(item => enterprisePortfolioContext(item, query)).filter(Boolean).map(context => {
      const enterprise = context.empreendimento, until = String(query.ate || context.current.validityDate).slice(0,7), from = String(query.de || '').slice(0,7);
      // Reuse the commercial interval service unchanged; never read zero-filled scatter defaults.
      const interval = context.intervals.filter(item => item.mesFinal <= until && (!from || item.mesFinal >= from)).sort((a,b) => a.mesFinal.localeCompare(b.mesFinal) || a.mesInicial.localeCompare(b.mesInicial)).at(-1);
      const history = sortTables(enterprise.tabelas || []).filter(table => table.tipoTabela === context.modalidade && String(table.validityDate).slice(0,7) <= until)
        .map(table => ({ id:table.id, date:table.validityDate, order:table.createdAt, units:(table.unidades || []).map(analyticsUnit).filter(unitFilter).map(unit => ({ id:unit.chave, available:unit.situacao === 'Disponível', price:unit.valor, priceM2:unit.valorM2 })) }));
      return { id:enterprise.id, name:enterprise.nome, city:enterprise.cidade, neighborhood:enterprise.bairro,
        type:enterprise.tipo, standard:enterprise.padrao, characteristics:normalizeEnterpriseCharacteristics(enterprise.caracteristicasImovel), modality:context.modalidade, priceM2:context.snapshot.precoMedioM2,
        available:context.snapshot.disponiveis, vso:interval?.vsoMedioMensal ?? null, ivv:interval?.ivv ?? null,
        velocityPeriod:interval ? { from:interval.mesInicial, to:interval.mesFinal, observation:interval.tipoObservacao } : null,
        absorptionBlocked:query.status && query.status !== 'Disponível' ? 'O filtro de situação exclui disponibilidade; absorção e cobertura ficam N/D.' : null,
        history };
    });
}
function buildPortfolioAnalytics(data, query = {}) {
  const requestedIds = String(query.empreendimentos || query.empreendimento || '').split(',').map((value) => value.trim()).filter(Boolean); const requested = new Set(requestedIds); const allEnterprises = (data.empreendimentos || []).filter((item) => item.status !== 'inactive'); const selectedEnterprises = requested.size ? allEnterprises.filter((item) => requested.has(item.id)) : allEnterprises; const contexts = selectedEnterprises.map((item) => enterprisePortfolioContext(item, query)).filter(Boolean);
  const allMonths = contexts.flatMap((context) => context.grupos.map((group) => group.mes)); const latestMonth = allMonths.sort().at(-1) || calendarMonth(now())?.key; const latestIndex = calendarMonth(latestMonth)?.index; const defaultFrom = latestIndex ? monthFromIndex(latestIndex - 11) : null; const from = calendarMonth(query.de)?.key || defaultFrom, until = calendarMonth(query.ate)?.key || latestMonth;
  const intervalRows = contexts.flatMap((context) => (context.intervals.length ? context.intervals : context.fallback ? [context.fallback] : []).filter((interval) => (!from || interval.mesFinal >= from) && (!until || interval.mesInicial <= until)).map((interval) => ({ enterpriseId:context.empreendimento.id, enterpriseName:context.empreendimento.nome, interval })));
  const velocityMonths = [...new Set(intervalRows.flatMap((row) => row.interval.mesesCobertos || []))].filter((month) => (!from || month >= from) && (!until || month <= until)).sort();
  const consolidatedVelocity = velocityMonths.map((month) => { const contributions = intervalRows.filter((row) => (row.interval.mesesCobertos || []).includes(month)); const equivalentSales = sum(contributions.map((row) => row.interval.vendasConfirmadas / row.interval.mesesIntervalo)); const base = sum(contributions.map((row) => row.interval.estoqueBase)); return { mes:month, ivv:sum(contributions.map((row) => row.interval.ivv)), vso:base > 0 ? (equivalentSales / base) * 100 : null, vendasMensaisEquivalentes:equivalentSales, estoqueBase:base, tipoObservacao:contributions.some((row) => row.interval.tipoObservacao === 'DERIVADO_INTERVALO') ? 'DERIVADO_INTERVALO' : 'OBSERVADO', intervalos:contributions.map((row) => ({ empreendimentoId:row.enterpriseId, fotografiaAnteriorId:row.interval.fotografiaAnteriorId, fotografiaAtualId:row.interval.fotografiaAtualId, mesInicial:row.interval.mesInicial, mesFinal:row.interval.mesFinal, meses:row.interval.mesesIntervalo, vendas:row.interval.vendasConfirmadas })) }; });
  const photoRows = contexts.flatMap((context) => context.grupos.filter((group) => (!from || group.mes >= from) && (!until || group.mes <= until)).map((group, index, groups) => { const filter = analyticsUnitFilter(query), snapshot = analyticsSnapshot(group.fechamento, filter), previous = index ? groups[index - 1].fechamento : null, adjustment = comparablePriceAdjustment(previous, group.fechamento, filter); const availableUnits = (group.fechamento.unidades || []).map(analyticsUnit).filter((unit) => unit.situacao === 'Disponível' && filter(unit)); return { enterpriseId:context.empreendimento.id, enterpriseName:context.empreendimento.nome, mes:group.mes, fotografiaId:group.fechamento.id, snapshot, adjustment, availablePrices:availableUnits.map((unit) => unit.valor).filter(Number.isFinite) }; }));
  const photoMonths = [...new Set(photoRows.map((row) => row.mes))].sort(); const consolidatedPhotos = photoMonths.map((month) => { const rows = photoRows.filter((row) => row.mes === month), prices = rows.flatMap((row) => row.availablePrices), pricesM2 = rows.map((row) => row.snapshot.precoMedioM2).filter(Number.isFinite), adjustments = rows.flatMap((row) => row.adjustment.percentuais); return { mes:month, fotografias:rows.map((row) => row.fotografiaId), disponiveis:sum(rows.map((row) => row.snapshot.disponiveis)), ticketMedio:prices.length ? sum(prices) / prices.length : null, precoMedioM2:pricesM2.length ? average(pricesM2) : null, vgvDisponivel:sum(rows.map((row) => row.snapshot.vgvDisponivel)), reajusteMedio:average(adjustments), unidadesComparaveis:adjustments.length }; });
  const currentAvailableUnits = contexts.flatMap((context) => (context.current.unidades || []).map(analyticsUnit).filter((unit) => unit.situacao === 'Disponível' && analyticsUnitFilter(query)(unit))); const currentPrices = currentAvailableUnits.map((unit) => unit.valor).filter(Number.isFinite), currentPricesM2 = currentAvailableUnits.map((unit) => unit.valorM2).filter(Number.isFinite); const eligibleAdjustments = contexts.map((context) => context.reajusteMensal).filter((item) => item?.elegivel); const currentAdjustments = eligibleAdjustments.map((item) => item.reajusteMensal); const currentIntervals = contexts.map((context) => { const actual = context.intervals.filter((interval) => (!until || interval.mesFinal <= until)).at(-1); return actual || (context.fallback && (!until || context.fallback.mesFinal <= until) && (!from || context.fallback.mesFinal >= from) ? context.fallback : null); }).filter(Boolean); const pooledMonthlySales = sum(currentIntervals.map((interval) => interval.ivv ?? interval.monthly ?? ((interval.vendasConfirmadas ?? interval.sales ?? 0) / (interval.mesesIntervalo || interval.intervalMonths || 1)))), pooledBase = sum(currentIntervals.map((interval) => interval.estoqueBase));
  const priceBandDefinitions = [{ id:'ate-500', label:'Até R$ 500 mil', from:0, to:500000 },{ id:'500-800', label:'R$ 500 a 800 mil', from:500000, to:800000 },{ id:'800-1200', label:'R$ 800 mil a 1,2 mi', from:800000, to:1200000 },{ id:'acima-1200', label:'Acima de R$ 1,2 mi', from:1200000, to:Infinity }]; const priceBands = priceBandDefinitions.map((band) => ({ id:band.id, label:band.label, unidades:currentAvailableUnits.filter((unit) => Number.isFinite(unit.valor) && unit.valor >= band.from && unit.valor < band.to).length }));
  const kpis = { empreendimentos:contexts.length, unidades:sum(contexts.map((context) => context.snapshot.unidades)), disponiveis:sum(contexts.map((context) => context.snapshot.disponiveis)), reajusteMedio:average(currentAdjustments), reajusteMedioMensal:average(currentAdjustments), empreendimentosComReajuste:eligibleAdjustments.length, unidadesComparaveis:sum(eligibleAdjustments.map((item) => item.unidadesComparaveis)), ticketMedio:currentPrices.length ? sum(currentPrices) / currentPrices.length : null, precoMedioM2:currentPricesM2.length ? average(currentPricesM2) : null, vgvDisponivel:sum(contexts.map((context) => context.snapshot.vgvDisponivel)), ivv:sum(currentIntervals.map((interval) => interval.ivv ?? interval.monthly)), vso:pooledBase > 0 ? (pooledMonthlySales / pooledBase) * 100 : null, estoqueBase:pooledBase, vendasMensaisEquivalentes:pooledMonthlySales, vendasConfirmadas:sum(currentIntervals.map((interval) => interval.vendasConfirmadas ?? interval.sales)) };
  const individualSeries = contexts.map((context) => ({ empreendimentoId:context.empreendimento.id, nome:context.empreendimento.nome, velocidade:velocityMonths.map((month) => { const rows = context.intervals.filter((interval) => (interval.mesesCobertos || []).includes(month)); const equivalentSales = sum(rows.map((interval) => interval.vendasConfirmadas / interval.mesesIntervalo)), baseStock = sum(rows.map((interval) => interval.estoqueBase)); return rows.length ? { mes:month, ivv:sum(rows.map((interval) => interval.ivv)), vso:baseStock > 0 ? (equivalentSales / baseStock) * 100 : null, tipoObservacao:rows.some((interval) => interval.tipoObservacao === 'DERIVADO_INTERVALO') ? 'DERIVADO_INTERVALO' : 'OBSERVADO' } : null; }).filter(Boolean), fotografias:photoRows.filter((row) => row.enterpriseId === context.empreendimento.id).map((row) => ({ mes:row.mes, disponiveis:row.snapshot.disponiveis, ticketMedio:row.snapshot.precoMedio, vgvDisponivel:row.snapshot.vgvDisponivel, reajusteMedio:row.adjustment.reajusteMedioM2, fotografiaId:row.fotografiaId })) }));
  // The drawer is navigation context, not a second filter. Its rows must therefore
  // be built from the exact contexts used by every KPI and chart above.
  const enterprises = contexts.map((context) => { const interval = context.intervals.at(-1); return { id:context.empreendimento.id, nome:context.empreendimento.nome, launchDate:context.empreendimento.launchDate || null, cidade:context.empreendimento.cidade || '', bairro:context.empreendimento.bairro || '', selecionado:requested.has(context.empreendimento.id), unidades:context.snapshot.unidades || 0, disponiveis:context.snapshot.disponiveis || 0, ticketMedio:context.snapshot.precoMedio || null, vgvDisponivel:context.snapshot.vgvDisponivel || 0, ivv:interval?.ivv ?? null, vso:interval?.vsoMedioMensal ?? null }; }).sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'));
  const scatter = contexts.map((context) => { const interval = context.intervals.at(-1); return context.snapshot.precoMedio != null ? { empreendimentoId:context.empreendimento.id, empreendimento:context.empreendimento.nome, bairro:context.empreendimento.bairro || 'Bairro não informado', tipo:context.empreendimento.tipo || 'Não informado', padrao:context.empreendimento.padrao || 'Indefinido', precoMedioM2:context.snapshot.precoMedioM2, ticketMedio:context.snapshot.precoMedio, ivv:interval?.ivv ?? 0, vso:interval?.vsoMedioMensal ?? 0, vgvDisponivel:context.snapshot.vgvDisponivel, disponiveis:context.snapshot.disponiveis, periodo:{ mesInicial:interval?.mesInicial || '', mesFinal:interval?.mesFinal || '', meses:interval?.mesesIntervalo || 0 } } : null; }).filter(Boolean);
  const geographic = scatter.map((point) => { const enterprise = allEnterprises.find((item) => item.id === point.empreendimentoId); return hasValidCoordinates(enterprise?.latitude, enterprise?.longitude) ? { ...point, latitude:Number(enterprise.latitude), longitude:Number(enterprise.longitude), localizacao:[enterprise.bairro,enterprise.cidade,enterprise.estado].filter(Boolean).join(' · '), fonteLocalizacao:enterprise.geocodeStatus || 'cadastrada' } : null; }).filter(Boolean);
  const modalities = [...new Map(allEnterprises.flatMap((enterprise) => sortTables(enterprise.tabelas || []).map((table) => [table.tipoTabela, table.tipoTabelaLabel || TABLE_TYPE_LABELS[table.tipoTabela]]))).entries()].map(([id,label]) => ({ id,label })); const typologies = [...new Set(allEnterprises.flatMap((enterprise) => sortTables(enterprise.tabelas || []).flatMap((table) => (table.unidades || []).map((unit) => analyticsUnit(unit).tipologia))))].sort();
  return { contexto:'portfolio', filtros:{ empreendimentos:[...requested], modalidade:query.modalidade || '', tipologia:query.tipologia || '', status:query.status || '', de:from, ate:until }, opcoes:{ modalidades:modalities, tipologias:typologies, status:UNIT_STATUSES }, kpis, empreendimentos:enterprises, faixasPreco:priceBands, fotografiasReais:photoRows.map((row) => ({ empreendimentoId:row.enterpriseId, empreendimento:row.enterpriseName, mes:row.mes, fotografiaId:row.fotografiaId })), intervalos:intervalRows.map((row) => ({ empreendimentoId:row.enterpriseId, empreendimento:row.enterpriseName, ...row.interval })), vendasConfirmadas:sum(intervalRows.map((row) => row.interval.vendasConfirmadas ?? row.interval.sales)), series:{ consolidada:{ velocidade:consolidatedVelocity, fotografias:consolidatedPhotos }, individuais:individualSeries }, dispersao:scatter, pontosGeograficos:geographic };
}
// A seleção de sinais para publicação passa pelo motor editorial. Regras de
// cálculo e rankings seguem neste serviço; redação e segurança ficam isoladas.
function homeDate(value) { const date = Date.parse(`${String(value || '').slice(0, 10)}T12:00:00`); return Number.isFinite(date) ? date : null; }
function homeDaysAgo(value, reference = Date.now()) { const date = homeDate(value); return date == null ? null : Math.floor((reference - date) / 86400000); }
function enterpriseFirstTableDate(enterprise) { return (enterprise?.tabelas || []).map((table) => String(table?.validityDate || table?.validade || table?.dataValidade || table?.createdAt || '').slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(0) || null; }
function homePhase(value, launchDate = null, reference = Date.now()) { if (value !== 'Lançamento') return ENTERPRISE_PHASES.includes(value) ? value : 'Novo'; const startedAt = homeDate(launchDate); if (startedAt == null) return 'Lançamento'; const transition = new Date(startedAt); transition.setMonth(transition.getMonth() + 3); return reference >= transition.getTime() ? 'Novo' : 'Lançamento'; }
function parseRule(value) { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } }
function conditionChangeLabel(fact) {
  const before = parseRule(fact.regraAnterior), after = parseRule(fact.regraAtual); const priorEntry = (before.componentes || []).find((item) => item.id === 'entrada'), currentEntry = (after.componentes || []).find((item) => item.id === 'entrada');
  if (!priorEntry || !currentEntry) return `alterou uma condição comercial no plano ${fact.plano || 'vigente'}`;
  const priorValue = priorEntry.percentual != null ? `${Number(priorEntry.percentual).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : priorEntry.valor != null ? `R$ ${Number(priorEntry.valor).toLocaleString('pt-BR',{maximumFractionDigits:0})}` : null;
  const currentValue = currentEntry.percentual != null ? `${Number(currentEntry.percentual).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : currentEntry.valor != null ? `R$ ${Number(currentEntry.valor).toLocaleString('pt-BR',{maximumFractionDigits:0})}` : null;
  return priorValue && currentValue && priorValue !== currentValue ? `alterou a entrada de ${priorValue} para ${currentValue}` : `alterou uma condição comercial no plano ${fact.plano || 'vigente'}`;
}
function buildPortfolioHome(data, query = {}, userId = '') {
  const today = Date.now(), recentDays = 30, saleWindow = 90;
  const favorites = new Set((data.userFavorites || []).filter((item) => item.user_id === userId).map((item) => item.enterprise_id));
  const selectedIds = new Set(queryEnterpriseIds(query));
  const matches = (enterprise, radar) => (!selectedIds.size || selectedIds.has(enterprise.id)) && matchesSharedEnterpriseFilters(enterprise, query, favorites);
const entries = (data.empreendimentos || []).filter((enterprise) => enterprise.status !== 'inactive').map((enterprise) => { const radar = buildRadar(enterprise), normalizedAdjustment = latestEnterpriseAdjustment(enterprise), facts = enterprise.fatosComerciais || [], latestDate = radar.latestTable?.validityDate || null, latestAge = homeDaysAgo(latestDate, today), recentTable = latestAge != null && latestAge <= recentDays; const sales = facts.filter((fact) => fact.tipo === 'VENDA_IDENTIFICADA' && fact.confirmado !== false); const sales90 = sales.filter((fact) => { const age = homeDaysAgo(fact.dataValidade, today); return age != null && age >= 0 && age <= saleWindow; }); const lastSale = sales.map((fact) => fact.dataValidade).filter(Boolean).sort().at(-1) || null; const latestFacts = facts.filter((fact) => fact.tabelaAtualId === radar.latestTable?.id); const firstTableDate = enterpriseFirstTableDate(enterprise); const phase = homePhase(enterprise.fase, enterprise.launchDate || firstTableDate, today); return { id:enterprise.id, nome:String(enterprise.nome || '').trim(), construtora:String(enterprise.construtora || '').trim(), bairro:String(enterprise.bairro || '').trim(), cidade:String(enterprise.cidade || '').trim(), estado:String(enterprise.estado || '').trim(), tipo:enterprise.tipo || 'Outro', padrao:enterprise.padrao || 'Outro', fase:phase, launchDate:enterprise.launchDate || null, firstTableDate, deliveryDate:enterprise.deliveryDate || null, imagem:enterpriseImage(enterprise), tableCount:(enterprise.tabelas || []).length, latestTable:radar.latestTable, current:radar.current, comparison:radar.comparison, normalizedAdjustment, ivv:radar.ivv, vso:radar.ivv?.vsoMedioMensal ?? null, recentTable, latestAge, lastSale, sales90:sales90.length, noSales:recentTable && !sales90.length, latestFacts, favorite:favorites.has(enterprise.id), launchRecent:phase === 'Lançamento' && (homeDaysAgo(enterprise.launchDate, today) ?? Infinity) >= 0 && (homeDaysAgo(enterprise.launchDate, today) ?? Infinity) <= recentDays }; }).filter((entry) => matches(data.empreendimentos.find((item) => item.id === entry.id), entry));
  const total = (values) => values.reduce((sum, value) => sum + (Number(value) || 0), 0), averageValue = (values) => { const valid = values.filter(Number.isFinite); return valid.length ? total(valid) / valid.length : null; };
  const comparable = entries.filter((entry) => Number.isFinite(entry.vso)); const podium = [...comparable].sort((a,b) => b.vso - a.vso || a.nome.localeCompare(b.nome,'pt-BR')).slice(0,3);
  const recentTables = entries.filter((entry) => entry.recentTable).length;
  const eligibleAdjustments = entries.map((entry) => entry.normalizedAdjustment).filter((item) => item?.elegivel), reajusteMedioMensal = averageValue(eligibleAdjustments.map((item) => item.reajusteMensal));
  const kpis = { empreendimentos:entries.length, disponiveis:total(entries.map((entry) => entry.current?.available)), vendasValidadas:total(entries.map((entry) => entry.comparison?.salesConfirmed)), vso:averageValue(comparable.map((entry) => entry.vso)), ivv:averageValue(entries.filter((entry) => entry.ivv?.available).map((entry) => Number(entry.ivv.monthly))), reajusteMedio:reajusteMedioMensal, reajusteMedioMensal, empreendimentosComReajuste:eligibleAdjustments.length, tabelasRecentes:recentTables };
  const editorialFacts = [];
  // Ausência de venda continua útil para operação, mas é bloqueada para qualquer
  // publicação editorial: não nomeamos nem ranqueamos um empreendimento por ela.
  entries.filter((entry) => entry.noSales).forEach((entry) => editorialFacts.push({ id:`sem_vendas:${entry.id}`, kind:'absence_of_sales', family:'monitoramento', score:100, enterpriseId:entry.id, visibility:'internal' }));
  entries.filter((entry) => entry.launchRecent).forEach((entry) => editorialFacts.push({ id:`lancamento:${entry.id}`, kind:'launch', family:'lancamentos', enterpriseId:entry.id, enterprise:entry.nome, score:EDITORIAL_WEIGHTS.launch }));
  if (podium[0]) editorialFacts.push({ id:'performance:contexto', kind:'performance_context', family:'performance', score:EDITORIAL_WEIGHTS.performance_context, evidence:{ comparaveis:comparable.length } });
  for (const entry of entries) {
    const added = Number(entry.comparison?.added || 0), returned = Number(entry.comparison?.returned || 0), adjustment = Number(entry.comparison?.reajuste?.reajusteMedioPercentual), conditions = entry.latestFacts.filter((fact) => fact.tipo === 'ALTERACAO_CONDICAO'), sales = Number(entry.comparison?.salesConfirmed || 0);
    if (sales > 0) editorialFacts.push({ id:`vendas:${entry.id}`, kind:'sale_validated', family:`performance:${entry.id}`, enterpriseId:entry.id, enterprise:entry.nome, sales, score:Math.min(100, EDITORIAL_WEIGHTS.sale_validated + sales), evidence:{ sales, ivv:entry.ivv?.monthly ?? null, vso:entry.vso, available:entry.current?.available ?? null, periodMonths:entry.ivv?.intervalMonths || entry.ivv?.mesesIntervalo || null, confidence:entry.ivv?.available ? 'MÉDIA' : 'BAIXA' } });
    if (added > 0 || returned > 0) editorialFacts.push({ id:`oferta:${entry.id}`, kind:'offer_update', family:'oferta', enterpriseId:entry.id, enterprise:entry.nome, score:Math.min(100, EDITORIAL_WEIGHTS.offer_update + Math.min(10, (added + returned) / 2)), evidence:{ added, returned, confidence:'MÉDIA' } });
    if (Number.isFinite(adjustment) && adjustment !== 0) editorialFacts.push({ id:`preco:${entry.id}`, kind:'price_update', family:'preco', enterpriseId:entry.id, enterprise:entry.nome, score:Math.min(100, EDITORIAL_WEIGHTS.price_update + Math.min(10, Math.abs(adjustment) * 100)), evidence:{ changePercent:adjustment, confidence:'MÉDIA' } });
    if (conditions.length) editorialFacts.push({ id:`condicao:${entry.id}`, kind:'commercial_update', family:'condicoes', enterpriseId:entry.id, enterprise:entry.nome, score:Math.min(100, EDITORIAL_WEIGHTS.commercial_update + Math.min(10, conditions.length)) });
  }
  const pulse = buildEditorialReading(editorialFacts, { hasPortfolio:entries.length > 0, context:{ type:'portfolio', filters:{ search:query.search || '', bairro:query.bairro || '', tipo:query.tipo || '', padrao:query.padrao || '', fase:query.fase || '' } } });
  // Empreendimentos é uma leitura de carteira: publica a atualização mais
  // relevante. O Analytics usa a narrativa comparativa de velocidade.
  pulse.paragraphs = pulse.narratives?.portfolio ? [pulse.narratives.portfolio] : pulse.paragraphs;
  const changes = pulse.modules.filter((module) => module.enterpriseId && ['sale_validated','price_update','commercial_update','offer_update'].includes(module.kind)).map((module) => ({ enterpriseId:module.enterpriseId, enterprise:module.enterprise, kind:module.kind === 'sale_validated' ? 'sale' : module.kind === 'price_update' ? 'price' : module.kind === 'commercial_update' ? 'condition' : 'stock', score:module.score, text:module.text }));
  return { entries:entries.sort((a,b) => (a.fase === 'Lançamento' ? 0 : 1) - (b.fase === 'Lançamento' ? 0 : 1) || a.nome.localeCompare(b.nome,'pt-BR')), kpis, podium, noSales:[], changes, pulse, editorial:pulse.narratives || {}, filters:{ search:query.search || '', bairro:query.bairro || '', tipo:query.tipo || '', padrao:query.padrao || '', ticket:query.ticket || '', fase:query.fase || '' } };
}
function attachPressureToPortfolioHome(home, pressure) {
  home.marketPressure = pressure;
  const exact = pressure?.exact, influence = pressure?.influence;
  if (!exact || exact.calculation_status !== 'calculated') return home;
  const exactVariation = exact.ipd_indicator?.value, influenceVariation = influence?.ipd_indicator?.value;
  const label = (indicator) => indicator?.label || 'Nova pressão';
  let text, id;
  if (influence?.calculation_status === 'calculated' && Number.isFinite(exactVariation) && Number.isFinite(influenceVariation) && Math.abs(exactVariation - influenceVariation) >= PRESSURE_CONFIG.narrativeDifferencePoints) {
    const direction = influence.ipd > exact.ipd ? 'ultrapassa os limites do bairro' : 'está mais concentrada no próprio bairro';
    text = `A variação da pressão de demanda ${direction}: o IPD do recorte é ${label(exact.ipd_indicator)}, enquanto o IPD de influência é ${label(influence.ipd_indicator)}.`;
    id = 'ipd_influence_difference';
  } else {
    text = `A pressão atual do mercado filtrado soma ${exact.demand_pressure.toLocaleString('pt-BR',{maximumFractionDigits:1})} em demanda e ${exact.supply_pressure.toLocaleString('pt-BR',{maximumFractionDigits:1})} em oferta. Variação: IPD ${label(exact.ipd_indicator)} e IPO ${label(exact.ipo_indicator)}.`;
    id = 'ipd_exact';
  }
  const pressureModule = buildEditorialReading([{ id, kind:'market_pressure', family:'pressao_de_mercado', score:EDITORIAL_WEIGHTS.market_pressure, text }], { maxModules:1 }).modules[0];
  const modules = [...(home.pulse?.modules || []), pressureModule].filter(Boolean).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id, 'pt-BR')).slice(0, 5);
  const selectedModules = modules.slice(0, 4), narratives = buildSurfaceNarratives(selectedModules, { context:{ type:'portfolio' } });
  home.pulse = { ...home.pulse, modules:selectedModules, paragraphs:narratives.portfolio ? [narratives.portfolio] : selectedModules.map((module) => module.text), events:selectedModules.map((module) => ({ id:module.id, family:module.family, type:module.kind, score:module.score, confidence:module.confidence, enterpriseId:module.enterpriseId, enterprise:module.enterprise })), narratives, weights:{ ...home.pulse?.weights, pressao_mercado:EDITORIAL_WEIGHTS.market_pressure } };
  return home;
}
function compactPortfolioHome(home) {
  const compactEntry = (entry) => ({
    ...entry,
    latestTable: entry.latestTable ? { id:entry.latestTable.id, name:entry.latestTable.name, validityDate:entry.latestTable.validityDate } : null,
    current: entry.current ? { units:entry.current.units, available:entry.current.available, sold:entry.current.sold, averagePrice:entry.current.averagePrice, pricePerM2:entry.current.pricePerM2 } : null,
    comparison: entry.comparison ? { salesConfirmed:entry.comparison.salesConfirmed, added:entry.comparison.added, returned:entry.comparison.returned, reajuste:entry.comparison.reajuste } : null,
    latestFacts: []
  });
  const entries = (home.entries || []).map(compactEntry);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return { ...home, entries, podium:(home.podium || []).map((entry) => byId.get(entry.id) || compactEntry(entry)) };
}
function transitiveTableDependencies(empreendimento, tableId) {
  const found = new Map(); const queue = [tableId];
  while (queue.length) { const current = queue.shift(); for (const dependency of tableDependencies(empreendimento, current)) if (!found.has(dependency.id) && dependency.id !== tableId) { found.set(dependency.id, dependency); queue.push(dependency.id); } }
  return [...found.values()].sort((a, b) => String(a.validityDate || '').localeCompare(String(b.validityDate || '')));
}
function exclusionImpact(empreendimento, table) {
  const dependencies = transitiveTableDependencies(empreendimento, table.id), ids = new Set([table.id, ...dependencies.map((item) => item.id)]), survivors = (empreendimento.tabelas || []).filter((item) => !ids.has(item.id)); const survivingKeys = new Set(survivors.flatMap((item) => (item.unidades || []).map((unit) => unit.chave))); const exclusiveKeys = new Set((empreendimento.tabelas || []).filter((item) => ids.has(item.id)).flatMap((item) => (item.unidades || []).map((unit) => unit.chave)).filter((key) => !survivingKeys.has(key)));
  return { tabela: tableSummary(table, empreendimento), dependencias: dependencies, ids: [...ids], tabelaBaseAfetada: ids.has(empreendimento.tabelaBaseId), substitutasBase: survivors.filter((item) => item.status === 'registered').sort(snapshotOrder).map((item) => tableSummary(item, empreendimento)), documentos: (empreendimento.tabelas || []).filter((item) => ids.has(item.id) && item.documento?.path).map((item) => ({ tabelaId: item.id, path: item.documento.path })), fatos: (empreendimento.fatosComerciais || []).filter((fact) => ids.has(fact.tabelaAtualId) || ids.has(fact.tabelaAnteriorId)).length, unidadesExclusivas: exclusiveKeys.size };
}
function isManagedDocumentPath(filePath) {
  const candidate = path.resolve(filePath).toLowerCase();
  return MANAGED_DOCUMENT_ROOTS.some((root) => {
    const normalizedRoot = path.resolve(root).toLowerCase();
    return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${path.sep}`);
  });
}
async function executeTableDeletion(data, empreendimento, table, payload, req) {
  const impact = exclusionImpact(empreendimento, table); if (impact.dependencias.length && !payload.incluirDependencias) { const error = new Error('Esta tabela é referência histórica. Confirme a exclusão da tabela e de todas as dependências.'); error.status = 409; error.impact = impact; throw error; }
  const ids = new Set(payload.incluirDependencias ? impact.ids : [table.id]); const survivors = (empreendimento.tabelas || []).filter((item) => !ids.has(item.id));
  if (ids.has(empreendimento.tabelaBaseId) && survivors.some((item) => item.status === 'registered')) {
    const replacement = survivors.find((item) => item.id === payload.tabelaBaseSubstitutaId && item.status === 'registered'); if (!replacement) { const error = new Error('Escolha uma tabela base substituta antes de excluir esta cadeia.'); error.status = 409; error.impact = impact; error.requiresBaseReplacement = true; throw error; }
  }
  const dataSnapshot = structuredClone(data);
  const operationId = crypto.randomUUID(); const transactionDir = path.resolve(PDF_TRANSACTION_DIR, operationId); const transactionRoot = path.resolve(PDF_TRANSACTION_DIR) + path.sep;
  if (!transactionDir.startsWith(transactionRoot)) throw new Error('Diretório transacional inválido.'); await fs.mkdir(transactionDir, { recursive: true });
 const staged = [];
 try {
   for (const item of (empreendimento.tabelas || []).filter((candidate) => ids.has(candidate.id) && candidate.documento?.path)) {
      const stillReferenced = survivors.some((candidate) => candidate.documento?.path === item.documento.path || (item.documento?.hash && candidate.documento?.hash === item.documento.hash)); if (stillReferenced) continue;
     const source = path.resolve(ROOT, item.documento.path); if (!isManagedDocumentPath(source)) throw new Error(`Documento fora do diretório permitido: ${item.id}.`);
      const target = path.join(transactionDir, `${item.id}_${path.basename(source)}`);
      try { await fs.rename(source, target); staged.push({ source, target }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const deletedAt = now(); const existingTombstones = new Map(compactDeletedTableTombstones(empreendimento.tabelasExcluidas || []).map((item) => [item.id, item]));
    for (const removed of (empreendimento.tabelas || []).filter((candidate) => ids.has(candidate.id))) existingTombstones.set(removed.id, excludedTableTombstone(removed, { deletedAt, deletedReason: String(payload.motivo || ''), deletedBy: requestActor(req).codigo }));
    empreendimento.tabelasExcluidas = compactDeletedTableTombstones([...existingTombstones.values()]);
    empreendimento.tabelas = survivors; empreendimento.pontosQuentes = (empreendimento.pontosQuentes || []).filter((point) => !ids.has(point.tabelaId) && !ids.has(point.tabelaAnteriorId));
    const survivingKeys = new Set(survivors.flatMap((item) => (item.unidades || []).map((unit) => unit.chave))); empreendimento.unidades = (empreendimento.unidades || []).filter((unit) => survivingKeys.has(unit.chave));
    if (ids.has(empreendimento.tabelaBaseId)) {
      const replacement = survivors.find((item) => item.id === payload.tabelaBaseSubstitutaId && item.status === 'registered') || null; empreendimento.tabelaBaseId = replacement?.id || null; empreendimento.tabelaPadraoTableId = replacement?.id || null; empreendimento.tabelaPadraoTipo = replacement?.tipoTabela || null;
    }
    rebuildCommercialHistory(empreendimento, { reason: 'exclusao_cascata' }); rebuildCentralCatalog(empreendimento); empreendimento.updatedAt = now();
    const record = audit(data, empreendimento, req, 'tabelas_excluidas_em_cascata', { tabelaId: table.id, tabelasExcluidas: [...ids], dependencias: [...ids].filter((id) => id !== table.id), documentosExcluidos: staged.map((item) => path.basename(item.source)), motivo: String(payload.motivo || ''), tabelaBaseSubstitutaId: empreendimento.tabelaBaseId || null });
    if (process.env.NEXO_TEST_FAILURES === '1' && payload.simularFalhaCommit) throw new Error('Falha transacional simulada antes do commit.');
    await writeData(data); await fs.rm(transactionDir, { recursive: true, force: true });
    return { deletedIds: [...ids], dependenciesDeleted: [...ids].filter((id) => id !== table.id), tabelaBaseId: empreendimento.tabelaBaseId || null, auditoriaId: record.id };
  } catch (error) {
    for (const item of staged.reverse()) await fs.rename(item.target, item.source).catch(() => {});
    await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => {});
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, dataSnapshot);
    throw error;
  }
}
function notificationCenter(data) {
  const priority = { critico: 0, atencao: 1, pendente: 2 };
  const items = [];
  for (const empreendimento of data.empreendimentos || []) for (const table of empreendimento.tabelas || []) {
    const alerts = table.alertas || [];
    const openHotPoints = (empreendimento.pontosQuentes || []).filter((point) => point.status === 'aberto' && point.tabelaId === table.id);
    const critical = alerts.filter((alert) => alert.nivel === 'critico' && alert.tipo !== 'UNIDADE_AUSENTE');
    const attention = alerts.filter((alert) => alert.nivel === 'atencao');
    const pending = table.status === 'pending_validation'; const criticalCount = critical.length + openHotPoints.length;
    if (!pending && !criticalCount && !attention.length) continue;
    const severity = criticalCount ? 'critico' : attention.length ? 'atencao' : 'pendente';
    const labels = [pending ? 'Revisão pendente' : '', critical.length ? `${critical.length} alerta${critical.length === 1 ? '' : 's'} crítico${critical.length === 1 ? '' : 's'}` : '', openHotPoints.length ? `${openHotPoints.length} unidade${openHotPoints.length === 1 ? '' : 's'} ausente${openHotPoints.length === 1 ? '' : 's'} para confirmar` : '', attention.length ? `${attention.length} ponto${attention.length === 1 ? '' : 's'} de atenção` : ''].filter(Boolean);
    items.push({
      id: `${empreendimento.id}:${table.id}`,
      severity,
      enterpriseId: empreendimento.id,
      enterpriseName: empreendimento.nome,
      tableId: table.id,
      tableName: table.name,
      validityDate: table.validityDate || null,
      updatedAt: table.updatedAt || table.processedAt || table.createdAt || null,
      pending,
      critical: criticalCount,
      attention: attention.length,
      summary: labels.join(' · ')
    });
  }
  items.sort((a, b) => priority[a.severity] - priority[b.severity] || Date.parse(b.updatedAt || b.validityDate || 0) - Date.parse(a.updatedAt || a.validityDate || 0));
  return { total: items.length, critical: items.filter((item) => item.severity === 'critico').length, attention: items.filter((item) => item.severity === 'atencao').length, pending: items.filter((item) => item.severity === 'pendente').length, items };
}
function enterpriseNotificationCenter(data, userId) {
  const reads = new Map((data.userNotificationReads || []).filter((item) => item.user_id === userId).map((item) => [item.enterprise_id, item.read_at]));
  const items = (data.empreendimentos || []).filter((item) => item.status !== 'inactive').map((enterprise) => ({
    id:enterprise.id,
    enterpriseId:enterprise.id,
    enterpriseName:enterprise.nome,
    builder:enterprise.construtora || 'Construtora não informada',
    location:[enterprise.bairro, enterprise.cidade, enterprise.estado].filter(Boolean).join(', ') || 'Localização não informada',
    classification:[enterprise.tipo, enterprise.padrao].filter(Boolean).join(' · ') || 'Classificação não informada',
    launchDate:enterprise.launchDate || null,
    createdAt:enterprise.createdAt || enterprise.updatedAt || null,
    readAt:reads.get(enterprise.id) || null,
    read:Boolean(reads.get(enterprise.id))
  })).sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0)).slice(0, 30);
  return { total:items.filter((item) => !item.read).length, items };
}
function markEnterpriseNotificationsRead(data, userId, enterpriseIds) {
  const ids = new Set(enterpriseIds), timestamp = now();
  data.userNotificationReads = (data.userNotificationReads || []).filter((item) => !(item.user_id === userId && ids.has(item.enterprise_id)));
  for (const enterpriseId of ids) data.userNotificationReads.push({ user_id:userId, enterprise_id:enterpriseId, read_at:timestamp });
  return timestamp;
}
function normalizedLocation(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function matchesExpectedCity(candidate, empreendimento) {
  const city = normalizedLocation(empreendimento.cidade); const received = normalizedLocation(candidate);
  return !city || (received && (received.includes(city) || city.includes(received)));
}
function photonLocation(feature, empreendimento, source, cep) {
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties || {};
  const city = properties.city || properties.locality || properties.county || '';
  if (!Array.isArray(coordinates) || !Number.isFinite(Number(coordinates[0])) || !Number.isFinite(Number(coordinates[1])) || !matchesExpectedCity(city, empreendimento)) return null;
  const formattedCep = cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '';
  const label = [properties.name, properties.district || empreendimento.bairro, city || empreendimento.cidade, formattedCep ? `CEP cadastrado ${formattedCep}` : ''].filter(Boolean).join(', ');
  return { latitude: Number(coordinates[1]), longitude: Number(coordinates[0]), label, source };
}
async function geocode(empreendimento) {
  const cep = String(empreendimento.cep || '').replace(/\D/g, '');
  let cepData = null;
  if (cep.length === 8) {
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const payload = await response.json(); if (!payload.erro) cepData = payload;
    } catch (_) { /* a busca pelos serviços geográficos continua como contingência */ }
  }
  const location = {
    endereco: empreendimento.endereco || cepData?.logradouro || '',
    bairro: empreendimento.bairro || cepData?.bairro || '',
    cidade: empreendimento.cidade || cepData?.localidade || '',
    estado: empreendimento.estado || cepData?.uf || ''
  };
  const addressQuery = [location.endereco, empreendimento.numero, location.bairro, location.cidade, location.estado, 'Brasil'].filter(Boolean).join(', ');
  const cepQuery = cep.length === 8 ? [`${cep.slice(0, 5)}-${cep.slice(5)}`, location.bairro, location.cidade, location.estado, 'Brasil'].filter(Boolean).join(', ') : '';
  const neighborhoodQuery = [location.bairro, location.cidade, location.estado, 'Brasil'].filter(Boolean).join(', ');
  const searches = [[cepQuery, 'cep'], [addressQuery, 'automatic'], [neighborhoodQuery, 'bairro']].filter(([query], index, values) => query && values.findIndex(([candidate]) => candidate === query) === index);
  if (!searches.length) throw new Error('Informe ao menos o CEP ou o endereço para localizar o empreendimento.');
  for (const [query, source] of searches) {
    try {
      const response = await fetch(`https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(query)}`);
      if (!response.ok) continue;
      const payload = await response.json();
       const result = (payload.features || []).map((feature) => photonLocation(feature, { ...empreendimento, ...location }, source, cep)).find(Boolean);
       if (result) return { ...result, location };
    } catch (_) { /* tenta as outras buscas e a fonte de contingência */ }
  }
  for (const [query, source] of searches) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Nexo-Radar-Imobiliario/1.0 (local)' } });
      if (!response.ok) continue;
      const results = await response.json();
       const result = results.find((item) => matchesExpectedCity(item.display_name, { ...empreendimento, ...location }) && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
       if (result) return { latitude: Number(result.lat), longitude: Number(result.lon), label: result.display_name, source, location };
    } catch (_) { /* a mensagem final orienta o cadastro manual */ }
  }
  throw new Error(`CEP/endereço não localizado em ${location.cidade || empreendimento.cidade || 'sua cidade'}. Informe latitude e longitude manualmente.`);
}

let brokerNeighborhoodSyncSignature = '';
async function syncBrokerNeighborhoods(data) {
  const broker = await loadBrokerData();
  const unique = new Map();
  for (const opportunity of broker.opportunities || []) {
    const nome = opportunity.bairro_normalizado || opportunity.bairro_original;
    if (!nome) continue;
    const key = BrokerNetwork.canonicalNeighborhood(nome);
    if (!unique.has(key)) unique.set(key, { nome, cidade:opportunity.cidade || opportunity.localidade || 'Campina Grande', uf:opportunity.uf || 'PB' });
  }
  const signature = `${broker.manifest?.version || ''}:${broker.opportunities?.length || 0}:${data.neighborhoods?.length || 0}:${[...unique.keys()].sort().join('|')}`;
  if (signature === brokerNeighborhoodSyncSignature) return false;
  const before = data.neighborhoods.length;
  unique.forEach((neighborhood) => ensureNeighborhood(data, neighborhood, 'Rede de Corretores'));
  brokerNeighborhoodSyncSignature = `${broker.manifest?.version || ''}:${broker.opportunities?.length || 0}:${data.neighborhoods?.length || 0}:${[...unique.keys()].sort().join('|')}`;
  return data.neighborhoods.length !== before;
}

function redeQueryWithEnterprises(data, query = {}) {
  const selectedNeighborhood = (data.neighborhoods || []).find((item) => item.id === query.bairro) || (data.neighborhoods || []).find((item) => normalizeDomainText(item.nome) === normalizeDomainText(query.bairro));
  const selectedPattern = query.padrao ? standardByValue(data, query.padrao) : null;
  const ids = queryEnterpriseIds(query);
  const enterpriseNeighborhoods = (data.empreendimentos || []).filter((item) => ids.includes(item.id)).map((item) => item.bairro).filter(Boolean);
  const existing = String(query.bairros || '').split(',').map((item) => item.trim()).filter(Boolean);
  return {
    ...query,
    bairro:selectedNeighborhood?.nome || query.bairro || '',
    bairros:[...new Set([...existing, ...enterpriseNeighborhoods])].join(','),
    padrao:query.padrao ? (selectedPattern?.slug || BrokerNetwork.canonicalPattern(query.padrao) || query.padrao) : '',
    tipo:query.tipo ? (BrokerNetwork.canonicalType(query.tipo) || query.tipo) : ''
  };
}

function addNeighborhoodMetric(row, key, value) {
  const metric = row[key]; metric.qtd += 1;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) { metric.soma += numeric; metric.comValor += 1; }
}

async function redeNeighborhoodRows(data, query = {}) {
  const broker = await loadBrokerData();
  const analytical = filterBrokerRecords(broker.opportunities || [], query);
  const groups = new Map();
  for (const item of analytical) {
    const key = BrokerNetwork.canonicalNeighborhood(item.bairro_normalizado || item.bairro_original);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { total:0, oferta:0, demanda:0, corretores:new Set(), venda:{ qtd:0, soma:0, comValor:0 }, compra:{ qtd:0, soma:0, comValor:0 }, locacaoOferta:{ qtd:0, soma:0, comValor:0 }, locacaoDemanda:{ qtd:0, soma:0, comValor:0 }, repasse:{ qtd:0, soma:0, comValor:0 } });
    const row = groups.get(key); row.total += 1;
    if (['locacao_ofertada','venda_ofertada','repasse'].includes(item.operacao_mercado)) row.oferta += 1;
    if (['locacao_procurada','compra_procurada'].includes(item.operacao_mercado)) row.demanda += 1;
    if (item.operacao_mercado === 'venda_ofertada') addNeighborhoodMetric(row, 'venda', item.valor_venda);
    if (item.operacao_mercado === 'compra_procurada') addNeighborhoodMetric(row, 'compra', item.valor_orcamento_maximo);
    if (item.operacao_mercado === 'locacao_ofertada') addNeighborhoodMetric(row, 'locacaoOferta', item.valor_locacao);
    if (item.operacao_mercado === 'locacao_procurada') addNeighborhoodMetric(row, 'locacaoDemanda', item.valor_orcamento_maximo);
    if (item.operacao_mercado === 'repasse') addNeighborhoodMetric(row, 'repasse', item.valor_repasse_agio || item.valor_venda);
    if (item.sender_id) row.corretores.add(String(item.sender_id));
  }
  const reviews = await listReviews();
  const pending = new Map();
  reviews.filter((item) => item.status === 'pendente' && item.type === 'bairro_novo').forEach((item) => {
    const key = BrokerNetwork.canonicalNeighborhood(item.candidateName); pending.set(key, (pending.get(key) || 0) + 1);
  });
  const selectedNeighborhoods = new Set([
    ...String(query.bairros || '').split(','),
    query.bairro || ''
  ].map((item) => BrokerNetwork.canonicalNeighborhood(item)).filter(Boolean));
  return (data.neighborhoods || []).filter((item) => !selectedNeighborhoods.size || selectedNeighborhoods.has(BrokerNetwork.canonicalNeighborhood(item.nome))).map((item) => {
    const row = groups.get(BrokerNetwork.canonicalNeighborhood(item.nome)) || { total:0, oferta:0, demanda:0, corretores:new Set(), venda:{ qtd:0, soma:0, comValor:0 }, compra:{ qtd:0, soma:0, comValor:0 }, locacaoOferta:{ qtd:0, soma:0, comValor:0 }, locacaoDemanda:{ qtd:0, soma:0, comValor:0 }, repasse:{ qtd:0, soma:0, comValor:0 } };
    const metric = (name) => ({ qtd:row[name].qtd, media:row[name].comValor ? row[name].soma / row[name].comValor : null });
    return { id:item.id, nome:item.nome, cidade:item.cidade, uf:item.uf, regiao:item.regiao, zona:item.zona, ativo:item.ativo !== false, total:row.total, oferta:row.oferta, demanda:row.demanda, corretores:row.corretores.size, revisoesPendentes:pending.get(BrokerNetwork.canonicalNeighborhood(item.nome)) || 0, venda:metric('venda'), compra:metric('compra'), locacaoOferta:metric('locacaoOferta'), locacaoDemanda:metric('locacaoDemanda'), repasse:metric('repasse') };
  }).sort((left, right) => right.total - left.total || left.nome.localeCompare(right.nome, 'pt-BR'));
}

async function api(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); const method = req.method; const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const query = Object.fromEntries(requestUrl.searchParams.entries());
  if(pathname==='/api/gestao/ivv-curves') {
    if(method==='GET')return send(res,200,IvvCurves.read(IVV_CURVES_FILE));
    if(method==='POST'){
      const actor=requestActor(req);
      if(actor.perfil!=='ADMIN')return send(res,403,{error:'A gestão da curva requer perfil ADMIN.'});
      try {const payload=parseJson(await body(req));return send(res,200,await updateIvvCurveStore(payload.action,payload,actor));}
      catch(error){return send(res,422,{error:error.message});}
    }
    return send(res,405,{error:'Método não permitido.'});
  }
  if (method === 'GET' && pathname === '/api/reajuste-reference') {
    const months=Number(query.months || 6);
    if(!Number.isInteger(months)||months<1||months>12)return send(res,400,{error:'Informe um período entre 1 e 12 meses.'});
    const reference=await getReference(months),data=await readData();
    // O reajuste observado continua disponível apenas para comparação visual.
    // Ele não alimenta, calibra nem altera o Índice NEXUM.
    const adjustments=(data.empreendimentos || []).filter(item=>item.status!=='inactive').map(latestEnterpriseAdjustment).filter(item=>item.elegivel).map(item=>item.reajusteMensal);
    const portfolioMonthly=adjustments.length?average(adjustments):null;
    const portfolioPeriod=portfolioMonthly==null?null:Math.pow(1+portfolioMonthly,months)-1;
    return send(res,200,{...reference,portfolio:{monthly:portfolioMonthly,period:portfolioPeriod,enterprises:adjustments.length}});
  }
  if(method==='GET'&&pathname==='/api/fipezap-reference')return send(res,200,await require('./fipezap-reference').loadFipezapReference());
  if (method === 'GET' && pathname === '/api/gestao/json-entrada') {
    const data = await readData();
    return send(res, 200, { jobs:listManagementJsonJobs(data), enterprises:(data.empreendimentos || []).filter((item) => item.status !== 'inactive').map(jsonEnterpriseOption).sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR')) });
  }
  if (method === 'POST' && pathname === '/api/gestao/json-entrada/excluir') {
    const payload = parseJson(await body(req)), data = await readData(), jobId = String(payload.jobId || ''), job = (data.gestaoImportacoesJson || []).find((item) => item.id === jobId);
    if (!job) return send(res, 404, { error:'Esta importação JSON não foi encontrada.' });
    try { return send(res, 200, await removeJsonImport(data, job, req)); } catch (error) { return send(res, error.status || 500, { error:error.message || 'Não foi possível excluir a importação JSON.', impact:error.impact, requiresBaseReplacement:Boolean(error.requiresBaseReplacement) }); }
  }
  if (method === 'POST' && pathname === '/api/gestao/json-entrada/processar') {
    const contentType = String(req.headers['content-type'] || '');
    if (!/^multipart\/form-data\b/i.test(contentType)) return send(res, 422, { error:'Envie o arquivo JSON como multipart/form-data.' });
    const { file } = parseMultipart(await body(req), contentType);
    if (!file) return send(res, 422, { error:'Selecione um arquivo JSON.' });
    let fileName; try { fileName = managementJsonFileName(file.name); } catch (error) { return send(res, error.status || 422, { error:error.message }); }
    const hash = managementJsonHash(file.buffer), data = await readData();
    const allTables = (data.empreendimentos || []).flatMap((item) => item.tabelas || []);
    if (allTables.some((table) => table.documento?.hash === hash)) return send(res, 409, { error:'Este JSON já foi importado anteriormente.', duplicate:true });
    const existingJob = (data.gestaoImportacoesJson || []).find((item) => item.hash === hash);
    if (existingJob?.state === 'revisao' || existingJob?.state === 'importado') return send(res, 409, { error:'Este JSON já possui uma importação registrada.', job:existingJob });
    let source; try { source = parseJson(file.buffer); } catch (error) { return send(res, 422, { error:error.message }); }
    let preview; try { preview = prepareJsonImport(source, fileName); } catch (error) { return send(res, error.status || 422, { error:error.message }); }
    const jobId = existingJob?.id || crypto.randomUUID(), storedInputName = `${jobId}_${sanitize(fileName)}`, storedInputPath = path.join(MANAGEMENT_JSON_INPUT_DIR, storedInputName), stamp = now();
    await fs.writeFile(storedInputPath, file.buffer);
    const job = { id:jobId, fileName, storedInputName, hash, state:'aguardando_validacao', processedAt:stamp, operator:requestActor(req), preview:{ ...preview, units:undefined }, audit:[...(existingJob?.audit || []), { at:stamp, action:'json_processado', operator:requestActor(req), hash }] };
    data.gestaoImportacoesJson = (data.gestaoImportacoesJson || []).filter((item) => item.id !== jobId); data.gestaoImportacoesJson.push(job);
    log(data, 'json_gestao_processado', { arquivo:fileName, hash, empreendimentoSugerido:preview.enterprise.id, unidades:preview.unitCount, avisos:preview.warnings.length }); await writeData(data);
    return send(res, 200, { job:{ ...job, preview:{ ...job.preview, units:undefined } }, enterprises:(data.empreendimentos || []).filter((item)=>item.status!=='inactive').map(jsonEnterpriseOption) });
  }
  if (method === 'POST' && pathname === '/api/gestao/json-entrada/confirmar') {
    const payload = parseJson(await body(req)), data = await readData(), job = (data.gestaoImportacoesJson || []).find((item) => item.id === String(payload.jobId || ''));
    if (!job || job.state !== 'aguardando_validacao') return send(res, 409, { error:'Processe o JSON antes de vinculá-lo.' });
    let source; try { source = parseJson(await fs.readFile(path.join(MANAGEMENT_JSON_INPUT_DIR, job.storedInputName))); } catch (_) { return send(res, 404, { error:'O JSON processado não está mais na pasta de entrada.' }); }
    let preview; try { preview = prepareJsonImport(source, job.fileName); } catch (error) { return send(res, error.status || 422, { error:error.message }); }
    const requestedEnterpriseId = String(payload.enterpriseId || ''), existingEnterprise = requestedEnterpriseId && requestedEnterpriseId !== '__new__' ? (data.empreendimentos || []).find((item) => item.id === requestedEnterpriseId) : null;
    if (requestedEnterpriseId !== '__new__' && (!existingEnterprise || existingEnterprise.status === 'inactive')) return send(res, 422, { error:'Selecione um empreendimento ativo ou confirme a criação de um novo cadastro.' });
    const enterpriseId = existingEnterprise?.id || importedId(data, 'empreendimento', 'EMP', preview.enterprise.id), stamp = now();
    const enterprise = existingEnterprise || jsonEnterpriseDraft(data, preview.enterprise, enterpriseId, stamp);
    const enterpriseCreatedByJob = !existingEnterprise;
    if (enterpriseCreatedByJob) enterprise.gestaoJsonJobId = job.id;
    if (existingEnterprise) {
      const imported = jsonEnterpriseDraft(data, preview.enterprise, enterpriseId, stamp), filled = [];
      for (const key of ['launchDate','deliveryDate','prazoEntregaChaves','endereco','numero','complemento','bairro','cidade','estado','cep','construtora','formasPagamento','caracteristicasComerciais']) {
        if (!enterprise[key] && imported[key]) { enterprise[key] = imported[key]; filled.push(key); }
      }
      const currentFeatures=normalizeEnterpriseCharacteristics(enterprise.caracteristicasImovel), importedFeatures=normalizeEnterpriseCharacteristics(imported.caracteristicasImovel);
      const mergedFeatures={ dormitorios:[...new Set([...currentFeatures.dormitorios,...importedFeatures.dormitorios])], atributos:{...currentFeatures.atributos}, vagas:{ possui:currentFeatures.vagas.possui, quantidades:[...new Set([...currentFeatures.vagas.quantidades,...importedFeatures.vagas.quantidades])] } };
      for(const [key,value] of Object.entries(importedFeatures.atributos))if(mergedFeatures.atributos[key]==='nao_informado'&&value!=='nao_informado')mergedFeatures.atributos[key]=value;
      if(mergedFeatures.vagas.possui==='nao_informado'&&importedFeatures.vagas.possui!=='nao_informado')mergedFeatures.vagas.possui=importedFeatures.vagas.possui;
      enterprise.caracteristicasImovel=normalizeEnterpriseCharacteristics(mergedFeatures);
      if(constructionStatusPriority(imported.statusObraOrigem)>constructionStatusPriority(enterprise.statusObraOrigem)){Object.assign(enterprise,{statusObra:imported.statusObra,statusObraOrigem:imported.statusObraOrigem,statusObraFonte:imported.statusObraFonte,percentualObra:imported.percentualObra});filled.push('statusObra')}
      if (filled.length) audit(data, enterprise, req, 'campos_cadastrais_completados_por_json', { arquivo:job.fileName, campos:filled });
    }
    if (!existingEnterprise) data.empreendimentos.push(enterprise);
    const tableId = importedId(data, 'tabela', 'TAB', preview.table.id), allTables = (data.empreendimentos || []).flatMap((item) => item.tabelas || []);
    if (allTables.some((table) => table.documento?.hash === job.hash)) return send(res, 409, { error:'Este JSON já está vinculado a uma tabela.', duplicate:true });
    const units = preview.units.map((unit) => ({ ...unit, chave:buildUnitRecordKey(enterpriseId, unit) }));
    const table = { id:tableId, name:String(payload.name || preview.table.name).trim(), tipoTabela:canonicalTableType(payload.tipoTabela || preview.table.tipoTabela), tipoTabelaLabel:TABLE_TYPE_LABELS[canonicalTableType(payload.tipoTabela || preview.table.tipoTabela)] || 'Outra modalidade', validityDate:normalizeManagementDate(payload.validityDate) || preview.table.validityDate, status:'pending_validation', isDemo:false, createdAt:stamp, processedAt:job.processedAt || stamp, documento:{ originalName:job.fileName, storedName:job.storedInputName, path:`JSON Entrada/${job.storedInputName}`, hash:job.hash, mimeType:'application/json', gestaoEntrada:true, sourceFormat:'nexum-skill-json' }, extracao:{ formato:'json_estruturado', texto:'', warnings:preview.warnings, error:null, unidadeCount:units.length, diagnostico:source.diagnostico || null }, normalizacao:{ formato:'json_estruturado', versaoLeitura:1, campos:[{ origem:'unidades[].chave', termoNormalizado:'chave', categoria:'identidade', campoPadrao:'CHAVE_UNIDADE', confianca:'alta', origemResolucao:'json_importado' }] }, unidades:units, manualReviewRequired:preview.diagnosticStatus !== 'sucesso', origem:{ tipo:'json_skill', label:'Importação JSON estruturada via Gestão', gestaoJobId:job.id, arquivo:job.fileName }, confiancaLeitura:{ percentual:preview.diagnosticStatus === 'sucesso' ? 100 : 95, classificacao:preview.diagnosticStatus === 'sucesso' ? 'alta' : 'atencao', metodo:'json_estruturado_validado' }, comparacao:emptyComparison(), alertas:[], regrasComerciais:preview.table.regrasComerciais || '', observacoes:preview.enterprise.leituraComercial?.observacoes || 'Importado por JSON estruturado; confirmação humana obrigatória.', auditoria:[{ at:stamp, action:'json_vinculado_para_revisao', arquivo:job.fileName, hash:job.hash, operador:requestActor(req), diagnostico:preview.diagnosticStatus }], sourceTableId:preview.table.id || null };
    enterprise.tabelas = enterprise.tabelas || []; enterprise.tabelas.push(table); normalizeTableComparisonIdentities(enterprise, table); tableOperationalUpdate(enterprise, table, requestActor(req)); applyCommercialRule(table, true); rebuildTableDerived(enterprise, table); refreshConstructionStatus(enterprise, table.validityDate || stamp); enterprise.updatedAt = stamp;
    table.origem.gestaoJobId = job.id;
    Object.assign(job, { state:'revisao', enterpriseId, tableId, enterpriseCreatedByJob, validityDate:table.validityDate, confirmedAt:stamp, confirmedBy:requestActor(req) }); job.audit.push({ at:stamp, action:'identificacao_confirmada', enterpriseId, tableId, enterpriseCreatedByJob }); audit(data, enterprise, req, 'json_gestao_vinculado', { arquivo:job.fileName, hash:job.hash, tabelaId:tableId, unidades:units.length, enterpriseCreatedByJob }); await writeData(data);
    return send(res, 201, { table, reviewUrl:`/gestao/empreendimento?id=${encodeURIComponent(enterpriseId)}&revisarTabela=${encodeURIComponent(tableId)}&gestaoRetorno=${encodeURIComponent('/gestao/importar-json')}` });
  }
  if (method === 'GET' && pathname === '/api/gestao/pdf-entrada') { const data=await readData(); return send(res,200,{ files:await listManagementPdfs(data), enterprises:(data.empreendimentos||[]).filter((item)=>item.status!=='inactive').map((item)=>({id:item.id,nome:item.nome,construtora:item.construtora||''})).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')), recent:(data.gestaoImportacoesPdf||[]).slice(-12).reverse().map((item)=>({id:item.id,fileName:item.fileName,state:item.state,processedAt:item.processedAt,importedAt:item.importedAt||null,enterpriseId:item.enterpriseId||null,tableId:item.tableId||null})) }); }
  if (method === 'POST' && pathname === '/api/gestao/pdf-entrada/processar') {
    const payload=parseJson(await body(req)),requestedFileName=managementPdfFileName(payload.fileName),requestedFilePath=path.join(MANAGEMENT_PDF_INPUT_DIR,requestedFileName),data=await readData();
    try { await fs.access(requestedFilePath); } catch (_) { return send(res,404,{error:'O PDF não foi encontrado na pasta de entrada.'}); }
    const hash=await managementPdfHash(requestedFilePath),fileName=await managementPrimaryPdfFile(hash)||requestedFileName,filePath=path.join(MANAGEMENT_PDF_INPUT_DIR,fileName),allTables=(data.empreendimentos||[]).flatMap((item)=>item.tabelas||[]); if(allTables.some((table)=>table.documento?.hash===hash))return send(res,409,{error:'PDF já processado anteriormente.',duplicate:true});
    let job=(data.gestaoImportacoesPdf||[]).find((item)=>item.hash===hash); if(job?.state==='revisao')return send(res,409,{error:'Este PDF já está vinculado a uma tabela em revisão.',job});
    const extracted=await extractPdf(filePath,'GESTAO-PDF'),identification=identifyManagementEnterprise(data,extracted.text,fileName,extracted.fingerprint),validityDate=managementValidity(extracted.text,fileName),tipoTabela=canonicalTableType(`${fileName} ${extracted.text.slice(0,5000)}`),stamp=now();
    job={id:job?.id||crypto.randomUUID(),fileName,hash,state:'aguardando_validacao',processedAt:stamp,operator:requestActor(req),identification,validityDate,tipoTabela,extraction:{text:extracted.text,unitCount:extracted.units.length,warnings:extracted.warnings,error:extracted.error||null,commercialRules:extracted.commercialRules||'',manualReviewRequired:Boolean(extracted.manualReviewRequired),confidence:extracted.confidence||readingConfidence(extracted),fingerprint:extracted.fingerprint||null,ocrUsed:Boolean(extracted.ocrUsed)},audit:[...(job?.audit||[]),{at:stamp,action:'pdf_processado',operator:requestActor(req),hash}]};
    data.gestaoImportacoesPdf=(data.gestaoImportacoesPdf||[]).filter((item)=>item.id!==job.id);data.gestaoImportacoesPdf.push(job);log(data,'pdf_gestao_processado',{arquivo:fileName,hash,empreendimentoSugerido:identification.suggested?.id||null,confianca:identification.suggested?.score||0});await writeData(data);return send(res,200,{job:{...job,extraction:{...job.extraction,text:undefined}},enterprises:(data.empreendimentos||[]).map((item)=>({id:item.id,nome:item.nome,construtora:item.construtora||''}))});
  }
  if (method === 'POST' && pathname === '/api/gestao/pdf-entrada/excluir-lista') {
    const payload=parseJson(await body(req)),fileName=managementPdfFileName(payload.fileName),filePath=path.join(MANAGEMENT_PDF_INPUT_DIR,fileName),data=await readData();
    try { await fs.access(filePath); } catch (_) { return send(res,404,{error:'O PDF não foi encontrado na pasta de entrada.'}); }
    const hash=await managementPdfHash(filePath),primaryFileName=await managementPrimaryPdfFile(hash)||fileName,stamp=now(),existing=(data.gestaoImportacoesPdf||[]).find((item)=>item.hash===hash);
    const job={...(existing||{id:crypto.randomUUID(),hash,fileName:primaryFileName,audit:[]}),fileName:primaryFileName,state:'excluido_lista',excludedFromListAt:stamp,excludedFromListBy:requestActor(req),audit:[...(existing?.audit||[]),{at:stamp,action:'pdf_ocultado_da_lista_de_atualizacao',operator:requestActor(req)}]};
    data.gestaoImportacoesPdf=(data.gestaoImportacoesPdf||[]).filter((item)=>item.id!==job.id);data.gestaoImportacoesPdf.push(job);log(data,'pdf_gestao_ocultado_da_lista',{arquivo:primaryFileName,hash});await writeData(data);return send(res,200,{ok:true,fileName:primaryFileName});
  }
  if (method === 'POST' && pathname === '/api/gestao/pdf-entrada/confirmar') {
    const payload=parseJson(await body(req)),validityDate=normalizeManagementDate(payload.validityDate),fileName=managementPdfFileName(payload.fileName),data=await readData(),filePath=path.join(MANAGEMENT_PDF_INPUT_DIR,fileName),enterprise=(data.empreendimentos||[]).find((item)=>item.id===payload.enterpriseId);if(!enterprise)return send(res,422,{error:'Selecione o empreendimento correto.'});if(!validityDate)return send(res,422,{error:'Confirme a vigência da tabela.'});
    try { await fs.access(filePath); } catch (_) { return send(res,404,{error:'O PDF não está mais na pasta de entrada.'}); }
    const hash=await managementPdfHash(filePath),job=(data.gestaoImportacoesPdf||[]).find((item)=>item.hash===hash);if(!job||job.state!=='aguardando_validacao')return send(res,409,{error:'Processe o PDF antes de vinculá-lo.'});const allTables=(data.empreendimentos||[]).flatMap((item)=>item.tabelas||[]);if(allTables.some((table)=>table.documento?.hash===hash))return send(res,409,{error:'PDF já processado anteriormente.',duplicate:true});
    const tableId=nextId(data,'tabela','TAB'),tipoTabela=canonicalTableType(payload.tipoTabela||job.tipoTabela),units=extractUnits(job.extraction?.text||'',enterprise.id),normalizacao=buildNormalization(job.extraction?.text||'',{commercialRules:job.extraction?.commercialRules||''},data.dicionarioTermosManuais),stamp=now();
    const table={id:tableId,name:String(payload.name||path.parse(fileName).name).trim(),tipoTabela,tipoTabelaLabel:TABLE_TYPE_LABELS[tipoTabela]||'Outro',validityDate,status:'pending_validation',isDemo:false,createdAt:stamp,processedAt:job.processedAt||stamp,documento:{originalName:fileName,storedName:fileName,path:`PDF Entrada/${fileName}`,hash,mimeType:'application/pdf',gestaoEntrada:true,fingerprint:job.extraction?.fingerprint||null},extracao:{texto:job.extraction?.text||'',warnings:job.extraction?.warnings||[],error:job.extraction?.error||null,ocrUsed:Boolean(job.extraction?.ocrUsed)},normalizacao,unidades:units,manualReviewRequired:Boolean(job.extraction?.manualReviewRequired),origem:{tipo:'pdf_automatico_assistido',label:'Atualização automática por PDF',gestaoJobId:job.id},confiancaLeitura:job.extraction?.confidence||readingConfidence(job.extraction||{}),comparacao:emptyComparison(),alertas:[],regrasComerciais:job.extraction?.commercialRules||'',observacoes:'Processado pela Gestão; confirmação humana obrigatória.',auditoria:[{at:stamp,action:'pdf_vinculado_para_revisao',arquivo:fileName,hash,operador:requestActor(req),identificacaoAutomatica:job.identification,identificacaoConfirmada:{enterpriseId:enterprise.id,nome:enterprise.nome}}]};
    enterprise.tabelas=enterprise.tabelas||[];enterprise.tabelas.push(table);tableOperationalUpdate(enterprise,table,requestActor(req));applyCommercialRule(table,true);rebuildTableDerived(enterprise,table);enterprise.updatedAt=stamp;Object.assign(job,{state:'revisao',enterpriseId:enterprise.id,tableId,validityDate,confirmedAt:stamp,confirmedBy:requestActor(req)});job.audit.push({at:stamp,action:'identificacao_confirmada',enterpriseId:enterprise.id,tableId});audit(data,enterprise,req,'pdf_gestao_vinculado',{arquivo:fileName,hash,tabelaId:tableId,confianca:job.identification?.suggested?.score||0});await writeData(data);return send(res,201,{table,reviewUrl:`/gestao/empreendimento?id=${encodeURIComponent(enterprise.id)}&revisarTabela=${encodeURIComponent(table.id)}&gestaoRetorno=${encodeURIComponent('/gestao/atualizacao-automatica')}`});
  }
  if (method === 'GET' && pathname === '/api/gestao/checklist') { const data=await readData(), rows=managementRows(data,query), allRows=managementRows(data,{...query,status:'todas'}); return send(res,200,{ rows, kpis:managementKpis(data,allRows), generatedAt:now() }); }
  if (method === 'GET' && pathname === '/api/gestao/tabelas') { const data=await readData(); return send(res,200,{ rows:managementRows(data,{ ...query, status:'todas' }) }); }
  if (method === 'POST' && /^\/api\/gestao\/checklist\/[^/]+\/agendar$/.test(pathname)) { const [, , , , enterpriseId] = pathname.split('/'); const payload=parseJson(await body(req)); if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.data || '')) return send(res,422,{error:'Informe uma data de agendamento válida.'}); const data=await readData(), enterprise=data.empreendimentos.find(item=>item.id===enterpriseId); if(!enterprise)return send(res,404,{error:'Empreendimento não encontrado.'}); const type=canonicalTableType(payload.tipoTabela), table=[...(enterprise.tabelas||[])].filter(item=>canonicalTableType(item.tipoTabela)===type).at(-1); if(!table)return send(res,404,{error:'Modalidade não encontrada.'}); const controls=tableManagementControls(enterprise); let control=controls.find(item=>item.tipoTabela===type); if(!control){control={tipoTabela:type,tipoTabelaLabel:TABLE_TYPE_LABELS[type]};controls.push(control)} control.agendamento=payload.data; control.agendadoPor=requestActor(req); control.agendadoEm=now(); audit(data,enterprise,req,'tabela_agendada',{tabelaId:table.id,modalidade:type,agendamento:payload.data}); await writeData(data); return send(res,200,control); }
  if (method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });
  if (method === 'GET' && pathname === '/api/dominios') {
    const data = await readData(), search = normalizeDomainText(query.bairroBusca || query.search || '');
    const neighborhoods = (data.neighborhoods || []).filter((item) => !search || `${normalizeDomainText(item.nome)} ${normalizeDomainText(item.cidade)} ${item.uf}`.includes(search)).sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR') || left.cidade.localeCompare(right.cidade, 'pt-BR'));
    return send(res, 200, { economicStandards:(data.economicStandards || []).filter((item) => item.ativo !== false), neighborhoods, propertyFeatures:data.propertyFeatureCatalog || [] });
  }
  if (method === 'GET' && pathname === '/api/bairros') {
    const data = await readData(), search = normalizeDomainText(query.search || '');
    return send(res, 200, (data.neighborhoods || []).filter((item) => !search || `${normalizeDomainText(item.nome)} ${normalizeDomainText(item.cidade)} ${item.uf}`.includes(search)).sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR') || left.cidade.localeCompare(right.cidade, 'pt-BR')));
  }
  if (method === 'GET' && pathname === '/api/padroes-economicos') { const data = await readData(); return send(res, 200, (data.economicStandards || []).filter((item) => item.ativo !== false)); }
  if (method === 'GET' && pathname === '/api/dicionario/termos') {
    const data = await readData(); return send(res, 200, { arquivo: path.relative(ROOT, TERM_DICTIONARY_FILE), estrategia: 'busca_exata_normalizada', termosCanonicos: canonicalTableTermOptions(data), termosManuais: data.dicionarioTermosManuais || [], termosNaoMapeados: data.termosNaoMapeados || [] });
  }
  if (method === 'GET' && pathname === '/api/notificacoes') { const data = await readData(), actor=requestActor(req); return send(res, 200, query.tipo === 'novos' ? enterpriseNotificationCenter(data, actor.codigo) : notificationCenter(data)); }
  if (method === 'POST' && pathname === '/api/notificacoes/empreendimentos/lidos') {
    const data=await readData(),actor=requestActor(req),payload=parseJson(await body(req));
    const activeIds=(data.empreendimentos||[]).filter((item)=>item.status!=='inactive').map((item)=>item.id);
    const requested=payload.all ? activeIds : (Array.isArray(payload.enterpriseIds)?payload.enterpriseIds:[]).filter((id)=>activeIds.includes(id));
    if(!requested.length)return send(res,422,{error:'Informe ao menos um empreendimento para marcar como lido.'});
    markEnterpriseNotificationsRead(data,actor.codigo,requested);log(data,'notificacoes_empreendimentos_lidas',{usuarioId:actor.codigo,quantidade:requested.length});await writeData(data);
    return send(res,200,enterpriseNotificationCenter(data,actor.codigo));
  }
  if (method === 'GET' && pathname === '/api/radar') { const data = await readData(), actor = requestActor(req), favorites = new Set((data.userFavorites || []).filter((item) => item.user_id === actor.codigo).map((item) => item.enterprise_id)), scoped = scopedDataForSharedFilters(data, query, actor.codigo); return send(res, 200, scoped.empreendimentos.map((item) => ({ ...buildRadar(item), favorite:favorites.has(item.id) }))); }
  if (method === 'GET' && pathname === '/api/rede-corretores') {
    try {
      const data = await readData(), changed = await syncBrokerNeighborhoods(data); if (changed) await writeData(data);
      return send(res, 200, await getBrokerAnalytics(redeQueryWithEnterprises(data, query)));
    }
    catch (error) { return send(res, error.status || 500, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/rede/status') {
    try { return send(res, 200, await getIngestionStatus()); }
    catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/rede/importacoes') {
    try { return send(res, 200, (await getIngestionStatus()).imports); }
    catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'POST' && pathname === '/api/rede/importacoes/preparar') {
    try {
      const upload = parseMultipart(await body(req), String(req.headers['content-type'] || ''));
      if (!upload.file) return send(res, 422, { error:'Selecione o arquivo TXT da conversa.' });
      return send(res, 200, await prepareImport({ filename:upload.file.name, buffer:upload.file.buffer, actor:requestActor(req) }));
    } catch (error) { return send(res, error.status || 422, { error:error.message }); }
  }
  if (method === 'POST' && pathname === '/api/rede/importacoes/processar') {
    try {
      const payload = parseJson(await body(req)), data = await readData();
      const result = await processImport({ token:payload.token, actor:requestActor(req), neighborhoods:data.neighborhoods || [] });
      clearBrokerDataCache();
      if (ONLINE_DESTINATION) await exportOnline({ root:ROOT, data, destination:ONLINE_DESTINATION });
      return send(res, 200, result);
    } catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/rede/revisoes') {
    try {
      const rows = await listReviews(), status = String(query.status || '');
      return send(res, 200, status ? rows.filter((item) => item.status === status) : rows);
    } catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/rede/revisao-amostras') {
    try { const data = await readData(); return send(res, 200, await getBrokerReviewSamples(redeQueryWithEnterprises(data, query))); }
    catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/rede/bairros') {
    try { const data = await readData(); return send(res, 200, await redeNeighborhoodRows(data, redeQueryWithEnterprises(data, query))); }
    catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'POST' && parts[1] === 'rede' && parts[2] === 'revisoes' && parts[4] === 'resolver') {
    try {
      const reviewId = parts[3], payload = parseJson(await body(req)), actor = requestActor(req), reviews = await listReviews();
      const review = reviews.find((item) => item.id === reviewId);
      if (!review) return send(res, 404, { error:'Item de revisão não encontrado.' });
      let neighborhood = null;
      if (payload.action === 'associar' || payload.action === 'aprovar') {
        const data = await readData();
        if (payload.action === 'associar') neighborhood = (data.neighborhoods || []).find((item) => item.id === payload.neighborhoodId);
        else neighborhood = ensureNeighborhood(data, { nome:String(payload.nome || review.candidateName || '').trim(), cidade:payload.cidade || 'Campina Grande', uf:payload.uf || 'PB' }, 'Revisão Rede');
        if (!neighborhood) return send(res, 422, { error:'Selecione ou informe um bairro válido.' });
        neighborhood.aliases = [...new Set([...(neighborhood.aliases || []), review.candidateName].filter(Boolean))];
        neighborhood.updated_at = now(); await writeData(data);
      }
      const resolved = await resolveReview(reviewId, { action:payload.action, reason:payload.reason, neighborhood }, actor);
      clearBrokerDataCache();
      return send(res, 200, resolved);
    } catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/market-pressure') {
    try {
      const data = await readData(), actor = requestActor(req), changed = await syncBrokerNeighborhoods(data); if (changed) await writeData(data);
      const normalizedQuery = redeQueryWithEnterprises(data, query);
      const context = marketPressureContext(data, normalizedQuery, actor.codigo);
      return send(res, 200, await getMarketPressure(context.pressureQuery, { neighborhoods:data.neighborhoods || [], enterprises:context.scoped.empreendimentos, referenceEnterprises:context.references }));
    } catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/market-pressure-map') {
    try {
      const data = await readData(), changed = await syncBrokerNeighborhoods(data); if (changed) await writeData(data);
      return send(res, 200, await getMarketPressureMap(marketPeriodQuery(redeQueryWithEnterprises(data, query)), { neighborhoods:data.neighborhoods || [] }));
    } catch (error) { return send(res, error.status || 500, { error:error.message }); }
  }
  if (method === 'GET' && pathname === '/api/radar-analysis') {
    // Commercial product labels must not be converted into broker-network types.
    const data = await readData(), actor = requestActor(req), normalizedQuery = marketPeriodQuery(query);
    const scoped = scopedDataForSharedFilters(data, normalizedQuery, actor.codigo), entries = buildRadarAnalyticalInput(scoped, normalizedQuery);
    const dates = entries.flatMap(entry => entry.history.map(table => String(table.date).slice(0,10))).sort();
    const indices = dates.length ? await getIgpm(dates[0], dates.at(-1)) : { rows:[], warning:'Sem histórico monitorado.' };
    return send(res, 200, RadarAnalysis.analyze(entries, indices, normalizedQuery));
  }
  if (method === 'GET' && pathname === '/api/analytics') {
    const data = await readData(), actor = requestActor(req), normalizedQuery = redeQueryWithEnterprises(data, query), context = marketPressureContext(data, normalizedQuery, actor.codigo);
    const analytics = buildPortfolioAnalytics(context.scoped, normalizedQuery);
    analytics.maturidadeIvvBase=buildMaturityBase(data,normalizedQuery,actor.codigo);
    analytics.marketPressure = await getMarketPressure(context.pressureQuery, { neighborhoods:data.neighborhoods || [], enterprises:context.scoped.empreendimentos, referenceEnterprises:context.references });
    return send(res, 200, analytics);
  }
  if (method === 'GET' && pathname === '/api/user-favorites') { const data = await readData(), actor = requestActor(req); return send(res, 200, { userId:actor.codigo, favorites:(data.userFavorites || []).filter((item) => item.user_id === actor.codigo) }); }
  if (method === 'PUT' && parts[1] === 'user-favorites' && parts.length === 3) {
    const enterpriseId = parts[2], payload = parseJson(await body(req)), data = await readData(), actor = requestActor(req);
    if (!data.empreendimentos.some((item) => item.id === enterpriseId && item.status !== 'inactive')) return send(res, 404, { error:'Empreendimento não encontrado.' });
    const desired = Boolean(payload.favorite), currentIndex = (data.userFavorites || []).findIndex((item) => item.user_id === actor.codigo && item.enterprise_id === enterpriseId);
    if (desired && currentIndex < 0) data.userFavorites.push({ id:crypto.randomUUID(), user_id:actor.codigo, enterprise_id:enterpriseId, created_at:now() });
    if (!desired && currentIndex >= 0) data.userFavorites.splice(currentIndex, 1);
    log(data, desired ? 'empreendimento_favoritado' : 'empreendimento_desfavoritado', { empreendimentoId:enterpriseId, userId:actor.codigo }); await writeData(data);
    return send(res, 200, { enterpriseId, favorite:desired, userId:actor.codigo });
  }
  if (method === 'GET' && pathname === '/api/portfolio-home') {
    const data = await readData(), actor = requestActor(req), context = marketPressureContext(data, query, actor.codigo), home = buildPortfolioHome(data, query, actor.codigo);
    const pressure = await getMarketPressure(context.pressureQuery, { neighborhoods:data.neighborhoods || [], enterprises:context.scoped.empreendimentos, referenceEnterprises:context.references });
    return send(res, 200, compactPortfolioHome(attachPressureToPortfolioHome(home, pressure)));
  }
  if (method === 'GET' && pathname === '/api/empreendimentos') { const data = await readData(), includeInactive=isTruthyQuery(query.incluirInativos); return send(res, 200, data.empreendimentos.filter((item) => includeInactive || item.status !== 'inactive').map(publicEmpreendimento)); }
  if (method === 'POST' && pathname === '/api/empreendimentos') {
    const payload = parseJson(await body(req)); if (!payload.nome?.trim()) return send(res, 422, { error: 'Informe o nome do empreendimento.' }); const onlineTable = normalizeOnlineTable(payload); if (onlineTable.error) return send(res, 422, { error:onlineTable.error }); const coordinates = coordinatePayload(payload); if (coordinates.error) return send(res, 422, { error:coordinates.error });
    const data = await readData(); const id = nextId(data, 'empreendimento', 'EMP'); const empreendimento = { id, nome: payload.nome.trim(), construtora: payload.construtora || '', linkTabela: onlineTable.link, tabelaOnlineStatus:onlineTable.status, endereco: payload.endereco || '', numero: payload.numero || '', complemento: payload.complemento || '', bairro: payload.bairro || '', cidade: payload.cidade || '', estado: payload.estado || '', cep: payload.cep || '', latitude: null, longitude: null, geocodeStatus: null, geocodeLabel: null, tipo: payload.tipo || 'Outro', fase: ENTERPRISE_PHASES.includes(payload.fase) ? payload.fase : 'Novo', launchDate: normalizeManagementDate(payload.launchDate), deliveryDate: normalizeManagementDate(payload.deliveryDate), prazoEntregaChaves: String(payload.prazoEntregaChaves || '').trim(), formasPagamento: payload.formasPagamento || '', caracteristicasComerciais: payload.caracteristicasComerciais || '', observacoes: payload.observacoes || '', informacoesEstruturais: payload.informacoesEstruturais || '', status: 'active', createdAt: now(), updatedAt: now(), tabelas: [] }; applyEnterpriseDomains(data, empreendimento, payload); applyConstructionPayload(empreendimento, payload); await resolveEnterpriseCoordinates(empreendimento, coordinates.value); data.empreendimentos.push(empreendimento); log(data, 'empreendimento_cadastrado', { empreendimentoId: id, fonteLocalizacao:empreendimento.geocodeStatus, statusObra:empreendimento.statusObra }); await writeData(data); return send(res, 201, publicEmpreendimento(empreendimento));
  }
  const id = parts[2]; if (!id) return send(res, 404, { error: 'Rota não encontrada.' }); const data = await readData(); const empreendimento = data.empreendimentos.find((item) => item.id === id); if (!empreendimento) return send(res, 404, { error: 'Empreendimento não encontrado.' });
  if (method === 'GET' && parts[3] === 'unidades' && parts.length === 4) {
    const projection = generalCatalogProjection(empreendimento, query); return send(res, 200, { ...projection, tabelaPadrao: projection.tabelaBase ? { id: projection.tabelaBase.id, nome: projection.tabelaBase.name, tipo: projection.tabelaBase.tipoTabela, validade: projection.tabelaBase.validityDate } : null });
  }
 if (method === 'GET' && parts[3] === 'historico' && parts.length === 4) return send(res, 200, historicalView(empreendimento, query));
  if (method === 'GET' && parts[3] === 'analytics' && parts.length === 4) {
    try {
      // IPD/IPO é uma leitura territorial: atributos do produto só entram quando
      // forem filtros explícitos do usuário. Restringir automaticamente pelo
      // cadastro do empreendimento fazia o bairro e o entorno ficarem vazios.
      const detailQuery = { ...query, bairro:'', bairroNome:'' };
      const actor = requestActor(req);
      const analytics = buildAnalytics(empreendimento, query);
      const maturityTable=(empreendimento.tabelas || []).find((table) => table.id === analytics.tabelaAtual?.id) || null;
      const maturityBase=buildMaturityBase(data,query,actor.codigo);
      analytics.maturidadeIvv=buildMaturityProjection(empreendimento, maturityTable, analytics.intervalo, maturityBase);
      const competitive = competitiveContext(empreendimento, data.empreendimentos || []), thermalRadiusKm = 2;
      // The executive map is deliberately local: its thermometers always read the asset's 2 km surroundings.
      const influenceBands = [{ maxKm:1, weight:1 }, { maxKm:thermalRadiusKm, weight:.65 }];
      const pressureConfig = { ...PRESSURE_CONFIG, influenceBands };
      analytics.marketPressure = await getMarketPressure(detailQuery, { neighborhoods:data.neighborhoods || [], enterprises:[empreendimento], referenceEnterprises:[empreendimento], config:pressureConfig });
      const territorialPressure = analytics.marketPressure?.influence;
      analytics.contextoCompetitivo = { ...competitive, territorial:{ bairro:empreendimento.bairro || null, modo:'influence', raioKm:thermalRadiusKm, ipd:territorialPressure?.ipd ?? null, ipo:territorialPressure?.ipo ?? null, leitura:`IPD/IPO calculados no entorno competitivo de ${thermalRadiusKm.toLocaleString('pt-BR',{maximumFractionDigits:2})} km.` } };
      // The individual view reuses the portfolio calculation and returns only this asset's diagnostic row.
      const radarQuery = marketPeriodQuery(query), radarScoped = scopedDataForSharedFilters(data, radarQuery, actor.codigo), radarEntries = buildRadarAnalyticalInput(radarScoped, radarQuery);
      const radarDates = radarEntries.flatMap((entry) => entry.history.map((table) => String(table.date).slice(0,10))).sort();
      const radarIndex = radarDates.length ? await getIgpm(radarDates[0], radarDates.at(-1)) : { rows:[], warning:'Sem histórico monitorado.' };
      const radarResult = RadarAnalysis.analyze(radarEntries, radarIndex, radarQuery);
      analytics.radarNexum = radarResult.rows.find((row) => row.id === empreendimento.id) || null;
      // A linha pontilhada do Radar é o grupo comparável verificável do ativo,
      // nunca uma meta inventada ou a média de todo o portfólio.
      const comparableIds = new Set(analytics.radarNexum?.price?.peerIds || []);
      analytics.radarComparaveis = radarResult.rows.filter((row) => comparableIds.has(row.id));
      analytics.radarMetodologia = radarResult.methodology;
      analytics.radarFonteIndice = radarResult.indexSource;
      // Os índices macroeconômicos são uma referência comum da tela: sempre os
      // últimos 12 meses, sem depender da quantidade de fotografias do ativo.
      const macroEnd = new Date(), macroStart = new Date(macroEnd);
      // Consulta uma janela maior porque as divulgações possuem calendários
      // diferentes. O acumulado exibido usa sempre as últimas 12 observações
      // publicadas de cada índice — jamais meses futuros estimados.
      macroStart.setMonth(macroStart.getMonth() - 16); macroStart.setDate(1);
      const macroFrom = macroStart.toISOString().slice(0,10), macroTo = macroEnd.toISOString().slice(0,10);
      const macroIndices = await getMarketIndices(macroFrom, macroTo);
      analytics.indicesMacro = Object.fromEntries(Object.entries(macroIndices).map(([key, item]) => {
        const published = (item.rows || []).filter((row) => Number.isFinite(Number(row.value))).slice(-12);
        const accumulated = published.length === 12 ? (published.reduce((total, row) => total * (1 + Number(row.value) / 100), 1) - 1) * 100 : null;
        const period = published.length ? { de:published[0].month, ate:published.at(-1).month, meses:published.length } : null;
        const warning = item.warning || (published.length < 12 ? 'A fonte oficial ainda não possui 12 divulgações para este índice.' : null);
        return [key, { label:item.label, source:item.source, url:item.url || null, warning, fetchedAt:item.fetchedAt || null, accumulated, period }];
      }));
      analytics.indicesMacroPeriodo = { de:macroFrom, ate:macroTo, descricao:'Acumulado composto dos últimos 12 meses publicados.' };
      analytics.leituraNexum = enterpriseNexumReading(analytics);
      return send(res, 200, analytics);
    } catch (error) { return send(res, error.status || 422, { error: error.message }); }
  }
 if (method === 'GET' && parts[3] === 'simulacao-contexto' && parts.length === 4) {
    const projection = generalCatalogProjection(empreendimento, { modalidade: query.modalidade, versao: query.tabela, plano: query.plano }); const selectedTable = projection.versao ? (empreendimento.tabelas || []).find((table) => table.id === projection.versao.id) : null;
    return send(res, 200, { empreendimento: { id: empreendimento.id, nome: empreendimento.nome }, modalidades: projection.modalidades, tabela: selectedTable, unidades: selectedTable?.unidades || [], modalidade: projection.modalidade, versao: projection.versao, plano: projection.plano, calculavel: Boolean(selectedTable && !['FINANCIAMENTO_BANCARIO', 'FINANCIAMENTO_CEF'].includes(selectedTable.tipoTabela) && ['validado_automaticamente', 'validada'].includes(selectedTable.regraInterpretada?.status) && !Number(selectedTable.regraInterpretada?.conciliacao?.divergentes || 0)), informativo: Boolean(selectedTable && ['FINANCIAMENTO_BANCARIO', 'FINANCIAMENTO_CEF'].includes(selectedTable.tipoTabela)) });
  }
  if (method === 'POST' && parts[3] === 'unidades' && parts[4] === 'situacoes') {
    const payload = parseJson(await body(req)); if (!Array.isArray(payload.situacoes) || !payload.situacoes.length) return send(res, 422, { error: 'Informe ao menos uma situação para atualizar.' });
    const changes = [];
    for (const submitted of payload.situacoes) {
      const next = normalizeUnitStatus(submitted.situacao || submitted.situacaoExtraida); if (!UNIT_STATUSES.includes(next)) return send(res, 422, { error: 'Situação comercial inválida.' });
      const current = (empreendimento.unidades || []).find((unit) => unit.chave === String(submitted.chave || '')); if (!current) return send(res, 422, { error: 'Uma unidade informada não pertence ao Cadastro Central.' });
      if (current.situacaoComercial !== next) { applyCentralStatus(empreendimento, current.chave, next, { origin: 'edicao_manual', confirmadoPor: requestActor(req).codigo, observation: submitted.observacao || '' }); changes.push({ chave: current.chave, anterior: current.situacaoComercial, atual: next }); }
    }
    rebuildCommercialHistory(empreendimento, { reason: 'situacao_operacional_atualizada' }); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'situacoes_cadastro_central_atualizadas', { quantidade: changes.length, alteracoes: changes }); await writeData(data);
    return send(res, 200, { unidades: projectedPhysicalUnits(empreendimento), changes });
  }
  if (method === 'POST' && parts[3] === 'pontos-quentes' && parts[4] === 'aprovar') {
    const payload = parseJson(await body(req)); const ids = Array.isArray(payload.ids) ? payload.ids : []; const next = normalizeUnitStatus(payload.situacao); if (!ids.length || !UNIT_STATUSES.includes(next)) return send(res, 422, { error: 'Informe pontos quentes e uma situação válida.' });
    const points = (empreendimento.pontosQuentes || []).filter((point) => ids.includes(point.id) && point.status === 'aberto'); if (points.length !== ids.length) return send(res, 422, { error: 'Um ou mais pontos quentes não estão abertos.' });
    const at = now(); for (const point of points) { applyCentralStatus(empreendimento, point.chave, next, { origin: 'ausencia_confirmada', tableId: point.tabelaId, pontoQuenteId: point.id, observation: payload.observacao || '', at, eventKey: `hot:${point.id}:${next}` }); Object.assign(point, { status: 'resolvido', situacaoDefinida: next, observacao: String(payload.observacao || ''), resolvedAt: at, updatedAt: at }); }
    rebuildCommercialHistory(empreendimento, { reason: 'confirmacao_pontos_quentes' }); empreendimento.updatedAt = at; audit(data, empreendimento, req, 'pontos_quentes_aprovados', { quantidade: points.length, situacao: next, pontos: ids }); await writeData(data);
    return send(res, 200, { pontosQuentes: empreendimento.pontosQuentes, unidades: projectedPhysicalUnits(empreendimento) });
  }
  if (method === 'GET' && parts[3] === 'radar') return send(res, 200, buildRadar(empreendimento, query.modalidade));
  if (method === 'POST' && parts[3] === 'geocodificar') { const result = await geocode(empreendimento); empreendimento.latitude = result.latitude; empreendimento.longitude = result.longitude; empreendimento.geocodeStatus = result.source || 'automatic'; empreendimento.geocodeLabel = result.label; for (const field of ['endereco', 'bairro', 'cidade', 'estado']) if (!empreendimento[field] && result.location?.[field]) empreendimento[field] = result.location[field]; applyEnterpriseDomains(data, empreendimento, empreendimento); empreendimento.updatedAt = now(); log(data, 'empreendimento_geocodificado', { empreendimentoId: id, latitude: result.latitude, longitude: result.longitude, source: empreendimento.geocodeStatus }); await writeData(data); return send(res, 200, { latitude: result.latitude, longitude: result.longitude, label: result.label, source: empreendimento.geocodeStatus, location: result.location }); }
  if (method === 'POST' && parts[3] === 'imagem' && parts.length === 4) {
    const { file } = parseMultipart(await body(req, 8 * 1024 * 1024), req.headers['content-type'] || '');
    if (!file) return send(res, 422, { error: 'Selecione uma imagem de capa.' });
    const extensionByType = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }; const extension = extensionByType[file.type] || path.extname(file.name || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension) || (file.type && !extensionByType[file.type])) return send(res, 422, { error: 'Use uma imagem JPG, PNG ou WEBP.' });
    const storedName = `${id}_${Date.now()}_${crypto.randomUUID()}${extension === '.jpeg' ? '.jpg' : extension}`;
    await fs.writeFile(path.join(ENTERPRISE_IMAGE_DIR, storedName), file.buffer);
    empreendimento.imagem = { path: `img_empreendimentos/${storedName}`, originalName: file.name, mimeType: file.type || MIME[extension], uploadedAt: now() };
    empreendimento.updatedAt = now(); log(data, 'imagem_empreendimento_atualizada', { empreendimentoId: id, arquivo: file.name }); await writeData(data);
    return send(res, 201, { imagem: empreendimento.imagem });
  }
  if (method === 'DELETE' && parts.length === 3) {
    const motivo = String(query.motivo || '').trim();
    empreendimento.status = 'inactive'; empreendimento.deletedAt = now(); empreendimento.deletedBy = requestActor(req).codigo; empreendimento.deletionReason = motivo || 'Exclusão solicitada na Gestão';
    data.userFavorites = (data.userFavorites || []).filter((item) => item.enterprise_id !== id);
    audit(data, empreendimento, req, 'empreendimento_excluido', { motivo: empreendimento.deletionReason, tabelasPreservadas: (empreendimento.tabelas || []).length });
    await writeData(data); return send(res, 200, { deletedId: id, status: 'inactive', tabelasPreservadas: (empreendimento.tabelas || []).length });
  }
  if (method === 'GET' && parts.length === 3) return send(res, 200, query.resumo === '1' ? publicEnterpriseSummary(empreendimento) : publicEmpreendimento(empreendimento));
  if (method === 'PUT' && parts.length === 3) { const payload = parseJson(await body(req)); const onlineTable = normalizeOnlineTable(payload); if (onlineTable.error) return send(res, 422, { error:onlineTable.error }); const coordinates = coordinatePayload(payload); if (coordinates.error) return send(res, 422, { error:coordinates.error }); Object.assign(empreendimento, { ...payload, linkTabela:onlineTable.link, tabelaOnlineStatus:onlineTable.status, fase: ENTERPRISE_PHASES.includes(payload.fase) ? payload.fase : empreendimento.fase || 'Novo', launchDate: normalizeManagementDate(payload.launchDate), deliveryDate: normalizeManagementDate(payload.deliveryDate), id: empreendimento.id, tabelas: empreendimento.tabelas, updatedAt: now() }); applyEnterpriseDomains(data, empreendimento, payload); applyConstructionPayload(empreendimento, payload); await resolveEnterpriseCoordinates(empreendimento, coordinates.value); log(data, 'empreendimento_atualizado', { empreendimentoId: id, fonteLocalizacao:empreendimento.geocodeStatus, statusObra:empreendimento.statusObra }); await writeData(data); return send(res, 200, publicEmpreendimento(empreendimento)); }
  // Compatibilidade de leitura: evita que telas em cache peçam a coleção de
  // tabelas e recebam uma falsa mensagem de "Tabela não encontrada".
  if (method === 'GET' && parts[3] === 'tabelas' && parts.length === 4) return send(res, 200, query.resumo === '1' ? (empreendimento.tabelas || []).map((table) => tableSummary(table, empreendimento)) : (empreendimento.tabelas || []));
  if (method === 'GET' && parts[3] === 'tabelas' && parts.length === 5) {
    const requested = (empreendimento.tabelas || []).find((item) => item.id === parts[4]);
    return requested ? send(res, 200, requested) : send(res, 404, { error: 'Tabela não encontrada.' });
  }
  // A rota de upload tem exatamente quatro segmentos. Sem essa guarda, ela
  // intercepta indevidamente /tabelas/:tabelaId/validar e tenta ler JSON
  // de validação como multipart/form-data.
  if (method === 'POST' && parts[3] === 'tabelas' && parts.length === 4) {
    const { fields, file } = parseMultipart(await body(req), req.headers['content-type'] || ''); if (!fields.nome?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fields.dataValidade || '') || !file) return send(res, 422, { error: 'Informe nome, data de validade e um PDF.' }); if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return send(res, 422, { error: 'O arquivo precisa estar em formato PDF.' });
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex'); const allTables = data.empreendimentos.flatMap((item) => item.tabelas || []); if (allTables.some((table) => table.documento?.hash === hash)) return send(res, 409, { error: 'Este PDF já foi cadastrado.', duplicate: true });
    const inbound = path.join(ROOT, 'pdf', 'entrada', `${crypto.randomUUID()}_${sanitize(file.name)}.pdf`); const processing = path.join(ROOT, 'pdf', 'processando', path.basename(inbound)); await fs.writeFile(inbound, file.buffer); await fs.rename(inbound, processing); log(data, 'pdf_recebido', { empreendimentoId: id, arquivo: file.name }); log(data, 'processamento_iniciado', { empreendimentoId: id, arquivo: file.name });
    const extracted = await extractPdf(processing, id); const tableId = nextId(data, 'tabela', 'TAB');
    // Enquanto está em revisão, o documento ainda não é cadastrado. Isso evita
    // que uma extração incorreta entre no histórico definitivo.
    const pendingName = `${tableId}_${sanitize(file.name)}.pdf`; const pendingPath = path.join(ROOT, 'pdf', 'processando', pendingName);
    try { await fs.rename(processing, pendingPath); } catch (error) { const errorPath = path.join(ROOT, 'pdf', 'erro', path.basename(processing)); await fs.rename(processing, errorPath).catch(() => {}); log(data, 'processamento_falhou', { empreendimentoId: id, motivo: error.message, arquivo: file.name }); await writeData(data); return send(res, 500, { error: 'O PDF não pôde ser organizado.', detail: error.message }); }
    const tipoTabela = canonicalTableType(fields.tipoTabela || `${fields.nome} ${extracted.text.slice(0, 5000)}`); const normalizacao = buildNormalization(extracted.text, extracted, data.dicionarioTermosManuais); const table = { id: tableId, name: fields.nome.trim(), tipoTabela, tipoTabelaLabel: TABLE_TYPE_LABELS[tipoTabela] || 'Outro', validityDate: fields.dataValidade, status: 'pending_validation', isDemo: false, createdAt: now(), processedAt: now(), documento: { originalName: file.name, storedName: pendingName, path: `pdf/processando/${pendingName}`, hash, mimeType: file.type || 'application/pdf' }, extracao: { texto: extracted.text, warnings: extracted.warnings, error: extracted.error || null }, normalizacao, unidades: extracted.units, manualReviewRequired: Boolean(extracted.manualReviewRequired), origem: { tipo: 'pdf', label: 'PDF importado' }, confiancaLeitura: extracted.confidence || readingConfidence(extracted), comparacao: emptyComparison(), alertas: [], regrasComerciais: fields.regrasComerciais || extracted.commercialRules || '', observacoes: fields.observacoes || '', auditoria: [] }; empreendimento.tabelas.push(table); tableOperationalUpdate(empreendimento, table, requestActor(req)); applyCommercialRule(table, true); rebuildTableDerived(empreendimento, table); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'tabela_importada', { tabelaId: tableId, modalidade: tipoTabela, validade: table.validityDate, unidades: table.unidades.length, documentoHash: hash }); if (table.extracao.warnings.length) log(data, 'validacao_pendente', { empreendimentoId: id, tabelaId: tableId, avisos: table.extracao.warnings }); await writeData(data); return send(res, 201, table);
  }
  if (method === 'POST' && parts[3] === 'tabelas' && parts[4] === 'copiar' && parts.length === 5) {
    const payload = parseJson(await body(req)); const source = (empreendimento.tabelas || []).find((item) => item.id === payload.tabelaBaseId);
    if (!source) return send(res, 404, { error: 'A tabela-base não foi encontrada.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dataValidade || '')) return send(res, 422, { error: 'Informe a data de validade da nova versão.' });
    const tableId = nextId(data, 'tabela', 'TAB'); const tipoTabela = canonicalTableType(payload.tipoTabela || source.tipoTabela);
    const table = { id: tableId, name: String(payload.nome || `Cópia de ${source.name}`).trim(), tipoTabela, tipoTabelaLabel: TABLE_TYPE_LABELS[tipoTabela] || 'Outro', validityDate: payload.dataValidade, status: 'pending_validation', isDemo: false, createdAt: now(), processedAt: now(), documento: null, extracao: { texto: '', warnings: [], error: null }, normalizacao: source.normalizacao || { formato: 'copia_manual', campos: [] }, unidades: copyForReview(empreendimento, source), manualReviewRequired: false, origem: { tipo: 'copia_manual', label: 'Cópia editável de tabela existente', tabelaBaseId: source.id }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'copia_manual' }, comparacao: emptyComparison(), alertas: [], regrasComerciais: source.regrasComerciais || '', observacoes: String(payload.observacoes || ''), auditoria: [{ at: now(), action: 'tabela_criada_por_copia', tabelaBaseId: source.id }] };
    empreendimento.tabelas.push(table); rebuildTableDerived(empreendimento, table); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'tabela_criada_por_copia', { tabelaId: table.id, tabelaOrigemId: source.id, unidades: table.unidades.length }); await writeData(data); return send(res, 201, table);
  }
  if (parts[3] !== 'tabelas' || !parts[4]) return send(res, 404, { error: 'Rota não encontrada.' });
  const tableId = parts[4]; const table = (empreendimento.tabelas || []).find((item) => item.id === tableId); if (!table) return send(res, 404, { error: 'Tabela não encontrada.' });
  if (method === 'POST' && parts[5] === 'mapear-termos') {
    if (table.status !== 'pending_validation') return send(res, 409, { error: 'Mapeamentos de termos devem ser concluídos na revisão, antes da confirmação da fotografia.' });
    const payload = parseJson(await body(req)); const mappings = Array.isArray(payload.mapeamentos) ? payload.mapeamentos : [];
    if (!mappings.length) return send(res, 422, { error: 'Informe ao menos uma decisão de aprendizado.' });
    const unresolved = new Set((table.normalizacao?.termosNaoMapeadosDetalhes || []).map((item) => item.termoTecnico)); const added = [];
    for (const mapping of mappings) {
      const termoOrigem = String(mapping.termoOrigem || '').replace(/\s+/g, ' ').trim(), termKey = normalizeTableTermText(termoOrigem), decisao = ['vincular','nao_vincular','novo_padrao'].includes(mapping.decisao) ? mapping.decisao : 'vincular';
      if (!termKey || !unresolved.has(termKey)) return send(res, 422, { error: `O termo "${termoOrigem}" não está pendente nesta tabela.` });
      if (TABLE_TERM_DICTIONARY.index.has(termKey)) return send(res, 409, { error: `"${termoOrigem}" já existe no CSV e não pode ser sobrescrito pela tabela manual.` });
      const existing = (data.dicionarioTermosManuais || []).find((entry) => normalizeTableTermText(entry.termoOrigem) === termKey);
      let termoNormalizado = null, categoria = 'ignorado', novoPadrao = null;
      if (decisao === 'novo_padrao') {
        const details = mapping.novoPadrao || {}, nome = String(details.nome || mapping.termoNormalizado || '').replace(/\s+/g, ' ').trim();
        if (!nome) return send(res, 422, { error: `Informe o nome do novo padrão para "${termoOrigem}".` });
        termoNormalizado = normalizeTableTermText(nome).replace(/\s+/g, '_'); categoria = String(details.categoria || 'outro').trim() || 'outro';
        novoPadrao = (data.termosCanonicosManuais || []).find((item) => normalizeTableTermText(item.termoNormalizado) === normalizeTableTermText(termoNormalizado));
        if (!novoPadrao && CANONICAL_TABLE_TERMS.has(normalizeTableTermText(termoNormalizado))) return send(res, 422, { error: `"${nome}" já existe como padrão nativo. Use Vincular.` });
        if (!novoPadrao) { novoPadrao = { id:crypto.randomUUID(), termoNormalizado, nome, categoria, tipoDado:String(details.tipoDado || '').trim(), unidade:String(details.unidade || '').trim(), criadoEm:now(), criadoPor:requestActor(req) }; data.termosCanonicosManuais.push(novoPadrao); }
      } else if (decisao === 'vincular') {
        termoNormalizado = String(mapping.termoNormalizado || '').trim(); const canonical = canonicalTableTermOptions(data).find((item) => normalizeTableTermText(item.termoNormalizado) === normalizeTableTermText(termoNormalizado));
        if (!canonical) return send(res, 422, { error: `Escolha um padrão canônico válido para "${termoOrigem}".` });
        termoNormalizado = canonical.termoNormalizado; categoria = canonical.categoria;
      }
      if (existing && (existing.decisao || 'vincular') !== decisao) return send(res, 409, { error: `"${termoOrigem}" já possui uma decisão de aprendizado diferente.` });
      if (existing && decisao !== 'nao_vincular' && normalizeTableTermText(existing.termoNormalizado) !== normalizeTableTermText(termoNormalizado)) return send(res, 409, { error: `"${termoOrigem}" já possui um vínculo manual diferente.` });
      if (!existing) { const entry = { id:crypto.randomUUID(), termoOrigem, termoTecnico:termKey, decisao, termoNormalizado, categoria, origem:decisao === 'novo_padrao' ? 'novo_padrao_na_revisao' : decisao === 'nao_vincular' ? 'exclusao_manual_na_revisao' : 'vinculacao_manual_na_revisao', criadoEm:now(), criadoPor:requestActor(req), novoPadraoId:novoPadrao?.id || null }; data.dicionarioTermosManuais.push(entry); added.push(entry); }
    }
    table.normalizacao = buildNormalization(table.extracao?.texto || '', { commercialRules: table.regrasComerciais || '' }, data.dicionarioTermosManuais); rebuildTableDerived(empreendimento, table); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'termos_normalizados_manualmente', termos: added.map((entry) => ({ origem: entry.termoOrigem, normalizado: entry.termoNormalizado })) }); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'termos_tabela_mapeados', { tabelaId: table.id, quantidade: added.length, termos: added.map((entry) => entry.termoOrigem) }); await writeData(data);
    return send(res, 200, table);
  }
  if (method === 'GET' && parts[5] === 'impacto-exclusao') return send(res, 200, exclusionImpact(empreendimento, table));
  if (method === 'GET' && parts[5] === 'visualizacao-comercial') return send(res, 200, commercialVisualization(empreendimento, table, String(query.planos || '').split(',').filter(Boolean)));
  if (method === 'POST' && ['definir-base', 'definir-padrao'].includes(parts[5])) {
    if (table.status !== 'registered') return send(res, 409, { error: 'Confirme a tabela antes de defini-la como padrão do empreendimento.' });
    empreendimento.tabelaBaseId = table.id; empreendimento.tabelaBaseDefinidaEm = now(); empreendimento.tabelaPadraoTipo = table.tipoTabela; empreendimento.tabelaPadraoTableId = table.id; rebuildCentralCatalog(empreendimento); empreendimento.updatedAt = now();
    audit(data, empreendimento, req, 'tabela_base_definida', { tabelaId: table.id, modalidade: table.tipoTabela }); await writeData(data);
    return send(res, 200, { tabelaBaseId: empreendimento.tabelaBaseId, tabelaPadraoTipo: empreendimento.tabelaPadraoTipo, tabelaPadraoTableId: empreendimento.tabelaPadraoTableId });
  }
  if (method === 'POST' && parts[5] === 'demo') {
    const payload = parseJson(await body(req)); table.isDemo = payload.isDemo === undefined ? !table.isDemo : Boolean(payload.isDemo); table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: table.isDemo ? 'tabela_marcada_como_demo' : 'tabela_desmarcada_como_demo' }); empreendimento.updatedAt = now();
    log(data, 'tabela_demo_atualizada', { empreendimentoId: id, tabelaId: table.id, isDemo: table.isDemo }); await writeData(data);
    return send(res, 200, { id: table.id, isDemo: table.isDemo, updatedAt: table.updatedAt });
  }
 if (method === 'POST' && parts[5] === 'reprocessar') {
   if (table.status !== 'pending_validation') return send(res, 409, { error: 'Apenas tabelas pendentes podem ser reprocessadas. Versões confirmadas preservam sua extração histórica.' });
   if (!table.documento?.path) return send(res, 409, { error: 'Esta versão foi criada manualmente e não possui PDF para reprocessar.' });
   const sourcePath = path.join(ROOT, table.documento.path); const extracted = await extractPdf(sourcePath, id);
   table.unidades = extracted.units; table.extracao = { texto: extracted.text, warnings: extracted.warnings, error: extracted.error || null }; table.normalizacao = buildNormalization(extracted.text, extracted, data.dicionarioTermosManuais); table.manualReviewRequired = Boolean(extracted.manualReviewRequired); table.confiancaLeitura = extracted.confidence || readingConfidence(extracted);
   table.regrasComerciais = table.regrasComerciais || extracted.commercialRules || ''; applyCommercialRule(table, true); rebuildTableDerived(empreendimento, table); table.processedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'reprocessamento_de_pdf', unidadesReconhecidas: table.unidades.length }); empreendimento.updatedAt = now(); log(data, 'tabela_reprocessada', { empreendimentoId: id, tabelaId: table.id, unidades: table.unidades.length }); await writeData(data); return send(res, 200, table);
 }
  if (method === 'POST' && parts[5] === 'revisar-extracao') {
    if (!['registered', 'superseded'].includes(table.status)) return send(res, 409, { error: 'A revisão auditada só pode partir de uma fotografia confirmada.' });
    if (!table.documento?.path) return send(res, 409, { error: 'Esta fotografia não possui PDF para reprocessar.' });
    const payload = parseJson(await body(req)); const validityDate = payload.dataValidade || table.validityDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validityDate || '')) return send(res, 422, { error: 'Informe uma data de validade válida para a revisão.' });
    const sourcePath = path.join(ROOT, table.documento.path); const extracted = await extractPdf(sourcePath, id); const reviewId = nextId(data, 'tabela', 'TAB');
    const review = { id: reviewId, name: String(payload.nome || `${table.name} · revisão auditada`).trim(), tipoTabela: table.tipoTabela, tipoTabelaLabel: table.tipoTabelaLabel, validityDate, status: 'pending_validation', isDemo: Boolean(table.isDemo), createdAt: now(), processedAt: now(), documento: { ...table.documento, compartilhado: true, compartilhadoComTableId: table.id }, extracao: { texto: extracted.text, warnings: extracted.warnings, error: extracted.error || null }, normalizacao: buildNormalization(extracted.text, extracted, data.dicionarioTermosManuais), unidades: extracted.units, manualReviewRequired: Boolean(extracted.manualReviewRequired), origem: { tipo: 'revisao_auditada', label: 'Revisão auditada de extração', tabelaOrigemId: table.id }, correcaoDeTableId: table.id, substituiTableId: table.id, confiancaLeitura: extracted.confidence || readingConfidence(extracted), comparacao: emptyComparison(), alertas: [], regrasComerciais: table.regrasComerciais || extracted.commercialRules || '', observacoes: String(payload.observacoes || 'Correção de extração preservando o PDF publicado.'), auditoria: [{ at: now(), action: 'revisao_auditada_criada', tabelaOrigemId: table.id, unidadesReconhecidas: extracted.units.length, documentoHash: table.documento.hash }] };
    applyCommercialRule(review, true); rebuildTableDerived(empreendimento, review); empreendimento.tabelas.push(review); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'revisao_auditada_criada', { tabelaId: review.id, tabelaOrigemId: table.id, unidades: review.unidades.length, validade: validityDate }); await writeData(data); return send(res, 201, review);
  }
  if (method === 'POST' && parts[5] === 'classificar-removidas') {
    const payload = parseJson(await body(req)); if (!Array.isArray(payload.classificacoes)) return send(res, 422, { error: 'Informe as classificações das unidades removidas.' });
    const previousTable = previousRegisteredTable(empreendimento, table); const pending = removalDetails(previousTable, table, table.classificacoesRemocao || {}); const validKeys = new Set(pending.map((item) => item.chave));
    const next = { ...(table.classificacoesRemocao || {}) };
    for (const item of payload.classificacoes) {
      if (!validKeys.has(item.chave)) return send(res, 422, { error: 'Uma unidade informada não pertence às saídas desta versão.' });
      if (!REMOVAL_STATUSES.includes(item.status)) return send(res, 422, { error: 'Classificação de saída inválida.' });
      if (item.status === 'PENDENTE') delete next[item.chave];
      else next[item.chave] = { status: item.status, observacao: String(item.observacao || '').slice(0, 1000), at: now(), usuario: requestActor(req).codigo };
    }
    table.classificacoesRemocao = next; rebuildTableDerived(empreendimento, table); if (table.status === 'registered') rebuildCentralCatalog(empreendimento); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'classificacao_de_saida', quantidade: payload.classificacoes.length }); empreendimento.updatedAt = now();
    rebuildCommercialHistory(empreendimento, { reason: 'classificacao_de_saida' }); audit(data, empreendimento, req, 'saidas_classificadas', { tabelaId: table.id, quantidade: payload.classificacoes.length, classificacoes: payload.classificacoes }); await writeData(data);
    return send(res, 200, { removals: removalSummary(removalDetails(previousTable, table, next)) });
  }
  if (method === 'POST' && parts[5] === 'corrigir-vigencia') {
    const payload = parseJson(await body(req)); const validityDate = String(payload.dataValidade || '');
    const observacao = String(payload.observacao || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validityDate)) return send(res, 422, { error: 'Informe uma data de vigência válida.' });
    if (!observacao) return send(res, 422, { error: 'Informe a evidência que sustenta a correção da vigência.' });
    const previousDate = table.validityDate;
    if (previousDate === validityDate) return send(res, 200, { table, unchanged:true });
    table.validityDate = validityDate;
    table.origem = { ...(table.origem || {}), vigenciaCorrigida: true, vigenciaOriginal: previousDate, vigenciaEvidencia: observacao, vigenciaCorrigidaEm: now() };
    table.observacoes = [String(table.observacoes || '').trim(), `Vigência corrigida de ${previousDate || 'não informada'} para ${validityDate}: ${observacao}`].filter(Boolean).join('\n');
    table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action:'vigencia_corrigida', anterior:previousDate, atual:validityDate, observacao });
    rebuildTableDerived(empreendimento, table); if (table.status === 'registered') rebuildCentralCatalog(empreendimento);
    rebuildCommercialHistory(empreendimento, { reason:'correcao_de_vigencia' }); empreendimento.updatedAt = now();
    audit(data, empreendimento, req, 'vigencia_de_tabela_corrigida', { tabelaId:table.id, anterior:previousDate, atual:validityDate, observacao }); await writeData(data);
    return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'usar-versao-anterior') {
    if (table.status !== 'pending_validation') return send(res, 409, { error: 'A base anterior só pode ser usada enquanto a tabela está em validação.' });
    if (!table.manualReviewRequired || (table.unidades || []).length) return send(res, 409, { error: 'Esta tabela já possui unidades para revisão.' });
    const previousTable = previousRegisteredTable(empreendimento, table);
    if (!previousTable?.unidades?.length) return send(res, 409, { error: 'Não há uma versão anterior compatível para usar como base.' });
    table.unidades = copyForReview(empreendimento, previousTable).map((unit) => ({ ...unit, valorValidado: null, situacaoExtraida: 'Não identificado', linhaOriginal: null, origemLeitura: 'versao_anterior_para_revisao_manual' }));
    table.manualReviewBaseTableId = previousTable.id; table.origem = { ...(table.origem || {}), tabelaBaseId: previousTable.id, label: 'PDF-imagem com base anterior para revisão' }; rebuildTableDerived(empreendimento, table);
    table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'unidades_baseadas_na_versao_anterior', tabelaBaseId: previousTable.id, unidades: table.unidades.length }); empreendimento.updatedAt = now();
    log(data, 'unidades_baseadas_na_versao_anterior', { empreendimentoId: id, tabelaId: table.id, tabelaBaseId: previousTable.id, unidades: table.unidades.length }); await writeData(data); return send(res, 200, table);
  }
  if (method === 'PUT' && parts.length === 5) {
    const payload = parseJson(await body(req)); const tipoTabela = canonicalTableType(payload.tipoTabela || table.tipoTabela);
    table.tipoTabela = tipoTabela; table.tipoTabelaLabel = TABLE_TYPE_LABELS[tipoTabela] || 'Outro'; rebuildTableDerived(empreendimento, table); table.updatedAt = now();
    if (empreendimento.tabelaBaseId === table.id || empreendimento.tabelaPadraoTableId === table.id) empreendimento.tabelaPadraoTipo = tipoTabela;
    for (const candidate of (empreendimento.tabelas || []).filter(item => item.id !== table.id)) rebuildTableDerived(empreendimento, candidate);
    rebuildCentralCatalog(empreendimento);
    rebuildCommercialHistory(empreendimento, { reason:'modalidade_atualizada' });
    table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'modalidade_atualizada', tipoTabela, tipoTabelaLabel: table.tipoTabelaLabel });
    empreendimento.updatedAt = now(); log(data, 'modalidade_de_tabela_atualizada', { empreendimentoId: id, tabelaId: table.id, tipoTabela }); await writeData(data);
    return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'editar-condicoes') {
    const payload = parseJson(await body(req)); let target = table; let created = false;
    if (table.status === 'registered') {
      const targetId = nextId(data, 'tabela', 'TAB'); const stamp = now();
      target = { ...JSON.parse(JSON.stringify(table)), id: targetId, name: String(payload.nome || `${table.name} · ajuste comercial`).trim(), validityDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.dataValidade || '') ? payload.dataValidade : table.validityDate, status: 'pending_validation', createdAt: stamp, updatedAt: stamp, validatedAt: null, documento: null, documentoReferencia: table.documento ? { tabelaId: table.id, ...table.documento } : (table.documentoReferencia || null), unidades: copyForReview(empreendimento, table), origem: { tipo: 'edicao_regra', label: 'Nova versão por edição de condições', tabelaBaseId: table.id }, comparacao: emptyComparison(), auditoria: [{ at: stamp, action: 'versao_comercial_criada_para_edicao', tabelaBaseId: table.id }] };
      empreendimento.tabelas.push(target); created = true;
    }
    try { applyCommercialRuleEdits(target, payload); } catch (error) { if (created) empreendimento.tabelas = empreendimento.tabelas.filter((item) => item.id !== target.id); return send(res, 422, { error: error.message }); }
    rebuildTableDerived(empreendimento, target); const automaticallyValid = target.regraInterpretada?.status === 'validado_automaticamente';
    if (created && automaticallyValid) { target.status = 'registered'; target.validatedAt = now(); target.regraInterpretada.ativadaEm = now(); target.regraInterpretada.ativadaPor = 'validacao_automatica_em_massa'; syncPhysicalUnits(empreendimento, target); }
    target.updatedAt = now(); target.auditoria = target.auditoria || []; target.auditoria.push({ at: now(), action: 'condicoes_comerciais_editadas', origem: table.id, componentes: (payload.componentes || []).length, resultado: target.regraInterpretada?.status }); empreendimento.updatedAt = now();
    rebuildCommercialHistory(empreendimento, { reason: 'edicao_de_condicoes' }); audit(data, empreendimento, req, 'condicoes_comerciais_editadas', { tabelaId: target.id, tabelaOrigemId: table.id, novaVersao: created, status: target.regraInterpretada?.status }); await writeData(data); return send(res, created ? 201 : 200, { ...target, novaVersaoCriada: created });
  }
  if (method === 'POST' && parts[5] === 'validar-regra-comercial') {
    if (table.status !== 'registered') return send(res, 409, { error: 'A regra só pode ser confirmada após a versão comercial ser registrada.' });
    const payload = parseJson(await body(req)); if (!table.regraInterpretada?.planos?.length) return send(res, 422, { error: 'Não há uma regra interpretada disponível para esta versão.' });
    applyRuleNatureOverrides(table, payload.naturezasRegra); applyRuleBaseOverrides(table, payload.basesRegra); applyCommercialRule(table);
    if (hasAmbiguousCommercialBase(table)) return send(res, 409, { error: 'Confirme a base de cálculo dos componentes ambíguos antes de ativar a regra.', requiresBaseConfirmation: true, regraInterpretada: table.regraInterpretada });
    table.regraInterpretada.status = 'validado_automaticamente'; table.regraInterpretada.validadaEm = now(); table.regraInterpretada.validadaPor = 'revisao_humana_e_conciliacao_automatica'; table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'regra_comercial_validada', planos: table.regraInterpretada.planos.length }); empreendimento.updatedAt = now();
    log(data, 'regra_comercial_validada', { empreendimentoId: id, tabelaId: table.id, planos: table.regraInterpretada.planos.length }); await writeData(data); return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'situacoes') {
    if (table.status !== 'registered') return send(res, 409, { error: 'Use a revisão normal enquanto a tabela estiver pendente. Atualização operacional de situação é exclusiva de versões confirmadas.' });
    const payload = parseJson(await body(req)); if (!Array.isArray(payload.situacoes) || !payload.situacoes.length) return send(res, 422, { error: 'Informe ao menos uma situação para atualizar.' });
    const indexed = new Map((table.unidades || []).map((unit) => [unit.chave, unit])); const central = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])); const changes = [];
    for (const submitted of payload.situacoes) {
      const unit = indexed.get(String(submitted.chave || '')); const centralUnit = central.get(String(submitted.chave || '')); if (!unit || !centralUnit) return send(res, 422, { error: 'Uma unidade informada não pertence a esta tabela e ao Cadastro Central.' });
      const next = normalizeUnitStatus(submitted.situacaoExtraida); if (!UNIT_STATUSES.includes(next)) return send(res, 422, { error: 'Situação comercial inválida.' });
      if (centralUnit.situacaoComercial !== next) { changes.push({ chave: unit.chave, anterior: centralUnit.situacaoComercial, atual: next }); applyCentralStatus(empreendimento, unit.chave, next, { origin: 'edicao_manual', confirmadoPor: requestActor(req).codigo, tableId: table.id }); }
    }
    rebuildCommercialHistory(empreendimento, { reason: 'situacao_operacional_atualizada' });
    if (!changes.length) { await writeData(data); return send(res, 200, table); }
    table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'situacoes_atualizadas_no_cadastro_central', quantidade: changes.length, alteracoes: changes });
    empreendimento.updatedAt = now(); log(data, 'situacoes_atualizadas_operacionalmente', { empreendimentoId: id, tabelaId: table.id, quantidade: changes.length }); await writeData(data);
    return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'rascunho') {
    if (table.status !== 'pending_validation') return send(res, 409, { error: 'Apenas tabelas em revisão podem ser salvas como rascunho.' });
    const payload = parseJson(await body(req));
    try { table.unidades = normalizeReviewedUnits(empreendimento, table.unidades, payload.unidades); } catch (error) { return send(res, 422, { error: error.message }); }
    table.regrasComerciais = payload.regrasComerciais ?? table.regrasComerciais; table.observacoes = payload.observacoes ?? table.observacoes; applyRuleNatureOverrides(table, payload.naturezasRegra); applyRuleBaseOverrides(table, payload.basesRegra); applyCommercialRule(table, true); rebuildTableDerived(empreendimento, table); table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'rascunho_salvo', unidades: table.unidades.length }); empreendimento.updatedAt = now(); log(data, 'rascunho_de_revisao_salvo', { empreendimentoId: id, tabelaId: table.id, unidades: table.unidades.length }); await writeData(data); return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'excluir') {
    const payload = parseJson(await body(req));
    try { return send(res, 200, await executeTableDeletion(data, empreendimento, table, payload, req)); } catch (error) { return send(res, error.status || 500, { error: error.message, impact: error.impact, requiresBaseReplacement: Boolean(error.requiresBaseReplacement) }); }
  }
  if (method === 'DELETE' && parts.length === 5) {
    try { const result = await executeTableDeletion(data, empreendimento, table, { incluirDependencias: false }, req); return send(res, 200, { ...result, deletedId: table.id }); } catch (error) { return send(res, error.status || 500, { error: error.message, dependencies: error.impact?.dependencias || [], impact: error.impact, requiresBaseReplacement: Boolean(error.requiresBaseReplacement) }); }
  }
  if (method === 'POST' && parts[5] === 'validar') { if (table.status !== 'pending_validation') return send(res, 409, { error: 'Versões confirmadas são imutáveis. Crie uma cópia editável para registrar uma nova alteração.' }); const payload = parseJson(await body(req)); if (!Array.isArray(payload.unidades)) return send(res, 422, { error: 'Informe as unidades validadas.' }); const unmappedTerms = table.normalizacao?.termosNaoMapeadosDetalhes || []; if (unmappedTerms.length) return send(res, 409, { error: `Ainda faltam decisões para: ${unmappedTerms.map((term) => term.termoOriginal).join(', ')}. Cada vínculo, exclusão ou novo padrão é salvo imediatamente.`, termosNaoMapeados: unmappedTerms, table }); try { table.unidades = normalizeReviewedUnits(empreendimento, table.unidades, payload.unidades); } catch (error) { return send(res, 422, { error: error.message }); } applyCommercialRule(table); rebuildTableDerived(empreendimento, table); const criticalAlerts = (table.alertas || []).filter((alert) => alert.nivel === 'critico'); if (criticalAlerts.length && !payload.confirmarAlertasCriticos) return send(res, 409, { error: 'Existem alertas críticos pendentes. Confirme explicitamente os valores antes de concluir.', criticalAlerts, table });
    if (table.documento?.path && !table.documento.compartilhado) { const isJson = table.documento.mimeType === 'application/json' || path.extname(table.documento.originalName || table.documento.storedName || '').toLowerCase() === '.json'; const extension = isJson ? '.json' : '.pdf'; const finalName = `${table.id}_${sanitize(empreendimento.nome)}_${table.validityDate || 'sem-data'}_${sanitize(table.name)}${extension}`; const sourcePath = path.join(ROOT, table.documento.path); const managementEntry=Boolean(table.documento.gestaoEntrada),archiveDir = isJson ? MANAGEMENT_JSON_ARCHIVE_DIR : (managementEntry ? MANAGEMENT_PDF_ARCHIVE_DIR : path.join(ROOT, 'pdf', 'cadastrados')),targetPath = path.join(archiveDir, finalName);
      try { await fs.rename(sourcePath, targetPath); table.documento.storedName = path.basename(targetPath); table.documento.path = isJson ? `JSON cadastrados/${path.basename(targetPath)}` : (managementEntry ? `PDF cadastrados/${path.basename(targetPath)}` : `pdf/cadastrados/${path.basename(targetPath)}`); if(managementEntry){const collection=isJson?'gestaoImportacoesJson':'gestaoImportacoesPdf',job=(data[collection]||[]).find((item)=>item.hash===table.documento.hash);if(job)Object.assign(job,{state:'importado',importedAt:now(),importedBy:requestActor(req),enterpriseId:id,tableId:table.id});} } catch (error) { log(data, 'processamento_falhou', { empreendimentoId: id, tabelaId: table.id, motivo: `Não foi possível concluir o cadastro do arquivo: ${error.message}` }); await writeData(data); return send(res, 500, { error: isJson ? 'Os dados foram revisados, mas o JSON não pôde ser movido para cadastrados.' : 'Os dados foram revisados, mas o PDF não pôde ser movido para cadastrados.', detail: error.message }); } }
    table.status = 'registered'; table.validatedAt = now(); table.regrasComerciais = payload.regrasComerciais ?? table.regrasComerciais; table.observacoes = payload.observacoes ?? table.observacoes; if (table.regraInterpretada?.status === 'validado_automaticamente') { table.regraInterpretada.ativadaEm = now(); table.regraInterpretada.ativadaPor = 'conciliacao_automatica'; } if (table.substituiTableId) { const source = (empreendimento.tabelas || []).find((item) => item.id === table.substituiTableId); if (source) { source.status = 'superseded'; source.supersededByTableId = table.id; source.supersededAt = now(); source.auditoria = source.auditoria || []; source.auditoria.push({ at: now(), action: 'fotografia_substituida_por_revisao_auditada', tabelaSubstitutaId: table.id }); if (empreendimento.tabelaBaseId === source.id || empreendimento.tabelaPadraoTableId === source.id) { empreendimento.tabelaBaseId = table.id; empreendimento.tabelaPadraoTableId = table.id; empreendimento.tabelaPadraoTipo = table.tipoTabela; empreendimento.tabelaBaseDefinidaEm = now(); } } } if (!empreendimento.tabelaBaseId) { empreendimento.tabelaBaseId = table.id; empreendimento.tabelaPadraoTableId = table.id; empreendimento.tabelaPadraoTipo = table.tipoTabela; empreendimento.tabelaBaseDefinidaEm = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at:now(), action:'primeira_tabela_definida_como_base' }); } rebuildTableDerived(empreendimento, table); rebuildCommercialHistory(empreendimento, { reason: table.substituiTableId ? 'confirmacao_de_revisao_auditada' : 'confirmacao_de_tabela' }); syncPhysicalUnits(empreendimento, table); learnMappings(data, table.normalizacao || { campos: [] }); empreendimento.updatedAt = now(); audit(data, empreendimento, req, 'tabela_confirmada', { tabelaId: table.id, modalidade: table.tipoTabela, unidades: table.unidades.length, regraInterpretada: table.regraInterpretada?.status || null }); if (table.documento?.storedName) log(data, 'pdf_cadastrado', { empreendimentoId: id, tabelaId: table.id, arquivo: table.documento.storedName }); await writeData(data); return send(res, 200, table); }
  return send(res, 404, { error: 'Rota não encontrada.' });
}

async function serveStatic(req, res, pathname) { const managementRoutes = { '/gestao':'gestao/index.html', '/gestao/':'gestao/index.html', '/gestao/checklist':'gestao/checklist.html', '/gestao/tabelas':'gestao/tabelas.html', '/gestao/atualizacao-automatica':'gestao/atualizacao-automatica.html', '/gestao/empreendimentos':'gestao/empreendimentos.html', '/gestao/empreendimento':'empreendimento.html', '/gestao/construtoras':'gestao/construtoras.html' }; const requested = pathname === '/' ? 'index.html' : managementRoutes[pathname] || decodeURIComponent(pathname).replace(/^\/+/, ''); const normalizedRequest = requested.replace(/\\/g, '/').toLowerCase(); const filePath = path.resolve(ROOT, requested); if (!filePath.startsWith(ROOT) || requested.includes('..') || normalizedRequest.startsWith('dados/corretores/')) { res.writeHead(403); return res.end('Acesso negado'); } try { const content = await fs.readFile(filePath); res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content); } catch (_) { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('Arquivo não encontrado.'); } }

async function handleRequest(req, res) { try { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname); if (url.pathname === '/gestao/importar-json') return await serveStatic(req, res, '/gestao/importar-json.html'); return await serveStatic(req, res, url.pathname); } catch (error) { console.error(error); return send(res, 500, { error: error.message || 'Erro interno.' }); } }

if (require.main === module) ensureStorage().then(() => http.createServer(handleRequest).listen(PORT, () => console.log(`Nexo Radar disponível em http://localhost:${PORT}`)));

// Superfície mínima para a suíte validar o motor contra PDFs reais sem criar
// fotografias, documentos ou efeitos históricos de teste.
module.exports = { extractPdf, extractUnits, extractQuintasDaMataUnits, loteamentoCommercialPlanLayout, normalizeTableTermText, resolveTableTerm, buildNormalization, canonicalTableTermOptions, TERM_DICTIONARY_FILE, buildRadarAnalyticalInput, buildPortfolioAnalytics, scopedDataForSharedFilters, buildMaturityBase, buildMaturityProjection, handleRequest };
