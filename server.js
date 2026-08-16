const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nexo-radar.json');
const PDF_DIRS = ['entrada', 'processando', 'cadastrados', 'erro', 'excluidos'].map((name) => path.join(ROOT, 'pdf', name));
// A aplicação local é acessada pelo endereço padrão do usuário.
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await Promise.all(PDF_DIRS.map((dir) => fs.mkdir(dir, { recursive: true })));
  try { await fs.access(DATA_FILE); } catch (_) {
    await writeData({ version: 1, sequences: { empreendimento: 0, tabela: 0, unidade: 0 }, empreendimentos: [], dicionario: [], logs: [] });
  }
}

async function readData() { return normalizeDataModel(JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))); }
async function writeData(data) { await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8'); }
function now() { return new Date().toISOString(); }
function nextId(data, entity, prefix) { data.sequences[entity] = (data.sequences[entity] || 0) + 1; return `${prefix}-${String(data.sequences[entity]).padStart(6, '0')}`; }
function canonicalTableType(value) {
  const input = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/VISTA|\bAV\b/.test(input)) return 'A_VISTA';
  if (/CAIXA|\bCEF\b/.test(input)) return 'FINANCIAMENTO_CEF';
  if (/BANCAR|FINANCIAMENTO BANC/.test(input)) return 'FINANCIAMENTO_BANCARIO';
  if (/DIRETO|CONSTRUTORA/.test(input)) return 'DIRETO_CONSTRUTORA';
  return 'PADRAO';
}
const TABLE_TYPE_LABELS = { PADRAO: 'Padrão / não informado', A_VISTA: 'À vista', FINANCIAMENTO_CEF: 'Financiamento CEF / Caixa', DIRETO_CONSTRUTORA: 'Financiamento direto com construtora', FINANCIAMENTO_BANCARIO: 'Financiamento bancário', OUTRO: 'Outro' };
const UNIT_STATUSES = ['Disponível', 'Vendida', 'Bloqueada', 'Reservada', 'Indisponível', 'Retirada', 'Não identificado'];
function normalizeDataModel(data) {
  data.version = Math.max(Number(data.version || 1), 2); data.dicionario = data.dicionario || []; data.sequences = data.sequences || {}; data.empreendimentos = data.empreendimentos || [];
  for (const empreendimento of data.empreendimentos) {
    empreendimento.unidades = empreendimento.unidades || []; empreendimento.tabelasExcluidas = empreendimento.tabelasExcluidas || []; empreendimento.tabelaPadraoTipo = empreendimento.tabelaPadraoTipo || null;
    for (const table of empreendimento.tabelas || []) {
      table.tipoTabela = table.tipoTabela || canonicalTableType(table.name); table.tipoTabelaLabel = table.tipoTabelaLabel || TABLE_TYPE_LABELS[table.tipoTabela] || 'Outro';
      table.manualReviewRequired = table.manualReviewRequired ?? (!(table.unidades || []).length && !String(table.extracao?.texto || '').replace(/\f/g, '').trim());
      for (const unit of table.unidades || []) {
        if (unit.valorAvaliacaoExtraido != null) unit.valorAvaliacaoExtraido = parseMoney(unit.valorAvaliacaoExtraido);
      }
      table.normalizacao = table.normalizacao || { formato: 'legado', campos: [] }; table.classificacoesRemocao = table.classificacoesRemocao || {};
      table.origem = table.origem || { tipo: table.documento ? 'pdf' : 'manual', label: table.documento ? 'PDF importado' : 'Cadastro manual' };
      table.confiancaLeitura = table.confiancaLeitura || { percentual: table.manualReviewRequired ? 0 : 95, classificacao: table.manualReviewRequired ? 'baixa' : 'alta', metodo: table.manualReviewRequired ? 'pdf_imagem_sem_ocr' : 'texto_embutido' };
      table.alertas = table.alertas || [];
    }
  }
  for (const empreendimento of data.empreendimentos) for (const table of empreendimento.tabelas || []) table.alertas = reviewAlerts(empreendimento, table);
  return data;
}
function sanitize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 96) || 'sem_nome'; }
function log(data, event, detail = {}) { data.logs.unshift({ id: crypto.randomUUID(), event, at: now(), ...detail }); data.logs = data.logs.slice(0, 500); }
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
function parseMoney(input) { const normalized = String(input || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'); const value = Number(normalized); return Number.isFinite(value) ? value : null; }
function buildUnitKey(empId, quadra, unidade) { return `${empId}:${sanitize(quadra || 'SEM_QUADRA')}:${sanitize(unidade || 'SEM_UNIDADE')}`; }
function extractZuhausUnits(text, empreendimentoId) {
  const units = []; const seen = new Set(); let bloco = null;
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
    units.push({ id: crypto.randomUUID(), chave: key, quadra: bloco, unidade, valorExtraido: valorTotal, valorInterpretado: valorTotal, valorValidado: null, areaPrivativa: parseMoney(row[3]), vagas: parseMoney(row[2]), situacaoExtraida: 'Disponível', condicoes: { sinal: { percentual: 15, valor: sinal }, parcelas: { quantidade: 100, percentual: 50, valor: parcelas100x }, intercaladas: { quantidade: 10, percentual: 20, valor: intercaladas10x }, chave: { percentual: 15, valor: chave } }, linhaOriginal: rawLine, status: 'extracted' });
  }
  return units;
}
function extractUnits(text, empreendimentoId) {
  const zuhaus = extractZuhausUnits(text, empreendimentoId); if (zuhaus.length) return zuhaus;
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
    const valueMatch = line.match(/R\$\s*([\d.]+,\d{2})/i); const valor = apartmentRow ? parseMoney(apartmentRow[7]) : (valueMatch ? parseMoney(valueMatch[1]) : null);
    const key = buildUnitKey(empreendimentoId, quadra, unidade); if (seen.has(key)) continue; seen.add(key);
    units.push({ id: crypto.randomUUID(), chave: key, quadra, unidade, valorExtraido: valor, valorInterpretado: valor, valorValidado: null, areaPrivativa: apartmentRow ? parseMoney(apartmentRow[4]) : null, descricaoExtraida: apartmentRow?.[5] || null, situacaoExtraida: apartmentRow?.[6] || 'Disponível', valorAvaliacaoExtraido: apartmentRow?.[8] ? parseMoney(apartmentRow[8]) : null, condicoes: {}, linhaOriginal: rawLine, status: valor === null ? 'pending_validation' : 'extracted' });
  }
  return units;
}
async function extractPdf(filePath, empreendimentoId) {
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-'], { maxBuffer: 12 * 1024 * 1024, windowsHide: true });
    const text = stdout || ''; const units = extractUnits(text, empreendimentoId); const imageOnly = !text.replace(/\f/g, '').trim(); const isZuhausPattern = /Parcelas\s+100X/i.test(text) && /Intercaladas\s+10X/i.test(text);
    const commercialRules = isZuhausPattern ? 'Sinal: 15%. Parcelas: 100x (50%). Intercaladas: 10x (20%). Chave: 15%. Reajuste: INCC mensal durante a construção e IGP-M + 1% após a entrega.' : '';
    const warnings = units.length ? [] : [imageOnly ? 'O PDF é composto por imagens. Nenhuma unidade será inferida automaticamente; use a versão anterior como base e revise os destaques antes de confirmar.' : 'Nenhuma unidade foi reconhecida automaticamente. Revise ou inclua as unidades na validação.'];
    return { text, units, commercialRules, warnings, manualReviewRequired: imageOnly, imageOnly, confidence: readingConfidence({ text, units, imageOnly }) };
  } catch (error) { return { text: '', units: [], warnings: [`Não foi possível extrair o PDF: ${error.message}`], error: error.message, imageOnly: false, confidence: { percentual: 0, classificacao: 'baixa', metodo: 'falha_de_extracao' } }; }
}
function emptyComparison() { return { previousTableId: null, novas: [], removidas: [], retornadas: [], alteracoesValor: [], alteracoesComerciais: [], automaticoSuprimido: true }; }
function buildNormalization(text, extraction) {
  const compact = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); const fields = [];
  const add = (source, target, confidence = 'alta') => fields.push({ origem: source, campoPadrao: target, confianca: confidence });
  if (/VALOR TOTAL/.test(compact)) add('Valor Total', 'VALOR_UNIDADE');
  if (/AREA UTIL/.test(compact)) add('Área Útil', 'AREA_PRIVATIVA');
  if (/VAGAS/.test(compact)) add('Vagas', 'VAGAS');
  if (/SINAL/.test(compact)) add('Sinal 15%', 'ENTRADA');
  if (/PARCELAS\s+100X/.test(compact)) add('Parcelas 100x 50%', 'PARCELAS_MENSAIS');
  if (/INTERCALADAS\s+10X/.test(compact)) add('Intercaladas 10x 20%', 'INTERCALADAS');
  if (/CHAVE/.test(compact)) add('Chave 15%', 'PARCELA_CHAVE');
  if (/VALOR DO IMOVEL/.test(compact)) add('Valor do imóvel', 'VALOR_UNIDADE');
  if (/VALOR AVALIACAO/.test(compact)) add('Valor avaliação', 'VALOR_AVALIACAO');
  return { formato: extraction.commercialRules ? 'tabela_financeira_por_unidade' : 'tabela_comercial_por_unidade', campos: fields, termosDesconhecidos: [] };
}
function learnMappings(data, normalization) {
  for (const field of normalization.campos || []) {
    const known = data.dicionario.some((entry) => entry.origemNormalizada === sanitize(field.origem).toUpperCase() && entry.campoPadrao === field.campoPadrao);
    if (!known) data.dicionario.push({ id: crypto.randomUUID(), origem: field.origem, origemNormalizada: sanitize(field.origem).toUpperCase(), campoPadrao: field.campoPadrao, confianca: field.confianca, origemAprendizado: 'extracao_validada', createdAt: now() });
  }
}
function syncPhysicalUnits(empreendimento, table) {
  const catalog = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit]));
  for (const unit of table.unidades || []) {
    const existing = catalog.get(unit.chave); const situacaoComercial = normalizeUnitStatus(unit.situacaoExtraida); const historicoSituacao = [...(existing?.historicoSituacao || [])]; const last = historicoSituacao.at(-1);
    if (!last || last.situacao !== situacaoComercial || last.tabelaId !== table.id) historicoSituacao.push({ tabelaId: table.id, validade: table.validityDate, situacao: situacaoComercial, origem: unit.origemLeitura || 'tabela_confirmada', confirmadoEm: now() });
    const physical = { chave: unit.chave, bloco: unit.quadra || '', unidade: unit.unidade || '', areaPrivativa: unit.areaPrivativa ?? null, vagas: unit.vagas ?? null, situacaoComercial, situacaoExtraida: situacaoComercial, tabelaStatusAtualId: table.id, historicoSituacao, createdFromTableId: existing?.createdFromTableId || table.id, updatedAt: now() };
    catalog.set(unit.chave, { ...existing, ...physical });
  }
  empreendimento.unidades = [...catalog.values()];
}
function projectedPhysicalUnits(empreendimento) {
  const catalog = new Map((empreendimento.unidades || []).map((unit) => [unit.chave, unit])); const latest = sortTables(empreendimento.tabelas || []).at(-1);
  for (const unit of latest?.unidades || []) { const current = catalog.get(unit.chave) || {}; const situacaoComercial = normalizeUnitStatus(unit.situacaoExtraida); catalog.set(unit.chave, { ...current, chave: unit.chave, bloco: unit.quadra || current.bloco || '', unidade: unit.unidade || current.unidade || '', situacaoComercial, situacaoExtraida: situacaoComercial, tabelaStatusAtualId: latest.id }); }
  return [...catalog.values()];
}
function compareWithPrevious(empreendimento, currentUnits, tableType = null) {
  const currentType = tableType;
  const previous = [...(empreendimento.tabelas || [])].filter((table) => (table.status === 'registered' || table.status === 'pending_validation') && (!currentType || table.tipoTabela === currentType)).sort((a, b) => b.validityDate.localeCompare(a.validityDate))[0];
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
  if (/^RESERVAD[AO]?$/.test(normalized)) return 'Reservada';
  if (/^INDISPONIVEL$/.test(normalized)) return 'Indisponível';
  if (/^RETIRAD[AO]?$/.test(normalized)) return 'Retirada';
  return 'Disponível';
}
function tableOriginLabel(table) { return table?.origem?.label || (table?.documento ? 'PDF importado' : 'Cadastro manual'); }
function readingConfidence(extraction) {
  const imageOnly = Boolean(extraction?.imageOnly); const units = extraction?.units?.length || 0; const hasText = Boolean(String(extraction?.text || '').replace(/\f/g, '').trim());
  const percentual = imageOnly ? 0 : units ? 95 : hasText ? 60 : 0;
  return { percentual, classificacao: percentual >= 90 ? 'alta' : percentual >= 70 ? 'media' : 'baixa', metodo: imageOnly ? 'pdf_imagem_sem_ocr' : 'texto_embutido' };
}
function reviewAlerts(empreendimento, table, units = table.unidades || []) {
  const alerts = []; const keys = new Map();
  for (const unit of units) {
    const key = unit.chave || buildUnitKey(empreendimento.id, unit.quadra, unit.unidade); if (!keys.has(key)) keys.set(key, []); keys.get(key).push(unit);
  }
  for (const [key, duplicates] of keys) if (duplicates.length > 1) alerts.push({ id: `duplicada:${key}`, tipo: 'UNIDADE_DUPLICADA', nivel: 'critico', chave: key, mensagem: `A unidade ${key.split(':').slice(-2).join(' · ')} está duplicada.` });
  const previous = previousRegisteredTable(empreendimento, table); const prior = new Map((previous?.unidades || []).map((unit) => [unit.chave, unit]));
  for (const unit of units) {
    const current = unitValue(unit); const previousUnit = prior.get(unit.chave); const priorValue = unitValue(previousUnit);
    if (current !== null && priorValue !== null && current < priorValue) alerts.push({ id: `preco:${unit.chave}`, tipo: 'REDUCAO_PRECO', nivel: 'critico', chave: unit.chave, anterior: priorValue, atual: current, variacao: (current - priorValue) / priorValue, mensagem: `Redução de preço detectada em ${unit.quadra || 'Sem bloco'} · ${unit.unidade || 'Sem unidade'}.` });
    if (unit.origemLeitura === 'ausente_na_tabela_atual') alerts.push({ id: `ausente:${unit.chave}`, tipo: 'UNIDADE_AUSENTE_TRATADA_COMO_VENDIDA', nivel: 'critico', chave: unit.chave, mensagem: `${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'} não foi encontrada no PDF atual e foi incluída como Vendida. Confirme ou ajuste a situação.` });
    if (unit.origemLeitura === 'nova_na_tabela_atual' && normalizeUnitStatus(unit.situacaoExtraida) === 'Disponível') alerts.push({ id: `nova:${unit.chave}`, tipo: 'NOVA_UNIDADE_DISPONIVEL', nivel: 'critico', chave: unit.chave, mensagem: `${unit.quadra || 'Bloco'} · ${unit.unidade || 'unidade'} é nova nesta tabela e foi incluída como Disponível. Confirme ou ajuste a situação.` });
  }
  if (table.confiancaLeitura?.classificacao === 'baixa') alerts.push({ id: 'ocr:baixa', tipo: 'CONFIANCA_BAIXA', nivel: 'atencao', mensagem: 'Leitura automática com baixa confiança. Revise os campos destacados antes de concluir.' });
  return alerts;
}
function rebuildTableDerived(empreendimento, table) {
  table.unidades = (table.unidades || []).map((unit) => ({ ...unit, chave: buildUnitKey(empreendimento.id, unit.quadra, unit.unidade), situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida) }));
  const previous = previousRegisteredTable(empreendimento, table); const priorKeys = new Set((previous?.unidades || []).map((unit) => unit.chave));
  if (previous) table.unidades = table.unidades.map((unit) => !priorKeys.has(unit.chave) && unit.origemLeitura !== 'ausente_na_tabela_atual' ? { ...unit, origemLeitura: 'nova_na_tabela_atual', confirmadoPeloUsuario: false } : unit);
  if (table.status === 'pending_validation') includePreviousAbsencesAsSold(empreendimento, table);
  table.comparacao = compareWithPrevious({ ...empreendimento, tabelas: (empreendimento.tabelas || []).filter((item) => item.id !== table.id) }, table.unidades, table.tipoTabela);
  table.comparacao.ausentesTratadas = table.unidades.filter((unit) => unit.origemLeitura === 'ausente_na_tabela_atual').map((unit) => unit.chave);
  table.comparacao.removidas = table.comparacao.ausentesTratadas;
  table.alertas = reviewAlerts(empreendimento, table);
  return table;
}
function includePreviousAbsencesAsSold(empreendimento, table) {
  const previous = previousRegisteredTable(empreendimento, table); if (!previous?.unidades?.length) return 0;
  const present = new Set((table.unidades || []).map((unit) => unit.chave));
  const missing = previous.unidades.filter((unit) => !present.has(unit.chave));
  for (const unit of missing) table.unidades.push({ ...unit, id: crypto.randomUUID(), chave: buildUnitKey(empreendimento.id, unit.quadra, unit.unidade), situacaoExtraida: 'Vendida', status: 'inferred_sold_pending_confirmation', origemLeitura: 'ausente_na_tabela_atual', tabelaOrigemId: previous.id, confirmadoPeloUsuario: false });
  return missing.length;
}
function copyForReview(empreendimento, source) {
  return (source.unidades || []).map((unit) => ({ ...unit, id: crypto.randomUUID(), chave: buildUnitKey(empreendimento.id, unit.quadra, unit.unidade), valorExtraido: unit.valorExtraido ?? unitValue(unit), valorInterpretado: unit.valorInterpretado ?? unitValue(unit), valorValidado: unit.valorValidado ?? unitValue(unit), situacaoExtraida: normalizeUnitStatus(unit.situacaoExtraida), status: 'referenced_previous' }));
}
function tableDependencies(empreendimento, tableId) {
  return (empreendimento.tabelas || []).filter((table) => table.id !== tableId && (table.manualReviewBaseTableId === tableId || table.origem?.tabelaBaseId === tableId || table.comparacao?.previousTableId === tableId)).map((table) => ({ id: table.id, name: table.name, validityDate: table.validityDate, relation: table.manualReviewBaseTableId === tableId || table.origem?.tabelaBaseId === tableId ? 'base_de_revisao' : 'comparacao_historica' }));
}
function nullableNumber(value) { if (value === '' || value == null) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function normalizeReviewedUnits(empreendimento, existingUnits, submittedUnits) {
  if (!Array.isArray(submittedUnits) || !submittedUnits.length) throw new Error('Informe ao menos uma unidade para revisão.');
  const previous = new Map((existingUnits || []).map((unit) => [unit.id, unit]));
  return submittedUnits.map((submitted) => {
    const prior = previous.get(submitted.id) || {};
    const unit = { ...prior, ...submitted, id: submitted.id || crypto.randomUUID() };
    unit.quadra = String(unit.quadra || '').trim(); unit.unidade = String(unit.unidade || '').trim();
    if (!unit.quadra || !unit.unidade) throw new Error('Bloco e unidade são obrigatórios em todas as linhas.');
    for (const field of ['areaPrivativa', 'vagas', 'valorExtraido', 'valorInterpretado', 'valorValidado', 'valorAvaliacaoExtraido']) unit[field] = nullableNumber(unit[field]);
    unit.valorInterpretado = unit.valorInterpretado ?? unit.valorValidado ?? unit.valorExtraido;
    unit.valorValidado = unit.valorValidado ?? unit.valorInterpretado;
    unit.situacaoExtraida = normalizeUnitStatus(unit.situacaoExtraida || prior.situacaoExtraida || 'Disponível');
    unit.chave = buildUnitKey(empreendimento.id, unit.quadra, unit.unidade); unit.status = 'validated';
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
const REMOVAL_STATUSES = ['PENDENTE', 'VENDIDA', 'INDISPONIVEL', 'RESERVADA', 'RETIRADA_COMERCIALIZACAO', 'OUTRA'];
function previousRegisteredTable(empreendimento, table) {
  const tables = sortTables(empreendimento.tabelas || []).filter((item) => !table?.tipoTabela || item.tipoTabela === table.tipoTabela); const index = tables.findIndex((item) => item.id === table?.id);
  if (index > 0) return tables[index - 1];
  return tables.filter((item) => item.id !== table?.id && (!table?.validityDate || item.validityDate <= table.validityDate)).at(-1) || null;
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
function buildRadar(empreendimento) {
  // Indicadores decisórios nunca usam uma versão ainda em validação.
  // O empreendimento pode aparecer no mapa desde já, mas VGV, IVV e vendas
  // só passam a refletir uma tabela após a confirmação explícita.
  const allTables = [...(empreendimento.tabelas || [])].sort((a, b) => a.validityDate.localeCompare(b.validityDate) || a.createdAt.localeCompare(b.createdAt)); const registeredTables = allTables.filter((table) => table.status === 'registered'); const referenceTables = empreendimento.tabelaPadraoTipo ? registeredTables.filter((table) => table.tipoTabela === empreendimento.tabelaPadraoTipo) : []; const reference = referenceTables.at(-1) || null; const latest = generalInventoryTable(empreendimento, reference) || registeredTables.at(-1) || null; const tables = reference ? referenceTables : (latest ? registeredTables.filter((table) => table.tipoTabela === latest.tipoTabela) : []); const previous = tables.at(-2) || null;
  const current = tableMetrics(latest); const prior = tableMetrics(previous); const removedDetails = removalDetails(previous, latest, latest?.classificacoesRemocao || {}); const removals = removalSummary(removedDetails); const salesByStatus = soldStatusTransitions(previous, latest); const rawComparison = comparisonMetrics(previous, latest); const returned = latest?.comparacao?.retornadas?.length || 0; const comparison = { ...rawComparison, added: Math.max(0, rawComparison.added - returned), returned, removedPending: removals.pendentes, salesConfirmed: removals.vendidas + salesByStatus.length, salesByStatus: salesByStatus.map((unit) => unit.chave), removals };
  const keys = new Set([...(latest?.unidades || []), ...(previous?.unidades || [])].map((unit) => unit.quadra || 'Sem bloco'));
  const byBlock = [...keys].sort().map((block) => {
    const latestTable = { unidades: (latest?.unidades || []).filter((unit) => (unit.quadra || 'Sem bloco') === block) }; const previousTable = { unidades: (previous?.unidades || []).filter((unit) => (unit.quadra || 'Sem bloco') === block) };
    const currentBlock = tableMetrics(latestTable); const priorBlock = tableMetrics(previousTable); const blockDetails = removedDetails.filter((item) => item.bloco === block); const blockRemoval = removalSummary(blockDetails); const blockSales = soldStatusTransitions(previousTable, latestTable); const blockComparison = { ...comparisonMetrics(previousTable, latestTable), removedPending: blockRemoval.pendentes, salesConfirmed: blockRemoval.vendidas + blockSales.length, salesByStatus: blockSales.map((unit) => unit.chave), removals: blockRemoval };
    return { block, current: currentBlock, previous: priorBlock, comparison: blockComparison, vgvDelta: currentBlock.vgv - priorBlock.vgv, vgvDeltaPercent: priorBlock.vgv ? (currentBlock.vgv - priorBlock.vgv) / priorBlock.vgv : null };
  });
  const timeline = tables.map((table, index) => ({ id: table.id, name: table.name, validityDate: table.validityDate, ...tableMetrics(table), comparison: index ? comparisonMetrics(tables[index - 1], table) : null }));
  return {
    id: empreendimento.id, nome: empreendimento.nome, construtora: empreendimento.construtora || '', endereco: empreendimento.endereco, numero: empreendimento.numero, bairro: empreendimento.bairro, cidade: empreendimento.cidade, estado: empreendimento.estado, cep: empreendimento.cep,
    latitude: empreendimento.latitude ?? null, longitude: empreendimento.longitude ?? null, geocodeStatus: empreendimento.geocodeStatus || null, geocodeLabel: empreendimento.geocodeLabel || null,
    tableCount: allTables.length, registeredTableCount: registeredTables.length, pendingTableCount: allTables.filter((table) => table.status === 'pending_validation').length, latestTable: latest ? { id: latest.id, name: latest.name, validityDate: latest.validityDate, tipoTabela: latest.tipoTabela, tipoTabelaLabel: latest.tipoTabelaLabel } : null, previousTable: previous ? { id: previous.id, name: previous.name, validityDate: previous.validityDate } : null,
    current, previous: prior, comparison, removedDetails, vgvDelta: current.vgv - prior.vgv, vgvDeltaPercent: prior.vgv ? (current.vgv - prior.vgv) / prior.vgv : null, byBlock, timeline, tiposTabela: [...new Map(registeredTables.map((table) => [table.tipoTabela, table.tipoTabelaLabel || TABLE_TYPE_LABELS[table.tipoTabela] || 'Outro'])).entries()].map(([id, label]) => ({ id, label }))
  };
}
function publicEmpreendimento(empreendimento) { const tables = empreendimento.tabelas || []; const latest = [...tables].sort((a, b) => b.validityDate.localeCompare(a.validityDate))[0]; return { ...empreendimento, unidades: projectedPhysicalUnits(empreendimento), tableCount: tables.length, latestTable: latest ? { id: latest.id, name: latest.name, validityDate: latest.validityDate, status: latest.status } : null }; }
async function geocode(empreendimento) {
  const cep = String(empreendimento.cep || '').replace(/\D/g, '');
  // CEP é a âncora territorial do empreendimento. O logradouro só refina o
  // ponto dentro da área postal; ele não substitui o CEP cadastrado.
  const query = [cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '', empreendimento.endereco, empreendimento.numero, empreendimento.bairro, empreendimento.cidade, empreendimento.estado, 'Brasil'].filter(Boolean).join(', ');
  if (!query) throw new Error('Informe ao menos o CEP ou o endereço para localizar o empreendimento.');
  try {
    const photon = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`);
    if (photon.ok) {
      const payload = await photon.json(); const feature = payload.features?.[0]; const coordinates = feature?.geometry?.coordinates;
      if (Array.isArray(coordinates) && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))) {
        const label = [feature.properties?.name, feature.properties?.district || empreendimento.bairro, feature.properties?.city || empreendimento.cidade, cep ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ''].filter(Boolean).join(', ');
        return { latitude: Number(coordinates[1]), longitude: Number(coordinates[0]), label, source: cep ? 'cep' : 'automatic' };
      }
    }
  } catch (_) { /* tenta a fonte de contingência abaixo */ }
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Nexo-Radar-Imobiliario/1.0 (local)' } });
  if (!response.ok) throw new Error('Não foi possível consultar o serviço de geocodificação.');
  const results = await response.json(); if (!results[0]) throw new Error('CEP/endereço não localizado. Informe latitude e longitude manualmente.');
  return { latitude: Number(results[0].lat), longitude: Number(results[0].lon), label: `${results[0].display_name}${cep ? ` · CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ''}`, source: cep ? 'cep' : 'automatic' };
}

async function api(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); const method = req.method;
  if (method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });
  if (method === 'GET' && pathname === '/api/radar') { const data = await readData(); return send(res, 200, data.empreendimentos.map(buildRadar)); }
  if (method === 'GET' && pathname === '/api/empreendimentos') { const data = await readData(); return send(res, 200, data.empreendimentos.map(publicEmpreendimento)); }
  if (method === 'POST' && pathname === '/api/empreendimentos') {
    const payload = parseJson(await body(req)); if (!payload.nome?.trim()) return send(res, 422, { error: 'Informe o nome do empreendimento.' });
    const data = await readData(); const id = nextId(data, 'empreendimento', 'EMP'); const empreendimento = { id, nome: payload.nome.trim(), construtora: payload.construtora || '', endereco: payload.endereco || '', numero: payload.numero || '', complemento: payload.complemento || '', bairro: payload.bairro || '', cidade: payload.cidade || '', estado: payload.estado || '', cep: payload.cep || '', latitude: Number.isFinite(Number(payload.latitude)) ? Number(payload.latitude) : null, longitude: Number.isFinite(Number(payload.longitude)) ? Number(payload.longitude) : null, geocodeStatus: Number.isFinite(Number(payload.latitude)) && Number.isFinite(Number(payload.longitude)) ? 'manual' : null, tipo: payload.tipo || 'Outro', padrao: payload.padrao || 'Outro', formasPagamento: payload.formasPagamento || '', caracteristicasComerciais: payload.caracteristicasComerciais || '', observacoes: payload.observacoes || '', informacoesEstruturais: payload.informacoesEstruturais || '', status: 'active', createdAt: now(), updatedAt: now(), tabelas: [] }; data.empreendimentos.push(empreendimento); log(data, 'empreendimento_cadastrado', { empreendimentoId: id }); await writeData(data); return send(res, 201, publicEmpreendimento(empreendimento));
  }
  const id = parts[2]; if (!id) return send(res, 404, { error: 'Rota não encontrada.' }); const data = await readData(); const empreendimento = data.empreendimentos.find((item) => item.id === id); if (!empreendimento) return send(res, 404, { error: 'Empreendimento não encontrado.' });
  if (method === 'GET' && parts[3] === 'radar') return send(res, 200, buildRadar(empreendimento));
  if (method === 'POST' && parts[3] === 'geocodificar') { const result = await geocode(empreendimento); empreendimento.latitude = result.latitude; empreendimento.longitude = result.longitude; empreendimento.geocodeStatus = result.source || 'automatic'; empreendimento.geocodeLabel = result.label; empreendimento.updatedAt = now(); log(data, 'empreendimento_geocodificado', { empreendimentoId: id, latitude: result.latitude, longitude: result.longitude, source: empreendimento.geocodeStatus }); await writeData(data); return send(res, 200, { latitude: result.latitude, longitude: result.longitude, label: result.label, source: empreendimento.geocodeStatus }); }
  if (method === 'GET' && parts.length === 3) return send(res, 200, publicEmpreendimento(empreendimento));
  if (method === 'PUT' && parts.length === 3) { const payload = parseJson(await body(req)); const latitude = Number(payload.latitude); const longitude = Number(payload.longitude); const requestedGeocodeStatus = ['automatic', 'cep', 'manual'].includes(payload.geocodeStatus) ? payload.geocodeStatus : null; Object.assign(empreendimento, { ...payload, latitude: Number.isFinite(latitude) ? latitude : null, longitude: Number.isFinite(longitude) ? longitude : null, geocodeStatus: Number.isFinite(latitude) && Number.isFinite(longitude) ? (requestedGeocodeStatus || empreendimento.geocodeStatus || 'manual') : null, id: empreendimento.id, tabelas: empreendimento.tabelas, updatedAt: now() }); log(data, 'empreendimento_atualizado', { empreendimentoId: id }); await writeData(data); return send(res, 200, publicEmpreendimento(empreendimento)); }
  // Compatibilidade de leitura: evita que telas em cache peçam a coleção de
  // tabelas e recebam uma falsa mensagem de "Tabela não encontrada".
  if (method === 'GET' && parts[3] === 'tabelas' && parts.length === 4) return send(res, 200, empreendimento.tabelas || []);
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
    const tipoTabela = canonicalTableType(fields.tipoTabela || fields.nome); const normalizacao = buildNormalization(extracted.text, extracted); const table = { id: tableId, name: fields.nome.trim(), tipoTabela, tipoTabelaLabel: TABLE_TYPE_LABELS[tipoTabela] || 'Outro', validityDate: fields.dataValidade, status: 'pending_validation', createdAt: now(), processedAt: now(), documento: { originalName: file.name, storedName: pendingName, path: `pdf/processando/${pendingName}`, hash, mimeType: file.type || 'application/pdf' }, extracao: { texto: extracted.text, warnings: extracted.warnings, error: extracted.error || null }, normalizacao, unidades: extracted.units, manualReviewRequired: Boolean(extracted.manualReviewRequired), origem: { tipo: 'pdf', label: 'PDF importado' }, confiancaLeitura: extracted.confidence || readingConfidence(extracted), comparacao: emptyComparison(), alertas: [], regrasComerciais: fields.regrasComerciais || extracted.commercialRules || '', observacoes: fields.observacoes || '', auditoria: [] }; empreendimento.tabelas.push(table); rebuildTableDerived(empreendimento, table); empreendimento.updatedAt = now(); log(data, 'extracao_concluida', { empreendimentoId: id, tabelaId: tableId, unidades: table.unidades.length }); if (table.extracao.warnings.length) log(data, 'validacao_pendente', { empreendimentoId: id, tabelaId: tableId, avisos: table.extracao.warnings }); await writeData(data); return send(res, 201, table);
  }
  if (method === 'POST' && parts[3] === 'tabelas' && parts[4] === 'copiar' && parts.length === 5) {
    const payload = parseJson(await body(req)); const source = (empreendimento.tabelas || []).find((item) => item.id === payload.tabelaBaseId);
    if (!source) return send(res, 404, { error: 'A tabela-base não foi encontrada.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dataValidade || '')) return send(res, 422, { error: 'Informe a data de validade da nova versão.' });
    const tableId = nextId(data, 'tabela', 'TAB'); const tipoTabela = canonicalTableType(payload.tipoTabela || source.tipoTabela);
    const table = { id: tableId, name: String(payload.nome || `Cópia de ${source.name}`).trim(), tipoTabela, tipoTabelaLabel: TABLE_TYPE_LABELS[tipoTabela] || 'Outro', validityDate: payload.dataValidade, status: 'pending_validation', createdAt: now(), processedAt: now(), documento: null, extracao: { texto: '', warnings: [], error: null }, normalizacao: source.normalizacao || { formato: 'copia_manual', campos: [] }, unidades: copyForReview(empreendimento, source), manualReviewRequired: false, origem: { tipo: 'copia_manual', label: 'Cópia editável de tabela existente', tabelaBaseId: source.id }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'copia_manual' }, comparacao: emptyComparison(), alertas: [], regrasComerciais: source.regrasComerciais || '', observacoes: String(payload.observacoes || ''), auditoria: [{ at: now(), action: 'tabela_criada_por_copia', tabelaBaseId: source.id }] };
    empreendimento.tabelas.push(table); rebuildTableDerived(empreendimento, table); empreendimento.updatedAt = now(); log(data, 'tabela_criada_por_copia', { empreendimentoId: id, tabelaId: table.id, tabelaBaseId: source.id, unidades: table.unidades.length }); await writeData(data); return send(res, 201, table);
  }
  if (parts[3] !== 'tabelas' || !parts[4]) return send(res, 404, { error: 'Rota não encontrada.' });
  const tableId = parts[4]; const table = (empreendimento.tabelas || []).find((item) => item.id === tableId); if (!table) return send(res, 404, { error: 'Tabela não encontrada.' });
  if (method === 'POST' && parts[5] === 'definir-padrao') {
    if (table.status !== 'registered') return send(res, 409, { error: 'Confirme a tabela antes de defini-la como padrão do empreendimento.' });
    empreendimento.tabelaPadraoTipo = table.tipoTabela; empreendimento.tabelaPadraoTableId = table.id; empreendimento.updatedAt = now();
    log(data, 'tabela_padrao_definida', { empreendimentoId: id, tabelaId: table.id, tipoTabela: table.tipoTabela }); await writeData(data);
    return send(res, 200, { tabelaPadraoTipo: empreendimento.tabelaPadraoTipo, tabelaPadraoTableId: empreendimento.tabelaPadraoTableId });
  }
  if (method === 'POST' && parts[5] === 'reprocessar') {
    if (table.status !== 'pending_validation') return send(res, 409, { error: 'Apenas tabelas pendentes podem ser reprocessadas. Versões confirmadas preservam sua extração histórica.' });
    if (!table.documento?.path) return send(res, 409, { error: 'Esta versão foi criada manualmente e não possui PDF para reprocessar.' });
    const sourcePath = path.join(ROOT, table.documento.path); const extracted = await extractPdf(sourcePath, id);
    table.unidades = extracted.units; table.extracao = { texto: extracted.text, warnings: extracted.warnings, error: extracted.error || null }; table.normalizacao = buildNormalization(extracted.text, extracted); table.manualReviewRequired = Boolean(extracted.manualReviewRequired); table.confiancaLeitura = extracted.confidence || readingConfidence(extracted);
    table.regrasComerciais = table.regrasComerciais || extracted.commercialRules || ''; rebuildTableDerived(empreendimento, table); table.processedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'reprocessamento_de_pdf', unidadesReconhecidas: table.unidades.length }); empreendimento.updatedAt = now(); log(data, 'tabela_reprocessada', { empreendimentoId: id, tabelaId: table.id, unidades: table.unidades.length }); await writeData(data); return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'classificar-removidas') {
    const payload = parseJson(await body(req)); if (!Array.isArray(payload.classificacoes)) return send(res, 422, { error: 'Informe as classificações das unidades removidas.' });
    const previousTable = previousRegisteredTable(empreendimento, table); const pending = removalDetails(previousTable, table, table.classificacoesRemocao || {}); const validKeys = new Set(pending.map((item) => item.chave));
    const next = { ...(table.classificacoesRemocao || {}) };
    for (const item of payload.classificacoes) {
      if (!validKeys.has(item.chave)) return send(res, 422, { error: 'Uma unidade informada não pertence às saídas desta versão.' });
      if (!REMOVAL_STATUSES.includes(item.status)) return send(res, 422, { error: 'Classificação de saída inválida.' });
      if (item.status === 'PENDENTE') delete next[item.chave];
      else next[item.chave] = { status: item.status, observacao: String(item.observacao || '').slice(0, 1000), at: now() };
    }
    table.classificacoesRemocao = next; table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'classificacao_de_saida', quantidade: payload.classificacoes.length }); empreendimento.updatedAt = now();
    log(data, 'saidas_classificadas', { empreendimentoId: id, tabelaId: table.id, quantidade: payload.classificacoes.length }); await writeData(data);
    return send(res, 200, { removals: removalSummary(removalDetails(previousTable, table, next)) });
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
    table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'modalidade_atualizada', tipoTabela, tipoTabelaLabel: table.tipoTabelaLabel });
    empreendimento.updatedAt = now(); log(data, 'modalidade_de_tabela_atualizada', { empreendimentoId: id, tabelaId: table.id, tipoTabela }); await writeData(data);
    return send(res, 200, table);
  }
  if (method === 'POST' && parts[5] === 'rascunho') {
    if (table.status !== 'pending_validation') return send(res, 409, { error: 'Apenas tabelas em revisão podem ser salvas como rascunho.' });
    const payload = parseJson(await body(req));
    try { table.unidades = normalizeReviewedUnits(empreendimento, table.unidades, payload.unidades); } catch (error) { return send(res, 422, { error: error.message }); }
    table.regrasComerciais = payload.regrasComerciais ?? table.regrasComerciais; table.observacoes = payload.observacoes ?? table.observacoes; rebuildTableDerived(empreendimento, table); table.updatedAt = now(); table.auditoria = table.auditoria || []; table.auditoria.push({ at: now(), action: 'rascunho_salvo', unidades: table.unidades.length }); empreendimento.updatedAt = now(); log(data, 'rascunho_de_revisao_salvo', { empreendimentoId: id, tabelaId: table.id, unidades: table.unidades.length }); await writeData(data); return send(res, 200, table);
  }
  if (method === 'DELETE' && parts.length === 5) {
    const dependencies = tableDependencies(empreendimento, table.id); if (dependencies.length) return send(res, 409, { error: 'Esta tabela é referência de outras versões e não pode ser excluída antes das dependentes.', dependencies });
    const deletedAt = now(); const deleted = { ...table, deletedAt, deletedReason: 'exclusao_controlada' }; const sourcePath = table.documento?.path ? path.join(ROOT, table.documento.path) : null;
    if (sourcePath) { const archiveName = `${table.id}_${path.basename(sourcePath)}`; const archivePath = path.join(ROOT, 'pdf', 'excluidos', archiveName); try { await fs.rename(sourcePath, archivePath); deleted.documento = { ...table.documento, path: `pdf/excluidos/${archiveName}`, storedName: archiveName }; } catch (error) { if (error.code !== 'ENOENT') return send(res, 500, { error: 'A tabela não foi excluída porque o PDF não pôde ser arquivado.', detail: error.message }); } }
    empreendimento.tabelas = (empreendimento.tabelas || []).filter((item) => item.id !== table.id); empreendimento.tabelasExcluidas = empreendimento.tabelasExcluidas || []; empreendimento.tabelasExcluidas.unshift(deleted); empreendimento.updatedAt = now(); log(data, 'tabela_excluida_controladamente', { empreendimentoId: id, tabelaId: table.id, dependencias: 0 }); await writeData(data); return send(res, 200, { deletedId: table.id, archived: Boolean(sourcePath) });
  }
  if (method === 'POST' && parts[5] === 'validar') { if (table.status !== 'pending_validation') return send(res, 409, { error: 'Versões confirmadas são imutáveis. Crie uma cópia editável para registrar uma nova alteração.' }); const payload = parseJson(await body(req)); if (!Array.isArray(payload.unidades)) return send(res, 422, { error: 'Informe as unidades validadas.' }); try { table.unidades = normalizeReviewedUnits(empreendimento, table.unidades, payload.unidades); } catch (error) { return send(res, 422, { error: error.message }); } rebuildTableDerived(empreendimento, table); const criticalAlerts = (table.alertas || []).filter((alert) => alert.nivel === 'critico'); if (criticalAlerts.length && !payload.confirmarAlertasCriticos) return send(res, 409, { error: 'Existem alertas críticos pendentes. Confirme explicitamente os valores antes de concluir.', criticalAlerts, table });
    if (table.documento?.path) { const finalName = `${sanitize(empreendimento.nome)}_${table.validityDate}_${sanitize(table.name)}.pdf`; const sourcePath = path.join(ROOT, table.documento.path); const targetPath = path.join(ROOT, 'pdf', 'cadastrados', `${table.id}_${finalName}`);
      try { await fs.rename(sourcePath, targetPath); table.documento.storedName = path.basename(targetPath); table.documento.path = `pdf/cadastrados/${path.basename(targetPath)}`; } catch (error) { log(data, 'processamento_falhou', { empreendimentoId: id, tabelaId: table.id, motivo: `Não foi possível concluir o cadastro do PDF: ${error.message}` }); await writeData(data); return send(res, 500, { error: 'Os dados foram revisados, mas o PDF não pôde ser movido para cadastrados.', detail: error.message }); } }
    table.status = 'registered'; table.validatedAt = now(); table.regrasComerciais = payload.regrasComerciais ?? table.regrasComerciais; table.observacoes = payload.observacoes ?? table.observacoes; rebuildTableDerived(empreendimento, table); syncPhysicalUnits(empreendimento, table); learnMappings(data, table.normalizacao || { campos: [] }); empreendimento.updatedAt = now(); log(data, 'validacao_concluida', { empreendimentoId: id, tabelaId: table.id, unidades: table.unidades.length }); if (table.documento?.storedName) log(data, 'pdf_cadastrado', { empreendimentoId: id, tabelaId: table.id, arquivo: table.documento.storedName }); await writeData(data); return send(res, 200, table); }
  return send(res, 404, { error: 'Rota não encontrada.' });
}

async function serveStatic(req, res, pathname) { const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); const filePath = path.resolve(ROOT, requested); if (!filePath.startsWith(ROOT) || requested.includes('..')) { res.writeHead(403); return res.end('Acesso negado'); } try { const content = await fs.readFile(filePath); res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content); } catch (_) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Arquivo não encontrado.'); } }

ensureStorage().then(() => http.createServer(async (req, res) => { try { const url = new URL(req.url, `http://${req.headers.host}`); if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname); return await serveStatic(req, res, url.pathname); } catch (error) { console.error(error); return send(res, 500, { error: error.message || 'Erro interno.' }); } }).listen(PORT, () => console.log(`Nexo Radar disponível em http://localhost:${PORT}`)));
