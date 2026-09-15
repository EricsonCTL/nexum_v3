'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const SEGMENTS={popular_mcmv:'MCMV / Econômico',medio:'Médio',alto:'Alto'};
const MODEL='parametrica_segmentada';
const SEED='nexum-ivv-v1.1';
const RATES=[
 [18,20,22],[18,20,22],[17,19,21],[16,18,20],
 [15,17,19],[14,16,18],[13,15,17],[12,14,16],
 [11,13,15],[10,12,14],[9,11,13],[8,10,12]
];
function month(value){const raw=String(value||'').slice(0,10),date=new Date(raw+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(raw)&&Number.isFinite(+date)&&date.toISOString().slice(0,10)===raw?date.getUTCFullYear()*12+date.getUTCMonth():null;}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {versions:[],activeId:null,events:[]};throw e;}}
function validatePeriods(periods){
 if(!Array.isArray(periods)||periods.length!==12)throw Error('Informe as 12 faixas e os três padrões.');
 periods.forEach((row,i)=>{for(const segment of Object.keys(SEGMENTS)){
  const rate=row.rates?.[segment];
  if(!finite(rate)||rate<0||rate>.95)throw Error('Faixa '+i+' / '+SEGMENTS[segment]+': informe uma redução entre 0% e 95%.');
 }});
}
// Migração única: preserva as versões históricas e nunca reativa o seed após edição.
function initialize(store){
 if(store.versions.some(v=>v.seedKey===SEED))return store;
 const next=structuredClone(store),stamp=new Date().toISOString(),actor={nome:'NEXUM · curva aprovada pelo operador'};
 const version={id:crypto.randomUUID(),seedKey:SEED,label:'NEXUM v1.1',model:MODEL,
  number:next.versions.length+1,status:'VALIDADA',createdAt:stamp,createdBy:actor,
  validatedAt:stamp,validatedBy:actor,previousVersionId:next.activeId,
  periods:RATES.map((values,indice)=>({indice,inicioMeses:indice*3,fimMeses:indice*3+3,
   faixa:indice*3+'–'+(indice*3+3)+' meses',origem:'TABELA_APROVADA',
   rates:Object.fromEntries(Object.keys(SEGMENTS).map((key,i)=>[key,values[i]/100]))})),
  metodologia:'Curva NEXUM v1.1 paramétrica aprovada: as taxas são reduções positivas. A fotografia vigente é o mês 0 da projeção; a cada bloco de três meses, avança uma faixa da curva. Cada redução incide sobre o IVV do trimestre anterior. Após 36 meses de projeção, mantém o último IVV projetado. IVV real e coordenadas históricas são preservados.'};
 validatePeriods(version.periods);next.versions.push(version);
 next.events.push({action:'initialize_v1.1',at:stamp,actor,versionId:version.id,previousVersionId:next.activeId});
 next.activeId=version.id;return next;
}
function change(store,action,payload,actor){
 const next=structuredClone(store),stamp=new Date().toISOString(),source=next.versions.find(v=>v.id===(payload.id||next.activeId));
 if(action==='activate'){
  if(!source||source.status!=='VALIDADA'||source.model!==MODEL)throw Error('Somente uma curva paramétrica validada pode ser vigente.');
  validatePeriods(source.periods);
  next.events.push({action,at:stamp,actor,versionId:source.id,previousVersionId:next.activeId});
  next.activeId=source.id;return next;
 }
 if(!['calculate','validate','save'].includes(action))throw Error('Ação inválida.');
 // O nome legado da ação é mantido por compatibilidade da API. Apenas copia parâmetros.
 const original=action==='calculate'?next.versions.find(v=>v.id===next.activeId):source;
 if(!original||original.model!==MODEL)throw Error('Selecione uma curva paramétrica.');
 const periods=structuredClone(original.periods);
 if(action==='validate'||action==='save'){
  if(!Array.isArray(payload.values)||payload.values.length!==12)throw Error('Informe as 12 faixas.');
  periods.forEach((row,i)=>{row.rates=payload.values[i];row.origem='MANUAL';});
 }
 validatePeriods(periods);
 const number=next.versions.length+1;
 const version={...original,id:crypto.randomUUID(),number,label:'NEXUM · revisão '+number,
  status:(action==='validate'||action==='save')?'VALIDADA':'REVISAO',createdAt:stamp,createdBy:actor,
  previousVersionId:original.id,periods};
 delete version.seedKey;delete version.validatedAt;delete version.validatedBy;
 if(action==='validate'||action==='save'){version.validatedAt=stamp;version.validatedBy=actor;}
 next.versions.push(version);
 if(action==='save')next.activeId=version.id;
 next.events.push({action,at:stamp,actor,versionId:version.id,previousVersionId:action==='save'?original.id:undefined});return next;
}
function base(store){
 const version=store.versions.find(v=>v.id===store.activeId&&v.status==='VALIDADA'&&v.model===MODEL);
 if(version)validatePeriods(version.periods);
 return {available:!!version,reason:version?null:'Ative uma curva paramétrica em Gestão → Parâmetros → Desaceleração do IVV.',
 escopo:'parametros_por_padrao_independentes_dos_filtros',janelaMeses:36,intervaloMeses:3,pisoIvvProjetado:1,
 modelo:MODEL,versionId:version?.id,versionNumber:version?.number,versionLabel:version?.label,
 segments:SEGMENTS,periods:version?.periods||[],cobertura:{}};
}
function segment(value){
 const normalized=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^pde-/,'').replace(/[\s/]+/g,'_');
 // O cadastro possui "Luxo" como subpadrão. Como a curva aprovada contém
 // três segmentos, ele compartilha o comportamento de Alto sem criar uma
 // quarta curva ou descaracterizar o padrão original do empreendimento.
 const aliases={popular:'popular_mcmv',mcmv:'popular_mcmv',economico:'popular_mcmv',popular_mcmv:'popular_mcmv',medio:'medio',alto:'alto',alto_padrao:'alto',luxo:'alto'};
 return aliases[normalized]||null;
}
function projectedRate(base,reference,monthOffset,standard){
 if(!base?.available)throw Error('Nenhuma curva paramétrica vigente.');
 if(!finite(reference)||reference<0||!Number.isInteger(monthOffset)||monthOffset<0)throw Error('Referência de projeção inválida.');
 const key=segment(standard);if(!key)throw Error('Padrão econômico sem correspondência na curva NEXUM.');
 if(monthOffset===0)return reference;
 // A curva sempre parte da fotografia vigente: meses 1–3 usam a primeira
 // faixa; 4–6, a segunda. Cada redução incide no trimestre anterior.
 // Encerradas as faixas aprovadas, mantém o último IVV calculado.
 const index=Math.min(base.periods.length-1,Math.floor((monthOffset-1)/3));
 let projected=reference;
 for(let stage=0;stage<=index;stage++){
  const rate=base.periods[stage]?.rates?.[key];
  if(!finite(rate)||rate<0||rate>.95)throw Error('Curva vigente contém redução inválida.');
  const next=projected*(1-rate);
  if(!finite(next)||next>projected)throw Error('Falha de validação: IVV projetado crescente.');
  projected=next;
 }
 return projected;
}
module.exports={initialize,read,change,base,projectedRate,month,segment,SEGMENTS};
