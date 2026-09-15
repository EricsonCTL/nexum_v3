'use strict';
// Read-only contract check. Reuses the local parser without starting HTTP or persisting a job.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
let adapter;
function importer() {
  if (adapter) return adapter;
  const filename = path.join(root, 'server.js');
  const source = fs.readFileSync(filename, 'utf8');
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = Module._nodeModulePaths(root);
  isolated._compile(source + '\nmodule.exports.contractCheck = {prepareJsonImport, declaredPlans, jsonEnterpriseDraft};', filename);
  adapter = {...isolated.exports.contractCheck, sha256: crypto.createHash('sha256').update(source).digest('hex')};
  return adapter;
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => number(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const cents = value => Math.round(value * 100);
const sameMoney = (a, b) => number(a) && number(b) && Math.abs(cents(a) - cents(b)) <= 1;
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function readJson(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
const modalities = ['PADRAO','A_VISTA','FINANCIAMENTO_CEF','FINANCIAMENTO_BANCARIO','DIRETO_CONSTRUTORA','OUTRO'];
const natures = ['TABELA_COMERCIAL','TABELA_ZERO_ORIGINAL','TABELA_ZERO_SIMULADA'];
const operations = ['CADASTRAR_EMPREENDIMENTO_E_TABELA_BASE','ADICIONAR_TABELA_A_EMPREENDIMENTO_EXISTENTE','REVISAO_DE_IDENTIDADE'];

function validate(source, {references = []} = {}) {
  const issues = new Map();
  function issue(level, code, at, message) {
    const key = level + ':' + code;
    if (!issues.has(key)) issues.set(key, {nivel: level, codigo: code, ocorrencias: 0, exemplos: []});
    const entry = issues.get(key);
    entry.ocorrencias++;
    if (entry.exemplos.length < 4) entry.exemplos.push({campo: at, motivo: message});
  }
  const error = (code, at, message) => issue('ERRO', code, at, message);
  const warn = (code, at, message) => issue('REVISAO', code, at, message);
  const summary = {unidades: 0, chaves_importadas: 0, planos_declarados: 0, planos_lidos: 0, precos_positivos: 0, precos_simulados: 0, vgv: 0};
  let sha256 = null;
  function result() {
    const rows = [...issues.values()];
    const errors = rows.filter(row => row.nivel === 'ERRO');
    const warnings = rows.filter(row => row.nivel === 'REVISAO');
    return {contrato_compativel: errors.length === 0, revisao_necessaria: warnings.length > 0 || errors.length > 0 || source?.status_processamento === 'REVISAO', cadastro_executado: false, escopo: 'Contrato e importador em memória; não valida fontes, persistência ou inventário físico.', importador_sha256: sha256, resumo: summary, erros: errors, revisoes: warnings};
  }
  if (!object(source)) { error('RAIZ', '$', 'Esperado objeto JSON.'); return result(); }
  if (source.schema !== 'nexum-skill-json' || source.schema_version !== '11.0') error('SCHEMA', 'schema_version', 'Gerar contrato nexum-skill-json 11.0.');
  if (!operations.includes(source.operacao)) error('OPERACAO', 'operacao', 'Operação ausente ou inválida.');
  if (!['REVISAO','CONSOLIDADO'].includes(source.status_processamento)) error('STATUS_PROCESSAMENTO', 'status_processamento', 'Usar REVISAO ou CONSOLIDADO.');
  for (const alias of ['unidades','tabelaProcessada','tabela_comercial']) if (source[alias] !== undefined) error('RAIZ_CONCORRENTE', alias, 'Este caminho pode substituir tabela.unidades no leitor.');
  for (const key of ['fontes','cobertura_cadastral','auditoria','validacoes','pendencias']) {
    if (!Array.isArray(source[key]) || source[key].some(value => !object(value))) error('ARRAY_OBJETOS', key, 'Esperado array de objetos.');
  }
  for (const [i, item] of (Array.isArray(source.pendencias) ? source.pendencias : []).entries()) {
    if (!object(item) || !text(item.campo) || !text(item.observacao) || !text(item.status)) error('PENDENCIA', `pendencias[${i}]`, 'Informar campo, observacao e status.');
  }
  if (!source.fontes?.length) warn('FONTES', 'fontes', 'Sem fontes declaradas; nenhuma evidência externa foi verificada pelo script.');
  if (source.pendencias?.length) warn('PENDENCIAS_ABERTAS', 'pendencias', 'Revisar as pendências declaradas.');
  for (const [i, item] of (Array.isArray(source.validacoes) ? source.validacoes : []).entries()) {
    if (!object(item) || !text(item.regra) || !text(item.resultado) || !text(item.observacao)) error('VALIDACAO', `validacoes[${i}]`, 'Informar regra, resultado e observacao.');
  }
  const e = object(source.empreendimento) ? source.empreendimento : {};
  const t = object(source.tabela) ? source.tabela : {};
  const u = Array.isArray(t.unidades) ? t.unidades : [];
  const zero = ['TABELA_ZERO_SIMULADA','TABELA_ZERO_ORIGINAL'].includes(t.tipo);
  const simulated = t.tipo === 'TABELA_ZERO_SIMULADA';
  const r = object(source.resumo_comercial) ? source.resumo_comercial : {};
  if (!object(source.resumo_comercial)) error('RESUMO', 'resumo_comercial', 'Resumo ausente.');
  if (!text(e.nome)) error('NOME', 'empreendimento.nome', 'Nome obrigatório.');
  if (source.operacao === operations[1] && !text(e.id)) warn('VINCULO', 'empreendimento.id', 'Selecionar cadastro existente na prévia; não criar outro.');
  if (source.operacao === operations[2]) warn('IDENTIDADE', 'operacao', 'Resolver identidade antes de cadastrar.');
  if (source.operacao === operations[0] && e.id != null) warn('CRIACAO_COM_ID', 'empreendimento.id', 'Criação com ID existente exige revisão de vínculo.');
  if (!['Apartamento','Casa','Lote / Terreno','Comercial','Outro'].includes(e.tipo)) error('TIPO', 'empreendimento.tipo', 'Tipo cadastral inválido.');
  if (!['Popular/MCMV','Médio','Alto','Luxo','Não aplicável','Indefinido'].includes(e.padrao)) error('PADRAO', 'empreendimento.padrao', 'Padrão cadastral inválido.');
  if (e.fase != null && !['Lançamento','Novo','Em obras','Entregue'].includes(e.fase)) error('FASE', 'empreendimento.fase', 'Fase inválida.');
  if (e.status_obra != null && !['EM_OBRAS','OBRA_AVANCADA','OBRA_CONCLUIDA','ENTREGUE'].includes(e.status_obra)) error('OBRA', 'empreendimento.status_obra', 'Status físico inválido.');
  if (e.percentual_obra != null && (!number(e.percentual_obra) || e.percentual_obra < 0 || e.percentual_obra > 100)) error('PERCENTUAL', 'empreendimento.percentual_obra', 'Percentual deve estar entre 0 e 100.');
  for (const key of ['data_lancamento','data_entrega']) if (e[key] != null && !date(e[key])) error('DATA', `empreendimento.${key}`, 'Normalizar para data real AAAA-MM-DD; mês/ano usa dia 01 auditado.');
  if (!date(t.data_tabela)) error('DATA', 'tabela.data_tabela', 'Data comercial explícita inválida/ausente; data_base não substitui este campo.');
  if (zero && (!date(e.data_lancamento) || e.data_lancamento !== t.data_tabela)) error('DATA_ZERO', 'tabela.data_tabela', 'Zero exige lançamento válido e mesma data-base.');
  if (!natures.includes(t.tipo)) error('NATUREZA', 'tabela.tipo', 'Informar natureza no campo tipo, não natureza.');
  if (!modalities.includes(t.tipoTabela)) error('MODALIDADE', 'tabela.tipoTabela', 'Modalidade financeira ausente ou inválida.');
  if (!u.length) error('UNIDADES', 'tabela.unidades', 'Lista vazia ou ausente.');
  if (t.unidades_apresentadas !== u.length) error('CONTAGEM', 'tabela.unidades_apresentadas', 'Contagem não corresponde às linhas finais.');
  if (r.unidades_individualizadas !== u.length) error('CONTAGEM', 'resumo_comercial.unidades_individualizadas', 'Contagem não corresponde às linhas finais.');
  if (zero && (!Number.isInteger(r.total_estrutural) || r.total_estrutural !== u.length)) error('TOTAL_ZERO', 'resumo_comercial.total_estrutural', 'Zero deve individualizar todo o total adotado.');
  if (r.total_estrutural != null && (!Number.isInteger(r.total_estrutural) || r.total_estrutural < u.length)) error('TOTAL', 'resumo_comercial.total_estrutural', 'Total estrutural inválido ou menor que a fotografia.');
  const features = e.caracteristicas;
  if (!object(features)) warn('CARACTERISTICAS', 'empreendimento.caracteristicas', 'Falta estrutura de características pesquisadas.');
  else {
    for (const [key, value] of Object.entries(features.atributos || {})) if (![null,'sim','nao'].includes(value)) error('TRIESTADO', `caracteristicas.atributos.${key}`, 'Usar sim, nao ou null.');
    for (const [key, values, allowed] of [['dormitorios',features.dormitorios,['1','2','3','4','5_mais']],['vagas.quantidades',features.vagas?.quantidades,['1','2','3','4_mais']]]) {
      if (!Array.isArray(values) || values.some(v => !allowed.includes(v))) error('CARACTERISTICA_ENUM', `caracteristicas.${key}`, 'Lista de quantidades inválida.');
    }
    if (![null,'sim','nao'].includes(features.vagas?.possui)) error('TRIESTADO', 'caracteristicas.vagas.possui', 'Usar sim, nao ou null.');
  }
  for (const [key, value] of Object.entries(e.leitura_comercial || {})) if (value != null && typeof value !== 'string') error('TEXTO_COMERCIAL', `leitura_comercial.${key}`, 'Esperado texto, não objeto/número.');
  const coordinates = e.coordenadas || {};
  if (coordinates.latitude != null || coordinates.longitude != null) {
    if (!number(coordinates.latitude) || !number(coordinates.longitude) || Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180) error('COORDENADAS', 'empreendimento.coordenadas', 'Informar par numérico válido.');
  }
  if (!object(source.comparacao)) error('COMPARACAO', 'comparacao', 'Informar estado da comparação.');
  else if (!source.comparacao.previousTableId && source.comparacao.removidas?.length) error('REMOCAO_SEM_BASE', 'comparacao.removidas', 'Não emitir remoções sem vínculo anterior confirmado.');
  const rawKeys = new Set();
  let totalCents = 0;
  u.forEach((unit, i) => {
    const at = `tabela.unidades[${i}]`;
    if (!object(unit)) { error('UNIDADE_OBJETO', at, 'Esperado objeto.'); return; }
    if (!text(unit.unidade)) error('IDENTIFICADOR', at + '.unidade', 'Identificador textual obrigatório; lote/chave_natural não substituem unidade.');
    const group = unit.agrupadorOriginal || unit.quadra || unit.bloco || unit.torre;
    if (!text(group)) error('AGRUPADOR', at, 'Informar agrupador físico textual, mesmo em torre única.');
    const key = String(group) + ':' + unit.unidade;
    if (rawKeys.has(key)) error('CHAVE_DUPLICADA', at, key); else rawKeys.add(key);
    for (const alias of ['valorExtraido','valorVenda','valorPublicado','valorInterpretado','valorValidado','situacaoExtraida','situacaoPublicada','areaPrivativa','areaPrivativaM2','investimento']) {
      if (unit[alias] !== undefined) error('ALIAS_CONCORRENTE', at + '.' + alias, 'Preservar bruto em origem; não competir com campo canônico.');
    }
    for (const key of ['preco','area_m2']) {
      if (!positive(unit[key])) (zero || unit[key] != null ? error : warn)('VALOR_AUSENTE_INVALIDO', at + '.' + key, 'Esperado número positivo no campo canônico.');
    }
    if (!text(unit.tipologia)) (zero ? error : warn)('TIPOLOGIA', at + '.tipologia', 'Tipologia não informada.');
    if (!['DISPONIVEL','VENDIDO','RESERVADO','AUSENTE','BLOQUEADO','NAO_IDENTIFICADO'].includes(unit.status)) error('STATUS_UNIDADE', at + '.status', 'Situação canônica inválida.');
    if (simulated && unit.status !== 'DISPONIVEL') error('STATUS_ZERO', at + '.status', 'Toda unidade da Zero simulada deve estar disponível.');
    if (unit.natureza_preco === 'SIMULADO') {
      summary.precos_simulados++;
      if (unit.classificacao !== 'SIMULADO') error('ORIGEM_SIMULADA', at, 'natureza_preco e classificacao devem sinalizar simulação.');
    } else if (!['OBSERVADO','INFERIDO'].includes(unit.natureza_preco)) error('NATUREZA_PRECO', at, 'Identificar natureza_preco no campo lido pelo importador.');
    if (!object(unit.origem)) warn('PROVENIENCIA', at + '.origem', 'Sem proveniência por unidade.');
    if (positive(unit.preco)) { summary.precos_positivos++; totalCents += cents(unit.preco); }
    const conditions = unit.condicoes;
    if (!object(conditions) || !Array.isArray(conditions.planos) || !conditions.planos.length) {
      (zero || conditions?.planos != null ? error : warn)('PLANOS_LISTA', at + '.condicoes.planos', 'Esperado array de planos; objeto por prazo não é lido.'); return;
    }
    if (!number(conditions.entrada) || conditions.entrada < 0) error('ENTRADA', at + '.condicoes.entrada', 'Entrada comum deve ser número não negativo.');
    for (const key of Object.keys(conditions)) if (!['entrada','planos'].includes(key)) warn('COMPONENTE_NAO_MAPEADO', at + '.condicoes.' + key, 'Conferir leitura deste campo; planos[] não consome componentes livres.');
    const codes = new Set();
    conditions.planos.forEach((plan, j) => {
      const p = at + `.condicoes.planos[${j}]`;
      summary.planos_declarados++;
      if (!object(plan)) { error('PLANO_OBJETO', p, 'Esperado objeto de plano.'); return; }
      if (!text(plan.codigo) || codes.has(plan.codigo)) error('PLANO_CODIGO', p, 'Código ausente ou duplicado na unidade.');
      codes.add(plan.codigo);
      if (!text(plan.nome)) error('PLANO_NOME', p, 'Nome do plano obrigatório.');
      if (!Number.isInteger(plan.prazoMeses) || plan.prazoMeses < 0) error('PRAZO', p, 'Prazo deve ser inteiro não negativo.');
      if (plan.entrada !== undefined && (!number(plan.entrada) || cents(plan.entrada) !== cents(conditions.entrada))) error('ENTRADA_POR_PLANO', p, 'Leitor ignora entrada própria do plano; valores devem coincidir exatamente.');
      for (const key of Object.keys(plan)) if (!['codigo','nome','prazoMeses','entrada','mensal','intercaladas','chave','conciliacao'].includes(key)) warn('COMPONENTE_NAO_MAPEADO', p + '.' + key, 'Campo não consumido pelo contrato de planos; não descartar.');
      let total = number(conditions.entrada) ? cents(conditions.entrada) : 0;
      let componentsValid = number(conditions.entrada);
      for (const name of ['mensal','intercaladas','chave']) {
        if (plan[name] == null) continue;
        const c = plan[name];
        const quantity = name === 'mensal' ? c.parcelas : c.quantidade;
        if (!object(c) || !Number.isInteger(quantity) || quantity <= 0 || !number(c.valor) || c.valor < 0) { error('COMPONENTE', p + '.' + name, 'Informar quantidade inteira positiva e valor unitário não negativo.'); componentsValid = false; }
        else total += quantity * cents(c.valor);
        if (object(c)) {
          const allowed = name === 'mensal' ? ['parcelas','valor'] : ['quantidade','valor','periodicidade'];
          for (const key of Object.keys(c)) if (!allowed.includes(key)) warn('COMPONENTE_NAO_MAPEADO', p + '.' + name + '.' + key, 'Campo fora do componente canônico; verificar precedência/perda no leitor.');
        }
      }
      if (componentsValid && positive(unit.preco) && Math.abs(total - cents(unit.preco)) > 1) {
        (text(plan.conciliacao?.motivo) ? warn : error)('SOMA_PLANO', p, `Componentes ${(total / 100).toFixed(2)} versus preço ${unit.preco}; revisar base e limitações do leitor.`);
      }
    });
  });
  summary.unidades = u.length;
  summary.vgv = totalCents / 100;
  if (r.vgv_zero_simulado != null && !sameMoney(r.vgv_zero_simulado, summary.vgv)) error('VGV', 'resumo_comercial.vgv_zero_simulado', 'Não corresponde à soma dos preços finais.');
  if (simulated && r.disponiveis !== u.filter(unit => unit?.status === 'DISPONIVEL').length) error('DISPONIVEIS', 'resumo_comercial.disponiveis', 'Contagem divergente.');
  // Even malformed canonical fields are tested against the actual parser to expose silent losses.
  if (object(source.tabela) && u.every(object)) {
    try {
      const api = importer(); sha256 = api.sha256;
      const preview = api.prepareJsonImport(structuredClone(source), 'contract-check.json');
      const keys = new Set(preview.units.map(unit => unit.chave));
      summary.chaves_importadas = keys.size;
      if (preview.units.length !== u.length || keys.size !== u.length) error('COLISAO_IMPORTADOR', 'tabela.unidades', `${u.length} linhas, ${preview.units.length} lidas, ${keys.size} chaves únicas.`);
      if (preview.table.validityDate !== t.data_tabela) error('DATA_IMPORTADOR', 'tabela.data_tabela', `Data lida: ${preview.table.validityDate}.`);
      if (preview.table.tipoTabela !== t.tipoTabela) error('MODALIDADE_IMPORTADOR', 'tabela.tipoTabela', 'Modalidade alterada durante normalização.');
      for (const [key, dest] of [['data_lancamento','launchDate'],['data_entrega','deliveryDate']]) {
        if (e[key] != null && preview.enterprise.datas[dest] !== e[key]) error('DATA_IMPORTADOR', 'empreendimento.' + key, 'Data alterada ou substituída por alias.');
      }
      preview.units.forEach((unit, i) => {
        const raw = u[i]; if (!raw) return;
        const at = `tabela.unidades[${i}]`;
        if (!unit.unidade) error('IDENTIFICADOR_IMPORTADOR', at, 'Unidade vazia após leitura.');
        if (positive(raw.preco) && !sameMoney(raw.preco, unit.valorInterpretado)) error('PRECO_IMPORTADOR', at, 'Preço alterado/perdido no leitor.');
        if (positive(raw.area_m2) && raw.area_m2 !== unit.areaPrivativa) error('AREA_IMPORTADOR', at, 'Área alterada/perdida no leitor.');
        if (simulated && unit.situacaoExtraida !== 'Disponível') error('STATUS_IMPORTADOR', at, 'Zero deixou de estar disponível após leitura.');
        if (raw.natureza_preco === 'SIMULADO' && (unit.classificacaoPreco !== 'SIMULADO' || unit.classificacaoOrigem !== 'SIMULADO')) error('ORIGEM_IMPORTADOR', at, 'Classificação simulada perdida.');
        const plans = api.declaredPlans(unit);
        summary.planos_lidos += plans.length;
        if (Array.isArray(raw.condicoes?.planos) && plans.length !== raw.condicoes.planos.length) error('PLANOS_IMPORTADOR', at, 'Quantidade de planos alterada/perdida.');
        if (Array.isArray(raw.condicoes?.planos)) plans.forEach((plan, j) => {
          const expected = raw.condicoes.planos[j];
          if (!object(expected)) return;
          if (number(raw.condicoes.entrada) && !sameMoney(raw.condicoes.entrada, plan.entrada)) error('COMPONENTE_IMPORTADOR', at, 'Entrada alterada/perdida.');
          for (const [from, to, quantity] of [['mensal','mensais','parcelas'],['intercaladas','intercaladas','quantidade'],['chave','chave','quantidade']]) {
            const c = expected[from], actual = plan[to];
            if (!object(c)) continue;
            if (number(c.valor) && (!sameMoney(c.valor, actual?.valor) || c[quantity] !== actual?.quantidade)) error('COMPONENTE_IMPORTADOR', `${at}.condicoes.planos[${j}].${from}`, 'Valor/quantidade não preservados no leitor.');
            if (from === 'intercaladas' && c.periodicidade != null && c.periodicidade !== actual?.periodicidade) error('COMPONENTE_IMPORTADOR', at, 'Periodicidade alterada no leitor.');
          }
        });
      });
      for (const [i, ref] of references.entries()) {
        const re = ref?.empreendimento;
        const sameId = text(e.id) && e.id === re?.id;
        const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        if (!sameId && (!text(re?.nome) || normalize(re.nome) !== normalize(e.nome) || (text(e.id) && text(re.id) && e.id !== re.id))) { error('REFERENCIA_VINCULO', `references[${i}]`, 'Identidade da referência não corresponde à Zero.'); continue; }
        const rt = ref?.tabela;
        if (!zero || !Array.isArray(rt?.unidades) || !rt.unidades.length || rt.unidades.some(row => !object(row) || !text(row.unidade) || !text(row.agrupadorOriginal || row.quadra || row.bloco || row.torre)) || ref.unidades || ref.tabelaProcessada || ref.tabela_comercial) { error('REFERENCIA_FORMATO', `references[${i}]`, 'Esperada Zero como alvo e referência com chaves canônicas não vazias.'); continue; }
        if (rt.tipoTabela !== t.tipoTabela || !date(rt.data_tabela) || rt.data_tabela < t.data_tabela) { error('REFERENCIA_CONTEXTO', `references[${i}]`, 'Modalidade/data incompatíveis.'); continue; }
        const normalizedRef = structuredClone(ref); normalizedRef.empreendimento.id = e.id || 'IMPORT';
        const rp = api.prepareJsonImport(normalizedRef, 'reference.json');
        const referenceKeys = new Set(rp.units.map(unit => unit.chave));
        if (referenceKeys.size !== rt.unidades.length) { error('REFERENCIA_COLISAO', `references[${i}]`, 'Referência tem colisões; resolver antes de reconciliar.'); continue; }
        for (const key of referenceKeys) if (!keys.has(key)) error('CODIGO_FORA_ZERO', `references[${i}]`, `Código conhecido ausente da Zero: ${key}. Reconciliar ou comprovar acréscimo posterior.`);
      }
    } catch (err) { error('IMPORTADOR', '$', err.message); }
  }
  if (zero && !references.length) warn('SEM_REFERENCIA', 'tabela.unidades', 'Sem comparação com códigos de outras tabelas; N linhas não comprova inventário reconciliado.');
  if (source.status_processamento === 'CONSOLIDADO' && issues.size) error('CONSOLIDACAO_INDEVIDA', 'status_processamento', 'Há erros/revisões; usar REVISAO até resolvê-los.');
  return result();
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), filename = args.shift(), references = [];
    if (!filename) throw new Error('Uso: node Skill/scripts/validate-nexum-json.cjs arquivo.json [--reference outra-tabela.json]');
    while (args.length) {
      if (args.shift() !== '--reference' || !args.length) throw new Error('Argumento inválido: use --reference arquivo.json.');
      references.push(readJson(args.shift()));
    }
    const report = validate(readJson(filename), {references});
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.contrato_compativel ? 0 : 1;
  } catch (err) { console.error(JSON.stringify({contrato_compativel: false, cadastro_executado: false, erro: err.message})); process.exitCode = 1; }
}
module.exports = {validate, readJson, importer};
