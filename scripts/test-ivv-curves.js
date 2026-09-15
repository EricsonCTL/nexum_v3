'use strict';
const assert=require('node:assert/strict');
const Curves=require('../ivv-curves');
const {forecastAbsorption,buildQuarterlySchedule}=require('../ivv-forecast');
const {buildMaturityProjection}=require('../server');

const close=(actual,expected,message='')=>assert(Math.abs(actual-expected)<1e-9,`${message} ${actual} != ${expected}`);
const units=n=>Array.from({length:n},()=>({situacao:'Disponível'}));
const addMonths=(date,months)=>{const value=new Date(`${date}T12:00:00Z`);value.setUTCMonth(value.getUTCMonth()+months);return value.toISOString().slice(0,10);};
const launchDate='2025-01-15';
function enterprise(age,ivv,stock=100,padrao='Popular/MCMV',totalUnits=stock){
  const table={id:'ATUAL',validityDate:addMonths(launchDate,age),status:'registered',tipoTabela:'A_VISTA',unidades:units(stock)};
  const historicalTotal=totalUnits===stock?[]:[{id:'ZERO',validityDate:launchDate,status:'superseded',tipoTabela:'A_VISTA',unidades:units(totalUnits)}];
  return {id:'TEST',padrao,launchDate,tabelas:[...historicalTotal,table],intervalosComerciais:[{ivv,modalidade:'A_VISTA',fotografiaAtualId:table.id}]};
}

let store=Curves.initialize({versions:[],activeId:null,events:[]});
assert.strictEqual(Curves.initialize(store),store,'O seed precisa ser idempotente.');
const base=Curves.base(store);
assert.equal(base.versionLabel,'NEXUM v1.1');
const expected=[[18,20,22],[18,20,22],[17,19,21],[16,18,20],[15,17,19],[14,16,18],[13,15,17],[12,14,16],[11,13,15],[10,12,14],[9,11,13],[8,10,12]];
base.periods.forEach((row,index)=>Object.keys(Curves.SEGMENTS).forEach((key,column)=>close(row.rates[key]*100,expected[index][column])));
const savedStore=Curves.change(store,'save',{id:store.activeId,values:base.periods.map(row=>({...row.rates,medio:row.rates.medio}))},{nome:'Teste'});
assert.equal(savedStore.versions.length,2,'Salvar deve criar uma nova versão.');
assert.equal(savedStore.activeId,savedStore.versions.at(-1).id,'A versão salva deve virar vigente.');
assert.equal(savedStore.versions.at(-1).status,'VALIDADA');

const forecast=forecastAbsorption({curve:base,initialIvv:7.5,stock:100,segment:'popular_mcmv'});
close(forecast.audit[0].ivvProjetado,7.5,'T0 não reduz.');
assert.equal(forecast.audit[0].faixa,'0–3 meses');
assert.equal(forecast.audit[1].faixa,'0–3 meses');close(forecast.audit[1].taxaAplicada,-.18);close(forecast.audit[1].reducaoAplicada,.18);close(forecast.audit[1].ivvProjetado,6.15);
assert.equal(forecast.audit[2].faixa,'3–6 meses');close(forecast.audit[2].taxaAplicada,-.18);close(forecast.audit[2].ivvProjetado,5.043);
assert.equal(forecast.audit[3].faixa,'6–9 meses');close(forecast.audit[3].taxaAplicada,-.17);close(forecast.audit[3].ivvProjetado,4.18569);

for(const segment of Object.keys(Curves.SEGMENTS)){
  const result=forecastAbsorption({curve:base,initialIvv:12,stock:180,segment});
  for(let index=1;index<result.audit.length;index+=1)assert(result.audit[index].ivvProjetado<=result.audit[index-1].ivvProjetado,'IVV crescente em '+segment);
  assert.deepEqual(Object.keys(result.series).sort(),['ivv_fixo','ivv_projetado','saldo_ivv_fixo','saldo_ivv_projetado']);
  Object.values(result.series).forEach(series=>assert(series.length>=2&&series.at(-1).saldo===0));
}

const lifeEnterprise=enterprise(3,0,38,'Popular/MCMV');
const life=buildMaturityProjection(lifeEnterprise,lifeEnterprise.tabelas.at(-1),lifeEnterprise.intervalosComerciais.at(-1),base);
assert(life.available);assert.equal(life.ivvSource,'SINTETICO_LANCAMENTO');close(life.initialIvv,1.9);
close(life.memoriaTrimestral[0].ivvProjetado,1.9);close(life.memoriaTrimestral[1].taxaAplicada,-.18);close(life.memoriaTrimestral[1].ivvProjetado,1.558);
close(life.memoriaTrimestral[2].taxaAplicada,-.18);close(life.memoriaTrimestral[2].ivvProjetado,1.27756);

const jardinsEnterprise=enterprise(67,10.134328358209,125,'Médio');
const jardins=buildMaturityProjection(jardinsEnterprise,jardinsEnterprise.tabelas.at(-1),jardinsEnterprise.intervalosComerciais.at(-1),base);
assert(jardins.available);close(jardins.memoriaTrimestral[0].ivvProjetado,10.134328358209);close(jardins.memoriaTrimestral[1].taxaAplicada,-.20);close(jardins.memoriaTrimestral[1].ivvProjetado,10.134328358209*.8);
close(jardins.memoriaTrimestral[2].taxaAplicada,-.20);close(jardins.memoriaTrimestral[2].ivvProjetado,10.134328358209*.8*.8);assert(jardins.projectedDepletionMonths>jardins.actualDepletionMonths);

const low=enterprise(10,.5,50,'Médio');
const unavailable=buildMaturityProjection(low,low.tabelas.at(-1),low.intervalosComerciais.at(-1),base);
assert.equal(unavailable.available,false);assert.match(unavailable.reason,/Dados insuficientes/i);
const withSale=enterprise(3,0,38);withSale.intervalosComerciais[0].vendasConfirmadas=1;
assert.equal(buildMaturityProjection(withSale,withSale.tabelas.at(-1),withSale.intervalosComerciais.at(-1),base).available,false);

const corrupted=structuredClone(base);corrupted.periods[4].rates.popular_mcmv=-.01;
assert.throws(()=>buildQuarterlySchedule({curve:corrupted,initialIvv:7.5,segment:'popular_mcmv',maxHorizonMonths:15}),/Curva NEXUM inválida/);
console.log('OK: forecast prospectivo a partir de T0, piso 1, última faixa única e quatro séries independentes.');
