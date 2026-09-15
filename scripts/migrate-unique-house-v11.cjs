const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(root, 'data', 'nexo-radar.json');
const sourceDir = path.join(root, 'JSON cadastrados');
const enterpriseId = 'EMP-000023';
const tableId = 'TAB-000064';
const sourceName = fs.readdirSync(sourceDir).find((name) => name.startsWith(`${tableId}_`) && name.endsWith('.json'));
if (!sourceName) throw new Error(`Fonte arquivada de ${tableId} não encontrada.`);

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(sourceDir, sourceName), 'utf8'));
const enterprise = data.empreendimentos.find((item) => item.id === enterpriseId);
const table = enterprise?.tabelas?.find((item) => item.id === tableId);
const sourceUnits = source?.tabela?.unidades || [];
if (!enterprise || !table) throw new Error('Unique House ou sua Tabela Zero não foi encontrado.');
if (sourceUnits.length !== 68 || table.unidades.length !== sourceUnits.length) throw new Error(`Cardinalidade inesperada: fonte=${sourceUnits.length}, tabela=${table.unidades.length}.`);

const sanitize = (value) => String(value || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SEM_VALOR';
const unitKey = (block, unit) => `${enterpriseId}:${sanitize(`Bloco ${block}`)}:${sanitize(unit)}`;
const validityAt = `${table.validityDate}T00:00:00.000Z`;
const confirmedAt = table.validatedAt || table.updatedAt || new Date().toISOString();

table.unidades = table.unidades.map((unit, index) => {
  const origin = sourceUnits[index], apartment = String(origin.apartamento || origin.unidade || '').trim(), block = String(origin.bloco || origin.torre || origin.quadra || '').trim();
  if (!block || apartment !== String(unit.unidade || '').trim()) throw new Error(`A linha ${index + 1} não pôde ser reconciliada com bloco e apartamento.`);
  return {
    ...unit,
    chave:unitKey(block, apartment),
    chaveOrigem:`${block}-${apartment}`,
    agrupadorOriginal:`Bloco ${block}`,
    blocoOriginal:block,
    quadra:`Bloco ${block}`,
    unidade:apartment,
    dormitorios:2,
    vagas:1,
    vagaOriginal:origin.vaga || null,
    linhaOriginal:origin.descricao_original || JSON.stringify(origin)
  };
});

const keys = table.unidades.map((unit) => unit.chave);
if (new Set(keys).size !== 68) throw new Error(`Colisão estrutural após correção: ${new Set(keys).size} chaves para 68 unidades.`);

enterprise.unidades = table.unidades.map((unit) => {
  const status = unit.situacaoExtraida || 'Disponível', value = unit.valorValidado ?? unit.valorInterpretado ?? unit.valorExtraido ?? null;
  const situationEvent = { eventKey:`table:${tableId}:${unit.chave}:${status}`, tipo:'situacao', at:validityAt, confirmadoEm:confirmedAt, tabelaId:tableId, validade:table.validityDate, situacao:status, origem:'tabela_confirmada' };
  const valueEvent = { eventKey:`value:${tableId}:${unit.chave}`, tipo:'valor', at:validityAt, confirmadoEm:confirmedAt, tabelaId:tableId, validade:table.validityDate, valor:value, origem:'tabela_padrao' };
  return {
    chave:unit.chave,
    bloco:unit.quadra,
    agrupadorOriginal:unit.agrupadorOriginal,
    unidade:unit.unidade,
    descricaoExtraida:unit.descricaoExtraida || unit.tipologia || '',
    areaPrivativa:unit.areaPrivativa ?? null,
    vagas:unit.vagas,
    vagaOriginal:unit.vagaOriginal,
    situacaoComercial:status,
    situacaoExtraida:status,
    situacaoOrigem:'tabela_confirmada',
    tabelaStatusAtualId:tableId,
    situacaoAtualizadaEm:validityAt,
    valorAtual:value,
    valorTabelaId:tableId,
    valorAtualizadoEm:validityAt,
    valorExtraido:unit.valorExtraido ?? null,
    valorInterpretado:unit.valorInterpretado ?? value,
    valorValidado:unit.valorValidado ?? value,
    createdFromTableId:tableId,
    updatedAt:validityAt,
    historicoEventos:[situationEvent, valueEvent],
    historicoSituacao:[situationEvent],
    origemEstruturalTabelaId:tableId
  };
});

enterprise.fatosComerciais = table.unidades.map((unit) => {
  const digest = crypto.createHash('sha1').update(`${tableId}|${unit.chave}|UNIDADE_NOVA`).digest('hex').slice(0, 20).toUpperCase();
  return { id:`FAT-${digest}`, tipo:'UNIDADE_NOVA', empreendimentoId:enterpriseId, unidadeChave:unit.chave, modalidade:table.tipoTabela, plano:null, tabelaAnteriorId:null, tabelaAtualId:tableId, dataValidade:table.validityDate, origem:'comparacao_automatica', confirmado:true, confirmadoPor:'sistema', confirmadoEm:confirmedAt, createdAt:confirmedAt, statusAtual:unit.situacaoExtraida, valorAtual:unit.valorValidado ?? unit.valorInterpretado ?? unit.valorExtraido ?? null };
});

table.comparacao = { ...(table.comparacao || {}), previousTableId:null, novas:keys, mantidas:[], removidas:[], retornadas:[], alteracoesValor:[], alteracoesStatus:[], alteracoesAtributos:[], alteracoesComerciais:[] };
table.alertas = (table.alertas || []).filter((alert) => alert.tipo !== 'UNIDADE_DUPLICADA');
table.fatosGeradosIds = enterprise.fatosComerciais.map((fact) => fact.id);
table.regrasComerciais = 'Financiamento pela Caixa Econômica Federal (CEF), enquadrado no Minha Casa Minha Vida (MCMV), com possibilidade de subsídio e entrada reduzida ou zero, sempre sujeita à análise e aprovação de crédito.';
table.observacoes = 'Tabela Zero de julho de 2026 com 68 unidades individualizadas nos blocos A, B e C.';

Object.assign(enterprise, {
  launchDate:'2026-07-01',
  deliveryDate:null,
  prazoEntregaChaves:'Até 90 dias após a assinatura do contrato de compra e a aprovação do financiamento pela Caixa Econômica Federal.',
  statusObra:'ENTREGUE',
  statusObraOrigem:'pesquisada_confirmada',
  statusObraFonte:'Obras 100% finalizadas e empreendimento pronto para morar. Fontes: https://www.instagram.com/reel/DLzydbhAOvG/ ; https://www.facebook.com/p/Total-Construtora-61572619391059/ ; prazo de chaves: https://www.instagram.com/reel/Da7wlilxMjq/',
  statusObraVerificadoEm:new Date().toISOString(),
  percentualObra:100,
  formasPagamento:table.regrasComerciais,
  caracteristicasComerciais:'Empreendimento pronto para morar, com financiamento Caixa/CEF pelo MCMV e entrega das chaves em até 90 dias após contrato e aprovação bancária.',
  observacoes:'Cadastro reconciliado com a Tabela Zero: 68 unidades distribuídas nos blocos A, B e C.',
  caracteristicasImovel:{
    dormitorios:['2'],
    atributos:{ suite:'nao_informado', area_lazer:'nao_informado', piscina:'nao_informado', mobiliado:'nao_informado', financiavel:'sim', condominio_fechado:'nao_informado', vaga_coberta:'nao' },
    vagas:{ possui:'sim', quantidades:['1'] }
  },
  updatedAt:new Date().toISOString()
});

enterprise.auditoria = enterprise.auditoria || [];
enterprise.auditoria.push({ id:crypto.randomUUID(), at:new Date().toISOString(), operacao:'correcao_estrutura_unique_house', usuario:{codigo:'SYSTEM',nome:'Migração NEXUM',perfil:'SYSTEM'}, empreendimentoId:enterpriseId, tabelaId:tableId, motivo:'Blocos A/B/C omitidos na importação causaram colisões de chave.', unidadesFonte:68, unidadesTabela:68, unidadesCadastroCentral:68, criticidadesDuplicidadeRemovidas:28 });
data.version = Math.max(Number(data.version || 0), 11);

const backupDir = path.join(root, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive:true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `nexo-radar.before-unique-house-v11.${timestamp}.json`);
fs.copyFileSync(dataFile, backup);
const temporary = `${dataFile}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
fs.renameSync(temporary, dataFile);
console.log(JSON.stringify({ enterpriseId, tableId, source:sourceName, tableUnits:table.unidades.length, centralUnits:enterprise.unidades.length, distinctKeys:new Set(keys).size, duplicateAlerts:table.alertas.filter((alert) => alert.tipo === 'UNIDADE_DUPLICADA').length, backup }, null, 2));
