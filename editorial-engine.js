'use strict';

// Camada editorial: recebe fatos já calculados, decide o que pode ser dito e
// devolve cópia segura. Ela não calcula VSO, IVV ou rankings.
const EDITORIAL_POLICY = Object.freeze({
  version: '2.0',
  audience: 'public_safe',
  maxModules: 4,
  minScore: 55,
  prohibitedSignals: Object.freeze(['absence_of_sales', 'negative_ranking', 'price_reduction', 'stock_return'])
});

const EDITORIAL_WEIGHTS = Object.freeze({
  sale_validated: 94,
  launch: 92,
  performance_context: 86,
  price_update: 80,
  commercial_update: 78,
  offer_update: 74,
  market_pressure: 72,
  monitoring_context: 60,
  stability: 50
});

const PUBLIC_SAFE_KINDS = new Set([
  'sale_validated', 'launch', 'performance_context', 'price_update',
  'commercial_update', 'offer_update', 'market_pressure',
  'monitoring_context', 'stability'
]);

const number = (value, digits = 0) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits:digits });
const singular = (value, singularLabel, pluralLabel) => `${number(value)} ${Number(value) === 1 ? singularLabel : pluralLabel}`;
const confidenceWeight = Object.freeze({ ALTA:1, high:1, MEDIA:.82, moderate:.82, MÉDIA:.82, BAIXA:.62, low:.62, INSUFICIENTE:.35, none:.25 });
const confidenceLabel = (value) => ({ high:'ALTA', moderate:'MÉDIA', low:'BAIXA', none:'INSUFICIENTE' }[value] || String(value || 'MÉDIA').toUpperCase());

function evidenceText(fact) {
  const evidence = fact.evidence || {};
  if (fact.text) return String(fact.text);
  if (fact.kind === 'sale_validated' && Number.isFinite(Number(evidence.sales))) {
    const suffix = Number.isFinite(Number(evidence.ivv)) ? ` IVV de ${number(evidence.ivv, 2)} un./mês.` : '';
    return `${fact.enterprise} registrou ${singular(evidence.sales, 'venda validada', 'vendas validadas')}.${suffix}`;
  }
  if (fact.kind === 'offer_update' && (Number(evidence.added) || Number(evidence.returned))) return `${fact.enterprise} alterou a composição da oferta: ${number(evidence.added || 0)} unidade(s) entraram e ${number(evidence.returned || 0)} retornaram à disponibilidade.`;
  if (fact.kind === 'price_update' && Number.isFinite(Number(evidence.changePercent))) return `${fact.enterprise} apresentou variação média de preço de ${number(evidence.changePercent * 100, 2)}% nas unidades comparáveis.`;
  return safeCopy(fact);
}

function safeCopy(fact) {
  switch (fact.kind) {
    case 'sale_validated':
      return `${fact.enterprise} registrou ${singular(fact.sales, 'venda validada', 'vendas validadas')} na atualização mais recente.`;
    case 'launch':
      return `${fact.enterprise} integra o recorte como lançamento recente.`;
    case 'performance_context':
      return 'O recorte atual possui base comparável para acompanhar a velocidade de vendas.';
    case 'price_update':
      return `${fact.enterprise} atualizou preços em unidades comparáveis.`;
    case 'commercial_update':
      return `${fact.enterprise} atualizou condições comerciais na tabela mais recente.`;
    case 'offer_update':
      return `${fact.enterprise} atualizou a composição da oferta na tabela mais recente.`;
    case 'market_pressure':
      return fact.text || 'Os indicadores de demanda e oferta foram atualizados para o recorte selecionado.';
    case 'monitoring_context':
      return 'O monitoramento incorpora as fotografias comerciais mais recentes disponíveis.';
    case 'stability':
      return 'As tabelas recentes mantêm o portfólio em acompanhamento, sem uma atualização editorial prioritária no recorte.';
    default:
      return null;
  }
}

function normalizeFact(fact = {}) {
  const baseScore = EDITORIAL_WEIGHTS[fact.kind] ?? 0;
  const explicitScore = Number(fact.score ?? baseScore);
  const confidence = confidenceLabel(fact.confidence || fact.evidence?.confidence);
  const recency = Number.isFinite(Number(fact.recency)) ? Math.max(0, Math.min(1, Number(fact.recency))) : 1;
  const strategicWeight = Number.isFinite(Number(fact.strategicWeight)) ? Number(fact.strategicWeight) : 1;
  const score = Math.max(0, Math.min(100, Math.round(explicitScore * recency * (confidenceWeight[confidence] || 1) * strategicWeight)));
  const visibility = fact.visibility || 'public_safe';
  const material = fact.material !== false && fact.materiality !== 'immaterial' && score >= (Number(fact.minScore) || 0);
  const publishable = visibility === EDITORIAL_POLICY.audience && PUBLIC_SAFE_KINDS.has(fact.kind) && material;
  return {
    id: fact.id || `${fact.kind || 'unknown'}:${fact.enterpriseId || 'portfolio'}`,
    family: fact.family || fact.kind || 'context',
    kind: fact.kind || 'unknown',
    score,
    rawScore: Math.max(0, Math.min(100, explicitScore)),
    confidence,
    material,
    visibility,
    publishable,
    enterpriseId: fact.enterpriseId || null,
    enterprise: fact.enterprise || null,
    text: publishable ? evidenceText(fact) : null,
    evidence: fact.evidence || {},
    reason: publishable ? null : (EDITORIAL_POLICY.prohibitedSignals.includes(fact.kind) ? 'sinal_restrito_para_publicacao' : !material ? 'abaixo_da_materialidade' : 'tipo_sem_copy_publica')
  };
}

function selectModules(facts = [], options = {}) {
  const maxModules = options.maxModules || EDITORIAL_POLICY.maxModules;
  const candidates = facts.map(normalizeFact).filter((fact) => fact.publishable && fact.text);
  const selected = [], families = new Set();
  for (const fact of candidates.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id, 'pt-BR'))) {
    if (selected.length >= maxModules) break;
    if (families.has(fact.family) && candidates.some((candidate) => !families.has(candidate.family) && candidate.score >= 70)) continue;
    families.add(fact.family);
    selected.push(fact);
  }
  return selected;
}

const LANGUAGE = Object.freeze({
  lead: ['O ritmo comercial ganhou força no período.', 'A velocidade de vendas se destacou na leitura mais recente.', 'O desempenho comercial concentra o principal movimento do recorte.'],
  slow: ['O ritmo comercial perdeu força no período.', 'A velocidade observada recuou na comparação recente.', 'A absorção apresenta menor tração no ciclo analisado.'],
  stable: ['O comportamento comercial permanece próximo da referência disponível.', 'A leitura atual indica estabilidade no recorte analisado.']
});
function pickLanguage(options = {}, values = []) {
  const index = Math.abs(Number(options.variant || 0)) % values.length;
  return values[index];
}
function periodPhrase(evidence = {}) {
  const months = Number(evidence.periodMonths || evidence.months || 0);
  return months > 0 ? ` em um intervalo de aproximadamente ${number(months, 0)} ${months === 1 ? 'mês' : 'meses'}` : '';
}
function buildSurfaceNarratives(modules = [], options = {}) {
  const sales = modules.filter((item) => item.kind === 'sale_validated' && item.enterprise);
  const ranked = [...sales].sort((a, b) => Number(b.evidence?.ivv || 0) - Number(a.evidence?.ivv || 0) || b.score - a.score);
  const top = ranked[0], second = ranked[1];
  const leader = top ? `${top.enterprise} é o principal destaque do portfólio${Number.isFinite(Number(top.evidence?.ivv)) ? `, com ${number(top.evidence.ivv, 2)} unidades/mês` : ''} e ${number(top.evidence?.sales)} ${Number(top.evidence?.sales) === 1 ? 'venda validada' : 'vendas validadas'}${periodPhrase(top.evidence)}.` : null;
  const following = ranked.slice(1, 3).map((item) => `${item.enterprise} aparece com ${Number.isFinite(Number(item.evidence?.ivv)) ? `${number(item.evidence.ivv, 2)} unidades/mês` : 'velocidade ainda sem base comparável'} e ${number(item.evidence?.sales)} ${Number(item.evidence?.sales) === 1 ? 'venda' : 'vendas'}${periodPhrase(item.evidence)}`).join('; ');
  const slowest = ranked.at(-1), contrast = slowest && slowest !== top ? `${slowest.enterprise} apresenta a menor velocidade da amostra, com ${Number.isFinite(Number(slowest.evidence?.ivv)) ? `${number(slowest.evidence.ivv, 2)} unidades/mês` : 'base insuficiente'}${periodPhrase(slowest.evidence)}` : '';
  const update = modules.find((item) => ['commercial_update', 'offer_update', 'price_update', 'launch', 'market_pressure'].includes(item.kind));
  const portfolio = update?.text || (top ? `${top.enterprise} lidera a velocidade comercial, com ${number(top.evidence?.ivv, 2)} unidades/mês e ${number(top.evidence?.sales)} vendas validadas.` : pickLanguage(options, LANGUAGE.stable));
  // A leitura consolidada é curta e comparativa. Detalhes ficam nos cards,
  // gráficos e na leitura individual do empreendimento.
  const general = leader ? `${pickLanguage(options, ['O destaque de velocidade está em', 'A maior tração do recorte aparece em', 'Na leitura do portfólio, o principal movimento está em'])} ${top.enterprise}, com ${Number.isFinite(Number(top.evidence?.ivv)) ? `${number(top.evidence.ivv, 2)} unidades/mês` : 'velocidade sem base comparável'} e ${number(top.evidence?.sales)} ${Number(top.evidence?.sales) === 1 ? 'venda validada' : 'vendas validadas'}${periodPhrase(top.evidence)}.${second ? ` ${second.enterprise} vem na sequência, com ${Number.isFinite(Number(second.evidence?.ivv)) ? `${number(second.evidence.ivv, 2)} unidades/mês` : 'base comparável insuficiente'}${periodPhrase(second.evidence)}.` : ''}${contrast ? ` ${contrast}; a comparação deve ser lida pela velocidade no intervalo observado, e não apenas pelo volume acumulado.` : ''}` : portfolio;
  const card = top ? `${top.enterprise}: ${pickLanguage(options, LANGUAGE.lead).replace(/\.$/, '')}.` : pickLanguage(options, LANGUAGE.stable);
  return { portfolio, enterprise_card:card, analytics_general:general, analytics_individual:modules.map((item) => item.text).filter(Boolean).slice(0, 4).join(' '), hot_lead:top?.text || modules[0]?.text || portfolio };
}

function buildEditorialReading(facts = [], options = {}) {
  const normalized = facts.map(normalizeFact);
  const modules = selectModules(facts, options);
  const fallback = options.emptyText || (options.hasPortfolio
    ? safeCopy({ kind:'stability' })
    : 'Ainda não há fotografia consolidada suficiente para uma leitura editorial do recorte.');
  const ordered = [...modules].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id, 'pt-BR'));
  const mainHotLead = ordered[0] ? { id:ordered[0].id, type:ordered[0].kind, score:ordered[0].score, family:ordered[0].family } : null;
  const confidence = ordered.length ? ordered.reduce((best, item) => (confidenceWeight[item.confidence] || 0) > (confidenceWeight[best] || 0) ? item.confidence : best, 'INSUFICIENTE') : 'INSUFICIENTE';
  const status = options.status || editorialStatus(ordered);
  const narratives = buildSurfaceNarratives(ordered, options);
  return {
    version: EDITORIAL_POLICY.version,
    audience: EDITORIAL_POLICY.audience,
    status,
    confidence: confidenceLabel(confidence),
    mainHotLead,
    events: ordered.map(({ id, family, kind, score, confidence, evidence, enterpriseId, enterprise }) => ({ id, family, type:kind, score, confidence:confidenceLabel(confidence), evidence, enterpriseId, enterprise })),
    modules: ordered.map(({ id, family, kind, score, confidence, text, evidence, enterpriseId, enterprise }) => ({ id, family, kind, score, confidence:confidenceLabel(confidence), text, evidence, enterpriseId, enterprise })),
    paragraphs: ordered.length ? ordered.map((module) => module.text) : [fallback],
    suppressed: normalized.filter((fact) => !fact.publishable).map(({ id, kind, reason, score, confidence }) => ({ id, kind, reason, score, confidence:confidenceLabel(confidence) })),
    weights: EDITORIAL_WEIGHTS,
    context: options.context || null,
    generatedAt: options.generatedAt || null,
    narratives
  };
}

function editorialStatus(modules = []) {
  const kinds = new Set(modules.map((item) => item.kind));
  if (kinds.has('market_pressure') || kinds.has('offer_update')) return 'ATENÇÃO';
  if (kinds.has('price_update') || kinds.has('launch')) return 'OPORTUNIDADE';
  if (kinds.has('sale_validated') || kinds.has('performance_context')) return 'FAVORÁVEL';
  return 'ESTÁVEL';
}

module.exports = { EDITORIAL_POLICY, EDITORIAL_WEIGHTS, buildEditorialReading, normalizeFact, selectModules, buildSurfaceNarratives };
