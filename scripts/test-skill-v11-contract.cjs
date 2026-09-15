'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validate, importer} = require('../Skill/scripts/validate-nexum-json.cjs');
const root = path.resolve(__dirname, '..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const database = path.join(root, 'data/nexo-radar.json');
const originalHash = hash(database);
const markdown = fs.readFileSync(path.join(root, 'Skill/skill_nexum_empreendimentos_v1.md'), 'utf8');
const examples = [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
const sample = examples.find(example => example.schema === 'nexum-skill-json');
assert.ok(sample, 'Exemplo completo parseável');
let tests = 0;
function check(name, action) { action(); tests++; console.log('OK: ' + name); }
function mutation(change, expected) {
  const input = structuredClone(sample); change(input);
  const report = validate(input);
  assert.equal(report.contrato_compativel, false, expected);
  assert.ok(report.erros.some(item => item.codigo === expected), JSON.stringify(report.erros));
}
check('exemplo V11 lido sem perdas de preço, data, identidade e plano', () => {
  const report = validate(sample);
  assert.equal(report.contrato_compativel, true, JSON.stringify(report));
  assert.equal(report.revisao_necessaria, true, 'Exemplo fictício não é autorização de importação');
  assert.equal(report.cadastro_executado, false);
  assert.equal(report.resumo.chaves_importadas, 1);
  assert.equal(report.resumo.planos_lidos, 1);
  assert.equal(report.resumo.vgv, 60000);
});
check('cadastro proposto preserva datas, características, endereço e textos', () => {
  const input = structuredClone(sample), e = input.empreendimento;
  e.tipo = 'Apartamento'; e.fase = 'Em obras'; e.status_obra = 'EM_OBRAS'; e.percentual_obra = 45;
  e.data_entrega = '2027-12-01';
  e.endereco = {logradouro:'Rua de teste', numero:'10', bairro:'Centro', cidade:'Campina Grande', estado:'PB', cep:'58400000'};
  e.caracteristicas = examples.find(example => example.dormitorios);
  const api = importer(), preview = api.prepareJsonImport(input, 'exemplo.json');
  const draft = api.jsonEnterpriseDraft({}, preview.enterprise, 'TEST-ONLY', '2026-09-11');
  assert.equal(draft.launchDate, '2025-01-01');
  assert.equal(draft.deliveryDate, '2027-12-01');
  assert.equal(draft.statusObra, 'EM_OBRAS');
  assert.equal(draft.percentualObra, 45);
  assert.equal(draft.endereco, 'Rua de teste');
  assert.deepEqual(draft.caracteristicasImovel.dormitorios, ['2']);
  assert.equal(draft.caracteristicasImovel.atributos.suite, 'sim');
  assert.equal(draft.formasPagamento, e.leitura_comercial.formas_pagamento);
});
check('lote e preco_zero não substituem campos de ingestão', () => {
  mutation(s => {const u=s.tabela.unidades[0]; u.lote=u.unidade; delete u.unidade;}, 'IDENTIFICADOR');
  mutation(s => {const u=s.tabela.unidades[0]; u.preco_zero=u.preco; delete u.preco;}, 'VALOR_AUSENTE_INVALIDO');
});
check('data_base, mês não normalizado e data impossível são rejeitados', () => {
  mutation(s => {s.tabela.data_base=s.tabela.data_tabela; delete s.tabela.data_tabela;}, 'DATA');
  mutation(s => {s.empreendimento.data_entrega='12/2027';}, 'DATA');
  mutation(s => {s.tabela.data_tabela='2025-02-30';}, 'DATA');
});
check('entrada específica, planos em objeto e divergências financeiras', () => {
  mutation(s => {s.tabela.unidades[0].condicoes.planos={P12:{meses:12}};}, 'PLANOS_LISTA');
  mutation(s => {s.tabela.unidades[0].condicoes.planos[0].entrada=11999.88;}, 'ENTRADA_POR_PLANO');
  mutation(s => {s.tabela.unidades[0].condicoes.planos[0].mensal.valor=100;}, 'SOMA_PLANO');
});
check('todos os planos alternativos conservam componentes no leitor real', () => {
  const input=structuredClone(sample);
  input.tabela.unidades[0].condicoes=examples.find(example => example.planos);
  const report=validate(input);
  assert.equal(report.contrato_compativel,true,JSON.stringify(report));
  assert.equal(report.resumo.planos_lidos,2);
  const actual=importer().declaredPlans(input.tabela.unidades[0]);
  assert.equal(actual[1].mensais.quantidade,24);
  assert.equal(actual[1].intercaladas.quantidade,2);
  assert.equal(actual[1].intercaladas.valor,6000);
});
check('componentes desconhecidos exigem revisão, não sucesso financeiro', () => {
  const input=structuredClone(sample);
  input.tabela.unidades[0].condicoes.planos[0].financiamento={valor:50000};
  assert.ok(validate(input).revisoes.some(item=>item.codigo==='COMPONENTE_NAO_MAPEADO'));
  mutation(s => {
    const p=s.tabela.unidades[0].condicoes.planos[0];
    p.mensal.intercaladasAnuais={quantidade:3,valor:9000};
    p.intercaladas={quantidade:2,valor:0,periodicidade:'semestral'};
  }, 'COMPONENTE_IMPORTADOR');
});
check('contagem e colisão pós-normalização não desaparecem na importação', () => {
  mutation(s => {
    s.tabela.unidades.push(structuredClone(s.tabela.unidades[0]));
    s.tabela.unidades[0].agrupadorOriginal='Bloco A';
    s.tabela.unidades[1].agrupadorOriginal='Bloco_A';
    s.tabela.unidades_apresentadas=2;s.resumo_comercial.unidades_individualizadas=2;s.resumo_comercial.total_estrutural=2;
  }, 'COLISAO_IMPORTADOR');
});
check('referência compatível preserva identidade e detecta código fora da Zero', () => {
  const reference=structuredClone(sample); reference.tabela.tipo='TABELA_COMERCIAL';reference.tabela.data_tabela='2026-09-01';
  reference.empreendimento.id='EMP-REFERENCE';
  assert.equal(validate(sample,{references:[reference]}).contrato_compativel,true);
  reference.tabela.unidades[0].unidade='99';
  assert.ok(validate(sample,{references:[reference]}).erros.some(item=>item.codigo==='CODIGO_FORA_ZERO'));
  reference.empreendimento.nome='Outro empreendimento';
  assert.ok(validate(sample,{references:[reference]}).erros.some(item=>item.codigo==='REFERENCIA_VINCULO'));
});
check('aliases, origem simulada, remoções sem base e consolidação indevida', () => {
  mutation(s => {s.tabela.unidades[0].situacaoExtraida='Vendida';}, 'ALIAS_CONCORRENTE');
  mutation(s => {delete s.tabela.unidades[0].classificacao;}, 'ORIGEM_SIMULADA');
  mutation(s => {s.comparacao.removidas=['NAO-IDENTIFICADA'];}, 'REMOCAO_SEM_BASE');
  mutation(s => {s.status_processamento='CONSOLIDADO';}, 'CONSOLIDACAO_INDEVIDA');
});
check('null, strings, números inválidos e arrays malformados não viram sucesso', () => {
  mutation(s => {s.tabela.unidades[0].preco=NaN;}, 'VALOR_AUSENTE_INVALIDO');
  mutation(s => {s.tabela.unidades[0].preco='60.000,00';}, 'VALOR_AUSENTE_INVALIDO');
  mutation(s => {s.tabela.unidades[0].preco=null;}, 'VALOR_AUSENTE_INVALIDO');
  mutation(s => {s.pendencias=['Sem fontes'];}, 'ARRAY_OBJETOS');
  mutation(s => {s.tabela.unidades[0].condicoes.planos=[null];}, 'PLANO_OBJETO');
});
check('base persistente não foi alterada', () => assert.equal(hash(database),originalHash));
console.log(`${tests} cenários V11 aprovados; nenhuma importação executada.`);
