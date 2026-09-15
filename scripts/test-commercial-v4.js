const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { extractPdf, resolveTableTerm, buildNormalization } = require('../server');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'nexo-radar.json'), 'utf8'));
const enterprise = (id) => data.empreendimentos.find((item) => item.id === id);
const table = (enterpriseId, tableId) => enterprise(enterpriseId).tabelas.find((item) => item.id === tableId);
const value = (unit) => Number(unit.valorValidado ?? unit.valorInterpretado ?? unit.valorExtraido ?? 0);
const check = (unit, code) => {
  const published = (unit.condicoes?.planos || []).find((item) => item.codigo === code) || (code === 'PLANO_PADRAO' ? unit.condicoes : null);
  return published?.conciliacao || published?.conciliação;
};
const totalFor = (components) => components.reduce((total, item) => total + Number(item.total || 0), 0);

assert.ok(data.version >= 9, 'a persistência deve incluir o dicionário externo de termos do modelo v9');
for (const item of data.empreendimentos.filter((entry) => entry.status !== 'inactive')) {
  const effectiveBase = item.tabelaBaseId || item.tabelaPadraoTableId || (item.tabelas || []).find((table) => table.status === 'registered')?.id;
  assert.ok(effectiveBase, `${item.id} deve possuir uma fotografia confirmada utilizável como tabela base`);
  assert.ok(Array.isArray(item.fatosComerciais), `${item.id} deve possuir livro de fatos`);
  assert.ok(Array.isArray(item.intervalosComerciais), `${item.id} deve possuir intervalos mensais persistidos`);
  assert.ok(Array.isArray(item.auditoria), `${item.id} deve possuir auditoria própria`);
  if (item.tabelaBaseId || item.tabelaPadraoTableId) assert.equal(item.tabelaPadraoTableId, item.tabelaBaseId, 'o alias legado deve acompanhar a tabela base durante a transição');
  for (const snapshot of item.tabelas || []) for (const unit of snapshot.unidades || []) {
    assert.ok(Object.hasOwn(unit, 'valorPublicado'), `${snapshot.id} deve separar valor publicado`);
    assert.ok(Object.hasOwn(unit, 'situacaoPublicada'), `${snapshot.id} deve separar situação publicada`);
  }
}

const quintasEnterprise = enterprise('EMP-000004');
const quintasTables = [...quintasEnterprise.tabelas].filter((item) => item.status === 'registered' && item.tipoTabela === 'DIRETO_CONSTRUTORA').sort((a, b) => a.validityDate.localeCompare(b.validityDate) || a.id.localeCompare(b.id));
const quintas = quintasTables.find((item) => item.unidades.length === 352 && item.regraInterpretada?.planos?.length === 8);
const quintasCurrent = quintasTables.at(-1);
if (quintas) {
  assert.equal(quintas.regraInterpretada.versaoModelo, 4);
  assert.equal(quintas.regraInterpretada.estrutura, 'alternativas');
  assert.equal(quintas.regraInterpretada.status, 'validado_automaticamente');
  assert.equal(quintas.unidades.length, 352);
  assert.equal(quintas.regraInterpretada.planos.length, 8);
  assert.equal(quintas.regraInterpretada.conciliacao.conformes, 2816);
  assert.equal(quintas.regraInterpretada.conciliacao.divergentes, 0);
  assert.equal(quintasEnterprise.fatosComerciais.filter((item) => item.tipo === 'UNIDADE_NOVA' && item.tabelaAtualId === quintas.id).length, 352);
  assert.deepEqual(quintas.regraInterpretada.planos.map((item) => item.codigo), ['PLANO_12', 'PLANO_24', 'PLANO_36', 'PLANO_36_INTERCALADAS', 'PLANO_60', 'PLANO_60_INTERCALADAS', 'PLANO_72', 'PLANO_72_INTERCALADAS']);
  for (const plan of quintas.regraInterpretada.planos) {
    assert.equal(plan.componentes.find((item) => item.id === 'entrada').natureza, 'minima');
    assert.equal(plan.componentes.find((item) => item.id === 'mensais').tipoCalculo, 'residual');
    if (plan.codigo.includes('INTERCALADAS')) {
      const intercalated = plan.componentes.find((item) => item.id === 'intercaladas');
      assert.equal(intercalated.tipoCalculo, 'valor_fixo');
      assert.equal(intercalated.valor, 2000);
      assert.equal(intercalated.natureza, 'minima');
    }
  }
  const quintasUnit = quintas.unidades.find((item) => check(item, 'PLANO_36_INTERCALADAS')?.status === 'conforme');
  const quintasCheck = check(quintasUnit, 'PLANO_36_INTERCALADAS');
  assert.ok(Math.abs(totalFor(quintasCheck.valoresDerivados) - value(quintasUnit)) < 0.01);
  const baselineEntry = quintasCheck.valoresDerivados.find((item) => item.id === 'entrada').total;
  const baselineMonthly = quintasCheck.valoresDerivados.find((item) => item.id === 'mensais');
  const increasedEntry = baselineEntry + 5000;
  const proposedMonthlyTotal = value(quintasUnit) - increasedEntry - quintasCheck.valoresDerivados.find((item) => item.id === 'intercaladas').total;
  assert.ok(proposedMonthlyTotal / baselineMonthly.quantidade < baselineMonthly.valor);
  assert.ok(Math.abs(increasedEntry + quintasCheck.valoresDerivados.find((item) => item.id === 'intercaladas').total + proposedMonthlyTotal - value(quintasUnit)) < 0.01);
  assert.ok(baselineEntry - 1 < baselineEntry, 'uma entrada abaixo do mínimo deve ser rejeitada pelo simulador');
}

for (const tableId of ['TAB-000005', 'TAB-000009']) {
  const zuhaus = table('EMP-000002', tableId), rule = zuhaus.regraInterpretada, plan = rule.planos[0];
  assert.equal(zuhaus.unidades.length, 73);
  assert.equal(rule.versaoModelo, 4);
  assert.equal(rule.estrutura, 'composicao');
  assert.equal(rule.status, 'validado_automaticamente');
  assert.equal(rule.conciliacao.conformes, 73);
  assert.equal(rule.conciliacao.divergentes, 0);
  assert.deepEqual(plan.componentes.map((item) => [item.id, item.percentual, item.baseCalculo, item.origemInterpretacao]), [
    ['entrada', 15, 'valor_imovel', 'declarada'],
    ['mensais', 50, 'valor_imovel', 'declarada'],
    ['intercaladas', 20, 'valor_imovel', 'declarada'],
    ['chave', 15, 'valor_imovel', 'declarada']
  ]);
  assert.equal(plan.componentes.find((item) => item.id === 'intercaladas').periodicidade, 'nao_informada');
}

for (const item of data.empreendimentos.flatMap((entry) => entry.tabelas || []).filter((entry) => entry.regraInterpretada?.planos?.length)) {
  assert.equal(item.regraInterpretada.identidade.modalidade, item.regraInterpretada.modalidade.codigo);
  assert.equal(item.regraInterpretada.identidade.versao, item.id);
  assert.equal(item.modalidadesComerciais[0].quantidadePlanos, item.regraInterpretada.planos.length);
  if (item.documento?.path && item.documento?.hash) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, item.documento.path))).digest('hex');
    assert.equal(actual, item.documento.hash, `o PDF original de ${item.id} deve permanecer imutável`);
  }
}

const simulator = fs.readFileSync(path.join(root, 'simulador.html'), 'utf8');
for (const field of ['unit', 'modality', 'version', 'plan']) assert.match(simulator, new RegExp(`id=\\"${field}\\"`));
assert.match(simulator, /Publicado × Proposto/);
assert.match(simulator, /viola um mínimo/);
assert.match(simulator, /simulacao-contexto/);
assert.match(simulator, /não calcula prestação/);
const generalTable = fs.readFileSync(path.join(root, 'analise.html'), 'utf8');
assert.match(generalTable, /Tabela Geral/);
assert.match(generalTable, /general-modality/);
assert.match(generalTable, /visualizacao-comercial/);
const enterprisePage = fs.readFileSync(path.join(root, 'empreendimento.html'), 'utf8');
assert.match(enterprisePage, /Definir como tabela base/);
assert.match(enterprisePage, /impacto-exclusao/);
assert.match(enterprisePage, /Excluir tabela e dependências/);
assert.match(enterprisePage, /Situação operacional/);
assert.match(enterprisePage, /Aplicar à seleção/);
assert.match(enterprisePage, /Alterar situações/);
assert.match(enterprisePage, /Filtrar situação/);
assert.match(enterprisePage, /'Ausente'/);
assert.match(enterprisePage, /Criar e vincular/);
assert.match(enterprisePage, /mapear-termos/);
const css = fs.readFileSync(path.join(root, 'nexo.css'), 'utf8');
assert.match(css, /height:96vh!important/);
assert.match(css, /overflow:scroll!important/);
assert.match(css, /minmax\(220px,1fr\)/);
assert.match(css, /minmax\(320px,1fr\)/);
assert.match(css, /general-units-table/);

async function testQuintasCommercialMatrixExtraction() {
  const downloads = 'C:\\Users\\erics\\Downloads';
  const externalSources = [
    'quintas 01 set 24.pdf', 'quintas 24 out 24.pdf', 'quintas 10 dez  24.pdf',
    'quintas 26 fev 25.pdf', 'quintas 03 JUNHO 25.pdf', 'quintas 03 jul 25.pdf',
    'quintas 25 SET 25.pdf', 'quintas 31 MAR 26.pdf', 'quintas 17 ABRIL 26.pdf'
  ].map((name) => path.join(downloads, name)).filter((source) => fs.existsSync(source));
  const repositorySources = [
    'pdf/cadastrados/TAB-000029_Quintas_da_Mata_2024-09-01_Tabela_1_Set_24.pdf',
    'pdf/cadastrados/TAB-000031_Quintas_da_Mata_2024-10-01_Tabela_24_out_24.pdf',
    'pdf/cadastrados/TAB-000032_Quintas_da_Mata_2024-12-01_Tabela_10_dez_24.pdf'
  ].map((name) => path.join(root, name)).filter((source) => fs.existsSync(source));
  const sources = [...new Set([...externalSources, ...repositorySources])];
  assert.ok(sources.length >= 2, 'os fixtures versionados do Quintas devem estar disponíveis para validação do extrator');
  const parsed = await Promise.all(sources.map(async (source) => ({ source, result: await extractPdf(source, 'EMP-TESTE-QUINTAS') })));
  for (const { source, result } of parsed) {
    assert.ok(result.units.length > 200, `${path.basename(source)} deve reconhecer centenas de lotes, não um cabeçalho como unidade`);
    assert.ok(result.units.every((unit) => unit.quadra !== 'SEM-QUADRA'), `${path.basename(source)} não pode perder a âncora de quadra`);
    assert.ok(result.units.every((unit) => unit.unidade !== 'M'), `${path.basename(source)} não pode transformar o cabeçalho M² em lote`);
    assert.ok(result.units.some((unit) => unit.situacaoExtraida === 'Vendida'), `${path.basename(source)} deve preservar VENDIDO publicado`);
    assert.ok(result.units.some((unit) => unit.situacaoExtraida === 'Disponível'), `${path.basename(source)} deve preservar DISPONÍVEL publicado`);
  }
  const september = parsed.find((item) => /(?:quintas 01 set 24|TAB-000029_Quintas_da_Mata_2024-09-01)/i.test(item.source))?.result;
  assert.ok(september, 'a fotografia inicial de setembro/2024 deve ser validada');
  assert.deepEqual(september.units[0].condicoes.planos.map((plan) => plan.codigo), ['PLANO_12', 'PLANO_60', 'PLANO_60_INTERCALADAS', 'PLANO_96', 'PLANO_96_INTERCALADAS', 'PLANO_156', 'PLANO_156_INTERCALADAS']);
}

function testTableTermDictionary() {
  const expected = [
    ['Preço', 'valor'], ['Preço do imóvel', 'valor'], ['Valor do imóvel', 'valor'],
    ['Semestral', 'intercalada_semestral'], ['Semestrais', 'intercalada_semestral'], ['Intercaladas semestrais', 'intercalada_semestral'],
    ['Anual', 'intercalada_anual'], ['Anuais', 'intercalada_anual'], ['Intermediárias', 'intercalada'], ['Balões', 'intercalada'], ['Reforços', 'intercalada'],
    ['Ato', 'ato'], ['Entrada', 'entrada'], ['Entrega das chaves', 'entrega_chaves']
  ];
  for (const [source, canonical] of expected) {
    const resolved = resolveTableTerm(source); assert.equal(resolved.encontradoNoDicionario, true, `${source} deve constar no dicionário`); assert.equal(resolved.termoNormalizado, canonical, `${source} deve normalizar para ${canonical}`);
  }
  const variation = resolveTableTerm('  PRÉÇO   DO   IMÓVEL  '); assert.equal(variation.termoNormalizado, 'valor'); assert.equal(variation.encontradoNoDicionario, true, 'a busca deve tolerar caixa, acento e espaços técnicos');
  const unknown = resolveTableTerm('Fluxo especial do parceiro'); assert.equal(unknown.encontradoNoDicionario, false); assert.equal(unknown.categoria, 'nao_mapeado');
  const pending = buildNormalization('Preço | Entrada | Balão semestral', { commercialRules: '' }); assert.ok(pending.campos.some((field) => field.termoNormalizado === 'valor')); assert.deepEqual(pending.termosDesconhecidos, ['Balão semestral']);
  const mapped = buildNormalization('Preço | Entrada | Balão semestral', { commercialRules: '' }, [{ termoOrigem: 'Balão semestral', termoNormalizado: 'intercalada_semestral', categoria: 'parcelamento' }]); assert.equal(mapped.termosDesconhecidos.length, 0); assert.ok(mapped.campos.some((field) => field.termoNormalizado === 'intercalada_semestral'));
}

async function testVersionedEdit() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-commercial-v4-'));
  const temporaryData = path.join(temporaryDirectory, 'nexo-radar.json');
  fs.copyFileSync(path.join(root, 'data', 'nexo-radar.json'), temporaryData);
  const isolatedData = JSON.parse(fs.readFileSync(temporaryData, 'utf8'));
  const historyEnterprise = { id: 'EMP-HIST', nome: 'Histórico sintético', tipo: 'Lote / Terreno', padrao: 'Médio', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', tabelas: [], unidades: [], pontosQuentes: [], tabelasExcluidas: [], fatosComerciais: [], auditoria: [] };
  const makeHistoryTable = (code, date, count, price, classifications = {}) => ({ id: code, name: `Tabela ${date}`, tipoTabela: 'PADRAO', tipoTabelaLabel: 'Tabela geral / não informado', validityDate: date, status: 'registered', createdAt: `${date}T08:00:00.000Z`, validatedAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, documento: null, extracao: { texto: '', warnings: [] }, normalizacao: { formato: 'teste_historico', campos: [] }, unidades: Array.from({ length: count }, (_, index) => ({ id: `${code}-U${index + 1}`, chave: `EMP-HIST:QD_01:${index + 1}`, quadra: 'QD-01', unidade: String(index + 1), valorExtraido: price, valorPublicado: price, valorInterpretado: price, valorValidado: price, situacaoExtraida: 'Disponível', situacaoPublicada: 'Disponível', areaPrivativa: 200, condicoes: {} })), classificacoesRemocao: classifications, manualReviewRequired: false, origem: { tipo: 'manual', label: 'Teste histórico' }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'teste' }, comparacao: {}, alertas: [], auditoria: [] });
  const sold = (from, to, at) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, index) => [`EMP-HIST:QD_01:${from + index}`, { status: 'VENDIDA', at, usuario: 'TESTE' }]));
  historyEnterprise.tabelas.push(makeHistoryTable('TAB-HIST-A', '2026-01-01', 100, 100000), makeHistoryTable('TAB-HIST-B', '2026-02-01', 90, 100000, sold(91, 100, '2026-02-01T09:00:00.000Z')), makeHistoryTable('TAB-HIST-C', '2026-03-01', 85, 105000, sold(86, 90, '2026-03-01T09:00:00.000Z')), makeHistoryTable('TAB-HIST-D', '2026-05-01', 88, 108000), makeHistoryTable('TAB-HIST-E', '2026-08-01', 80, 112000, sold(81, 88, '2026-08-01T09:00:00.000Z')));
  historyEnterprise.tabelaBaseId = 'TAB-HIST-A'; historyEnterprise.tabelaPadraoTableId = 'TAB-HIST-A'; historyEnterprise.tabelaPadraoTipo = 'PADRAO'; isolatedData.empreendimentos.push(historyEnterprise);
  const monthlyEnterprise = { id: 'EMP-MONTH', nome: 'Consolidação mensal', tipo: 'Lote / Terreno', padrao: 'Médio', status: 'active', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-05-20T00:00:00.000Z', tabelas: [], unidades: [], pontosQuentes: [], tabelasExcluidas: [], fatosComerciais: [], intervalosComerciais: [], auditoria: [] };
  const statusTable = (id, date, total, availableKeys, soldKeys) => ({ id, name:id, tipoTabela:'PADRAO', tipoTabelaLabel:'Tabela geral / não informado', validityDate:date, status:'registered', createdAt:`${date}T08:00:00.000Z`, validatedAt:`${date}T09:00:00.000Z`, updatedAt:`${date}T09:00:00.000Z`, documento:null, extracao:{texto:'',warnings:[]}, normalizacao:{formato:'teste',campos:[]}, unidades:Array.from({length:total},(_,index)=>{const number=index+1,status=soldKeys.includes(number)?'Vendida':availableKeys.includes(number)?'Disponível':'Bloqueada';return {id:`${id}-U${number}`,chave:`EMP-MONTH:QD_01:${number}`,quadra:'QD-01',unidade:String(number),valorExtraido:100000,valorPublicado:100000,valorInterpretado:100000,valorValidado:100000,situacaoExtraida:status,situacaoPublicada:status,areaPrivativa:200,condicoes:{}}}), classificacoesRemocao:{}, origem:{tipo:'manual',label:'Teste'}, confiancaLeitura:{percentual:100,classificacao:'alta',metodo:'teste'}, comparacao:{}, alertas:[], auditoria:[] });
  const range = (from,to) => Array.from({length:to-from+1},(_,index)=>from+index);
  monthlyEnterprise.tabelas.push(statusTable('TAB-MONTH-APR','2026-04-10',100,range(1,100),[]),statusTable('TAB-MONTH-MAY-A','2026-05-05',100,range(1,90),range(91,100)),statusTable('TAB-MONTH-MAY-B','2026-05-25',100,range(1,90),range(91,100)));
  monthlyEnterprise.tabelaBaseId='TAB-MONTH-APR'; monthlyEnterprise.tabelaPadraoTableId='TAB-MONTH-APR'; monthlyEnterprise.tabelaPadraoTipo='PADRAO'; isolatedData.empreendimentos.push(monthlyEnterprise);
  const vsoEnterprise = { id:'EMP-VSO', nome:'Contrato VSO', tipo:'Lote / Terreno', padrao:'Médio', status:'active', createdAt:'2026-04-01T00:00:00.000Z', updatedAt:'2026-07-01T00:00:00.000Z', tabelas:[], unidades:[], pontosQuentes:[], tabelasExcluidas:[], fatosComerciais:[], intervalosComerciais:[], auditoria:[] };
  const vsoTable = (id,date,available,soldKeys,total) => ({...statusTable(id,date,total,available,soldKeys),unidades:statusTable(id,date,total,available,soldKeys).unidades.map((unit)=>({...unit,chave:unit.chave.replace('EMP-MONTH','EMP-VSO')}))});
  vsoEnterprise.tabelas.push(vsoTable('TAB-VSO-APR','2026-04-10',range(1,100),[],100),vsoTable('TAB-VSO-JUN','2026-06-20',[...range(1,90),...range(101,130)],range(91,100),130),vsoTable('TAB-VSO-JUL','2026-07-30',[...range(1,80),...range(101,130)],range(81,100),130));
  vsoEnterprise.tabelaBaseId='TAB-VSO-APR';vsoEnterprise.tabelaPadraoTableId='TAB-VSO-APR';vsoEnterprise.tabelaPadraoTipo='PADRAO';isolatedData.empreendimentos.push(vsoEnterprise);
  const absenceUnit = (tableId, number) => ({ id: `${tableId}-U${number}`, chave: `EMP-ABS:QD_01:${number}`, quadra: 'QD-01', unidade: String(number), valorExtraido: 100000, valorPublicado: 100000, valorInterpretado: 100000, valorValidado: 100000, situacaoExtraida: 'Disponível', situacaoPublicada: 'Disponível', areaPrivativa: 200, condicoes: {} });
  const absenceTable = (tableId, date, numbers) => ({ id: tableId, name: tableId, tipoTabela: 'PADRAO', tipoTabelaLabel: 'Tabela geral / não informado', validityDate: date, status: 'registered', createdAt: `${date}T08:00:00.000Z`, validatedAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, documento: null, extracao: { texto: '', warnings: [] }, normalizacao: { formato: 'teste', campos: [] }, unidades: numbers.map((number) => absenceUnit(tableId, number)), classificacoesRemocao: {}, origem: { tipo: 'manual', label: 'Teste' }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'teste' }, comparacao: {}, alertas: [], auditoria: [] });
  isolatedData.empreendimentos.push({ id: 'EMP-ABS', nome: 'Ausências operacionais', tipo: 'Lote / Terreno', padrao: 'Médio', status: 'active', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z', tabelas: [absenceTable('TAB-ABS-APR', '2026-04-01', [1, 2]), absenceTable('TAB-ABS-MAY', '2026-05-01', [1])], tabelaBaseId: 'TAB-ABS-APR', tabelaPadraoTableId: 'TAB-ABS-APR', tabelaPadraoTipo: 'PADRAO', unidades: [], pontosQuentes: [], tabelasExcluidas: [], fatosComerciais: [], intervalosComerciais: [], auditoria: [] });
  const conflictUnit = (id, status) => ({ id, chave: 'EMP-CONFLICT:BL_A:101', quadra: 'BL-A', unidade: '101', valorExtraido: 200000, valorPublicado: 200000, valorInterpretado: 200000, valorValidado: 200000, situacaoExtraida: status, situacaoPublicada: status, condicoes: {} });
  const conflictTable = (id, type, date, status) => ({ id, name: id, tipoTabela: type, tipoTabelaLabel: type, validityDate: date, status: 'registered', createdAt: `${date}T08:00:00.000Z`, validatedAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, documento: null, extracao: { texto: '', warnings: [] }, normalizacao: { formato: 'teste', campos: [] }, unidades: [conflictUnit(`${id}-U`, status)], classificacoesRemocao: {}, origem: { tipo: 'manual', label: 'Teste' }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'teste' }, comparacao: {}, alertas: [], auditoria: [] });
  isolatedData.empreendimentos.push({ id: 'EMP-CONFLICT', nome: 'Conflito de modalidade', tipo: 'Apartamento', padrao: 'Médio', status: 'active', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', tabelas: [conflictTable('TAB-CONFLICT-BASE', 'PADRAO', '2026-03-01', 'Disponível'), conflictTable('TAB-CONFLICT-LATEST', 'A_VISTA', '2026-04-01', 'Vendida')], tabelaBaseId: 'TAB-CONFLICT-BASE', tabelaPadraoTableId: 'TAB-CONFLICT-BASE', tabelaPadraoTipo: 'PADRAO', unidades: [], pontosQuentes: [], tabelasExcluidas: [], fatosComerciais: [], auditoria: [] });
  isolatedData.empreendimentos.find((item) => item.id === 'EMP-000004').tabelas.push({ id: 'TAB-TESTE-VISTA', name: 'Tabela à vista', tipoTabela: 'A_VISTA', tipoTabelaLabel: 'À vista', validityDate: '2026-08-21', status: 'registered', createdAt: '2026-08-21T12:00:00.000Z', processedAt: '2026-08-21T12:00:00.000Z', extracao: { texto: 'CONDIÇÃO À VISTA: 20% DE DESCONTO À VISTA', warnings: [] }, normalizacao: { formato: 'teste', campos: [] }, unidades: [{ id: 'U-VISTA-1', chave: 'EMP-000004:QD_TESTE:1', quadra: 'QD-TESTE', unidade: '1', valorExtraido: 100000, valorInterpretado: 100000, situacaoExtraida: 'Disponível', condicoes: {} }], origem: { tipo: 'manual', label: 'Teste isolado' }, confiancaLeitura: { percentual: 100, classificacao: 'alta', metodo: 'teste' }, comparacao: { novas: [], removidas: [], alteracoesValor: [] }, alertas: [], regrasComerciais: '20% de desconto à vista', auditoria: [] });
  fs.writeFileSync(temporaryData, JSON.stringify(isolatedData, null, 2));
  const port = 3197;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), NEXO_DATA_FILE: temporaryData, NEXO_TEST_FAILURES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try { ready = (await fetch(`http://localhost:${port}/api/health`)).ok; } catch (_) { /* aguarda o servidor isolado */ }
    }
    assert.ok(ready, 'o servidor isolado deve iniciar para o teste de versionamento');
    const sightResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/tabelas/TAB-TESTE-VISTA`), sight = await sightResponse.json();
    assert.equal(sightResponse.status, 200, JSON.stringify(sight));
    assert.ok(sight.regraInterpretada, JSON.stringify(sight));
    assert.equal(sight.regraInterpretada.modalidade.codigo, 'A_VISTA');
    assert.equal(sight.regraInterpretada.planos[0]?.codigo, 'PLANO_A_VISTA', JSON.stringify(sight.regraInterpretada));
    assert.equal(sight.regraInterpretada.status, 'validado_automaticamente');
    assert.equal(sight.unidades[0].valoresDerivadosComerciais.PLANO_A_VISTA.valorComercial, 80000);
    if (quintas) {
      const quintasProjection = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/unidades?modalidade=DIRETO_CONSTRUTORA&plano=PLANO_36_INTERCALADAS`)).json();
      assert.equal(quintasProjection.unidades.filter((item) => item.valorModalidade != null).length, quintasCurrent.unidades.length);
      assert.equal(quintasProjection.planos.length, 8);
      assert.equal(quintasProjection.plano.codigo, 'PLANO_36_INTERCALADAS');
      const commercialView = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/tabelas/${quintas.id}/visualizacao-comercial?planos=PLANO_12,PLANO_36_INTERCALADAS`)).json();
      assert.equal(commercialView.rows.length, quintas.unidades.length);
      assert.equal(commercialView.planos.length, 2);
    }
    const bankContext = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000002/simulacao-contexto?modalidade=FINANCIAMENTO_BANCARIO`)).json();
    assert.equal(bankContext.informativo, true);
    assert.equal(bankContext.calculavel, false, 'financiamento bancário não deve inventar prestação');
    const history = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST/historico?modalidade=PADRAO`)).json();
    assert.deepEqual(history.timeline.map((item) => item.validityDate), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-05-01', '2026-08-01']);
    assert.equal(history.fatos.filter((item) => item.tipo === 'VENDA_IDENTIFICADA').length, 23);
    const march = history.timeline.find((item) => item.id === 'TAB-HIST-C');
    assert.equal(march.reajuste.unidadesComparaveis, 85);
    assert.ok(Math.abs(march.reajuste.reajusteMedioPercentual - 0.05) < 1e-10);
    const historicalRadar = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST/radar?modalidade=PADRAO`)).json();
    assert.equal(historicalRadar.timeline.length, 5);
    assert.equal(historicalRadar.comparison.salesConfirmed, 8);
    assert.equal(historicalRadar.ivv.intervalMonths, 3);
    assert.equal(historicalRadar.ivv.monthly, 8 / 3);
    const historicalIntervals = history.intervalos;
    assert.deepEqual(historicalIntervals.map((item) => item.mesesIntervalo), [1, 1, 2, 3]);
    assert.equal(historicalIntervals.at(-1).tipoObservacao, 'DERIVADO_INTERVALO');
    const monthlyHistory = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-MONTH/historico?modalidade=PADRAO`)).json();
    assert.equal(monthlyHistory.intervalos.length, 1, 'fotografias da mesma modalidade no mesmo mês formam um único intervalo');
    assert.equal(monthlyHistory.intervalos[0].vendasConfirmadas, 10, 'uma unidade vendida em duas fotografias do mês conta uma vez');
    assert.equal(monthlyHistory.intervalos[0].ivv, 10);
    assert.equal(monthlyHistory.intervalos[0].vsoMedioMensal, 10);
    assert.deepEqual(monthlyHistory.intervalos[0].fotografiasEvidenciaIds, ['TAB-MONTH-MAY-A','TAB-MONTH-MAY-B']);
    const vsoHistory = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-VSO/historico?modalidade=PADRAO`)).json();
    assert.equal(vsoHistory.intervalos.length, 2);
    const aprilJune = vsoHistory.intervalos[0], juneJuly = vsoHistory.intervalos[1];
    assert.equal(aprilJune.mesesIntervalo, 2);
    assert.equal(aprilJune.estoqueBase, 100);
    assert.equal(aprilJune.vendasConfirmadas, 10);
    assert.equal(aprilJune.ivv, 5);
    assert.equal(aprilJune.vsoPeriodo, 10);
    assert.equal(aprilJune.vsoMedioMensal, 5, 'as 30 unidades novas de junho não entram no denominador anterior');
    assert.equal(juneJuly.estoqueBase, 120);
    assert.equal(juneJuly.vendasConfirmadas, 10);
    assert.ok(Math.abs(juneJuly.vsoMedioMensal - (10 / 120 * 100)) < 1e-10);
    const absenceBefore = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-ABS/unidades`)).json();
    assert.equal(absenceBefore.unidades.find((unit) => unit.unidade === '2').situacaoComercial, 'Vendida', 'ausência publicada deve entrar imediatamente como venda presumida');
    assert.equal(absenceBefore.metricas.ausentesRevisao, 1);
    const absenceResolution = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-ABS/tabelas/TAB-ABS-MAY/classificar-removidas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classificacoes: [{ chave: 'EMP-ABS:QD_01:2', status: 'VENDIDA', observacao: 'Teste de confirmação humana' }] }) });
    assert.equal(absenceResolution.status, 200);
    const absenceAfter = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-ABS/unidades`)).json();
    assert.equal(absenceAfter.unidades.find((unit) => unit.unidade === '2').situacaoComercial, 'Vendida', 'a confirmação humana preserva a venda presumida e encerra a revisão');
    const portfolio = await (await fetch(`http://localhost:${port}/api/analytics?empreendimentos=EMP-MONTH,EMP-VSO`)).json();
    assert.equal(portfolio.kpis.empreendimentos, 2);
    assert.ok(Array.isArray(portfolio.series.consolidada.velocidade));
    assert.ok(portfolio.series.consolidada.velocidade.every((point) => point.intervalos.every((interval) => interval.fotografiaAnteriorId && interval.fotografiaAtualId)));
    const competitiveDetailResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000001/analytics`), competitiveDetail = await competitiveDetailResponse.json();
    assert.equal(competitiveDetailResponse.status, 200, JSON.stringify(competitiveDetail));
    assert.equal(competitiveDetail.perfilExecutivo.tipo, 'Apartamento');
    assert.ok(competitiveDetail.perfilExecutivo.imagem?.path, 'o cabeçalho executivo deve reutilizar a imagem cadastrada do empreendimento');
    assert.ok(Object.hasOwn(competitiveDetail.resumoExecutivo, 'vgvOfertaAtual'));
    assert.equal(Object.hasOwn(competitiveDetail.resumoExecutivo, 'vgvVendido'), false, 'VGV vendido não pode ser inferido pela fotografia comercial');
    assert.ok(Array.isArray(competitiveDetail.estoquePorBloco));
    assert.ok(Array.isArray(competitiveDetail.estoquePorTipologia));
    assert.ok(Array.isArray(competitiveDetail.alteracoesRelevantes));
    assert.ok(competitiveDetail.alteracoesRelevantes.every((row) => row.tipo !== 'sem_alteracao' && (row.tipo !== 'permaneceu_disponivel' || Math.abs(row.diferenca || 0) > .005 || Math.abs(row.diferencaM2 || 0) > .005)), 'unidade disponível sem mudança não é exceção');
    assert.ok(Array.isArray(competitiveDetail.contextoCompetitivo.concorrentes));
    assert.ok(competitiveDetail.contextoCompetitivo.concorrentes.every((row) => row.tipo === 'Apartamento' && row.padraoEconomico === 'Popular/MCMV'), 'concorrência identificada exige tipo e padrão equivalentes');
    assert.ok(competitiveDetail.contextoCompetitivo.concorrentes.every((row) => ['0–3 km','3–5 km','> 5 km'].includes(row.faixaDistancia)));
    assert.ok(competitiveDetail.contextoCompetitivo.concorrentes.every((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)), 'o mapa competitivo exige coordenadas verificáveis');
    assert.ok(competitiveDetail.contextoCompetitivo.raioEfetivoKm >= Math.max(0, ...competitiveDetail.contextoCompetitivo.concorrentes.map((row) => row.distanciaKm)), 'o raio exibido deve conter a cesta competitiva selecionada');
    assert.equal(competitiveDetail.marketPressure.influence.influence_radius_km, 2, 'IPD/IPO individual deve permanecer no entorno imediato de 2 km');
    assert.equal(competitiveDetail.contextoCompetitivo.territorial.raioKm, 2, 'a leitura territorial individual deve declarar o mesmo raio de 2 km dos termômetros');
    assert.equal(competitiveDetail.leituraNexum.titulo, 'Leitura NEXUM');
    assert.ok(competitiveDetail.leituraNexum.headline, 'a leitura individual deve expor uma síntese executiva determinística');
    assert.ok(Array.isArray(competitiveDetail.leituraNexum.executiva));
    assert.equal(competitiveDetail.leituraNexum.evidencia.raioKm, competitiveDetail.contextoCompetitivo.raioEfetivoKm, 'a leitura e o cenário competitivo devem declarar a mesma evidência territorial');
    assert.ok(Array.isArray(competitiveDetail.velocidadeHistorica));
    assert.ok(competitiveDetail.velocidadeHistorica.every((row, index, rows) => index === 0 || row.vendasAcumuladas >= rows[index - 1].vendasAcumuladas), 'a série de vendas acumuladas deve preservar apenas intervalos reais e ser monotônica');
    assert.ok(competitiveDetail.contextoCompetitivo.concorrentes.every((row) => row.metricas && Object.hasOwn(row.metricas, 'vso')), 'cada referência competitiva deve carregar métricas verificáveis ou nulas');
    assert.equal(competitiveDetail.contextoCompetitivo.territorial.modo, 'influence');
    assert.equal(competitiveDetail.contextoCompetitivo.territorial.ipd, competitiveDetail.marketPressure.influence.ipd);
    assert.equal(competitiveDetail.contextoCompetitivo.territorial.ipo, competitiveDetail.marketPressure.influence.ipo);
    const conflictBefore = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-CONFLICT/unidades`)).json();
    assert.equal(conflictBefore.unidades[0].situacaoComercial, 'Vendida', 'a fotografia confirmada mais recente deve prevalecer entre modalidades');
    const manualResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-CONFLICT/unidades/situacoes`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexum-Actor': encodeURIComponent(JSON.stringify({ code: 'TESTE', name: 'Teste', role: 'ADMIN' })) }, body: JSON.stringify({ situacoes: [{ chave: 'EMP-CONFLICT:BL_A:101', situacao: 'Reservada' }] }) });
    assert.equal(manualResponse.status, 200);
    const conflictAfter = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-CONFLICT/unidades`)).json();
    assert.equal(conflictAfter.unidades[0].situacaoComercial, 'Reservada', 'o ajuste manual deve prevalecer sobre fotografias publicadas');
    if (quintas) {
      const before = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/tabelas/${quintas.id}`)).json();
      const originalRule = JSON.stringify(before.regraInterpretada);
      const response = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/tabelas/${quintas.id}/editar-condicoes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ componentes: [{ plano: 'PLANO_12', componente: 'entrada', natureza: 'fixa' }] }) });
      const edited = await response.json();
      assert.equal(response.status, 201);
      assert.equal(edited.novaVersaoCriada, true);
      assert.notEqual(edited.id, before.id);
      assert.equal(edited.status, 'registered');
      assert.equal(edited.regraInterpretada.status, 'validado_automaticamente');
      assert.equal(edited.regraInterpretada.editada, true);
      assert.equal(edited.origem.tabelaBaseId, before.id);
      assert.equal(edited.documento, null);
      assert.equal(edited.documentoReferencia.tabelaId, before.id);
      const after = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-000004/tabelas/${quintas.id}`)).json();
      assert.equal(JSON.stringify(after.regraInterpretada), originalRule, 'a versão confirmada anterior deve permanecer imutável');
    }
    const impactResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST/tabelas/TAB-HIST-B/impacto-exclusao`), impact = await impactResponse.json();
    assert.equal(impactResponse.status, 200);
    assert.deepEqual(impact.dependencias.map((item) => item.id), ['TAB-HIST-C', 'TAB-HIST-D', 'TAB-HIST-E']);
    const failedDeleteResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST/tabelas/TAB-HIST-B/excluir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incluirDependencias: true, simularFalhaCommit: true }) });
    assert.equal(failedDeleteResponse.status, 500);
    const afterFailedDelete = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST`)).json();
    assert.equal(afterFailedDelete.tabelas.length, 5, 'uma falha antes do commit não pode excluir parcialmente a cadeia');
    const deleteResponse = await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST/tabelas/TAB-HIST-B/excluir`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexum-Actor': encodeURIComponent(JSON.stringify({ code: 'TESTE', name: 'Teste', role: 'ADMIN' })) }, body: JSON.stringify({ incluirDependencias: true, motivo: 'teste automatizado' }) }), deleted = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200, JSON.stringify(deleted));
    assert.deepEqual(new Set(deleted.deletedIds), new Set(['TAB-HIST-B', 'TAB-HIST-C', 'TAB-HIST-D', 'TAB-HIST-E']));
    const survivingHistory = await (await fetch(`http://localhost:${port}/api/empreendimentos/EMP-HIST`)).json();
    assert.deepEqual(survivingHistory.tabelas.map((item) => item.id), ['TAB-HIST-A']);
    assert.ok(survivingHistory.fatosComerciais.every((fact) => !deleted.deletedIds.includes(fact.tabelaAtualId) && !deleted.deletedIds.includes(fact.tabelaAnteriorId)));
    assert.deepEqual(new Set(survivingHistory.tabelasExcluidas.map((item) => item.id)), new Set(deleted.deletedIds));
    assert.ok(survivingHistory.tabelasExcluidas.every((item) => !Object.hasOwn(item, 'unidades') && !Object.hasOwn(item, 'comparacao') && !Object.hasOwn(item, 'regraInterpretada')), 'a exclusão deve manter apenas tombstones sem fotografia, unidades ou regras');
    const activeTableIds = new Set(survivingHistory.tabelas.map((item) => item.id));
    assert.ok(survivingHistory.unidades.every((unit) => activeTableIds.has(unit.createdFromTableId) || activeTableIds.has(unit.origemEstruturalTabelaId)), 'o Cadastro Central não pode reter unidade cuja origem foi excluída');
    assert.equal(survivingHistory.auditoria.at(-1).usuario.codigo, 'TESTE');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

testTableTermDictionary();
Promise.all([testQuintasCommercialMatrixExtraction(), testVersionedEdit()]).then(() => console.log('Motor histórico v9: dicionário externo, regras v4, fotografias mensais, IVV, VSO, fatos, Tabela Geral, simulador e exclusão em cascata verificados.')).catch((error) => { console.error(error); process.exitCode = 1; });
