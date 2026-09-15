'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const R=require('../radar-analysis');
const unit=(id)=>({id:String(id),available:true,price:200000,priceM2:4000});
const entry=(id,performance,exits,available,priceM2)=>({id,name:`Empresa ${id}`,type:'Apartamento',standard:'Popular',city:'CG',neighborhood:'Centro',modality:'CEF',vso:performance,ivv:performance,available,priceM2,history:[{date:'2026-03-01',units:Array.from({length:20},(_,i)=>unit(i))},{date:'2026-06-01',units:Array.from({length:20-exits},(_,i)=>unit(i+exits))}]});
const result=R.analyze([entry('A',10,12,2,4000),entry('B',20,1,300,9000),{...entry('C',null,1,20,5000),history:[]}],{rows:['04','05','06'].map(m=>({month:`2026-${m}`,value:1}))});
const handlers=new Map(),elements=new Map(),points=[],overlay={hidden:true};
const element=(key,extra={})=>{const node={addEventListener:(type,fn)=>handlers.set(`${key}:${type}`,fn),...extra};elements.set(key,node);return node;};
let html='',dialog=null;
const root={
  get innerHTML(){return html;},set innerHTML(value){html=value;handlers.clear();points.length=0;},
  querySelector(selector){
    if(selector==='[data-radar-ranking]'&&html.includes('data-radar-ranking'))return element('ranking');
    if(selector==='[data-radar-focus]'&&html.includes('data-radar-focus>'))return element('focus');
    if(selector==='.radar-six-wrap')return {querySelector:()=>({}),getBoundingClientRect:()=>({width:500})};
    return null;
  },
  querySelectorAll(selector){
    if(selector==='[data-radar-series]')return [...html.matchAll(/data-radar-series="([^"]+)"[^>]*?(checked)?\s*>/g)].map(match=>element(`series-${match[1]}`,{dataset:{radarSeries:match[1]},checked:!!match[2]}));
    if(selector==='[data-radar-focus-id]')return [...html.matchAll(/data-radar-focus-id="([^"]+)"/g)].map(match=>element(`focus-${match[1]}`,{dataset:{radarFocusId:match[1]}}));
    if(selector==='[data-radar-tip]')return [...html.matchAll(/data-radar-tip="([^"]+)"/g)].map((match,i)=>{points.push(match[1]);return element(`point-${i}`,{dataset:{radarTip:match[1]}});});
    return [];
  }
};
const context={document:{getElementById:id=>id==='analytics-overlay'?overlay:id==='radar-analysis-root'?root:null},window:{addEventListener:()=>{}},requestAnimationFrame:fn=>fn()};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../radar-ui.js'),'utf8'),context);
const options={fetchData:async()=>result,openOverlay:(title,subtitle,body)=>{dialog={title,subtitle,body};overlay.hidden=false;}};
const axes=()=>[...html.matchAll(/data-radar-axis="([^"]+)"/g)].map(match=>match[1]);
const ranking=()=>[...html.matchAll(/data-radar-focus-id="([^"]+)"/g)].map(match=>match[1]);
(async()=>{
  await context.window.NexumRadarUI.openRadar(options);
  assert.equal(dialog.title,'Radar');assert.deepEqual(axes(),R.AXES);
  assert.deepEqual(ranking(),['B','A','C']);assert.equal((html.match(/data-series-id=/g)||[]).length,3);
  assert.equal((html.match(/polygon class="radar-ring"/g)||[]).length,5,'Five six-sided SVG score guides are rendered.');
  assert.match(html,/<details class="radar-explanation radar-details"><summary><svg/,'Details are collapsed behind the info button.');
  assert(!html.includes('Desempenho dos principais indicadores'),'Do not repeat the page explanation beside the graph.');
  assert.match(html,/is-incomplete/);assert.match(html,/N\/D/);
  for(const match of html.matchAll(/radar-series is-incomplete[^]*?<path[^>]* d="([^"]*)"/g))assert(!match[1].includes('Z'),'Missing values must not close the polygon.');
  assert.match(html,/radar-series is-complete[^]*?<path[^>]* d="[^"]* Z"/);
  const originalShapes=[...html.matchAll(/data-series-id="([^"]+)"[^]*?<path[^>]* d="([^"]*)"/g)].map(m=>[m[1],m[2]]).sort();
  handlers.get('ranking:change')({target:{value:'iap'}});
  assert.deepEqual(ranking(),['A','B','C']);assert.deepEqual(axes(),R.AXES);
  handlers.get('ranking:change')({target:{value:'coverage'}});
  assert.deepEqual(ranking(),['A','B','C']);assert.deepEqual(axes(),R.AXES);
  assert.deepEqual([...html.matchAll(/data-series-id="([^"]+)"[^]*?<path[^>]* d="([^"]*)"/g)].map(m=>[m[1],m[2]]).sort(),originalShapes,'Ranking must not change the values or polygons.');
  for(const name of ['VSO:','IVV:','Absorção:','Cobertura:','Reajuste vs. IGP-M:','IAP:'])assert(points.some(t=>t.includes(name)),`Missing tooltip ${name}`);
  for(let i=0;i<points.length;i++){assert(handlers.has(`point-${i}:mouseenter`));assert(handlers.has(`point-${i}:focus`));}
  assert(points.some(t=>t.includes('Estoque inicial:')&&t.includes('Estoque final:')&&t.includes('dias observados')));
  assert(points.some(t=>t.includes('IGP-M acumulado:')));
  handlers.get('focus-A:click')();assert.match(html,/<h3>Empresa A<\/h3>/);
  elements.get('series-B').checked=false;handlers.get('series-B:change')();assert(!html.includes('data-series-id="B"'));
  await context.window.NexumRadarUI.openAcceptance(options);
  assert.equal(dialog.title,'Aceitação de Preço');assert(html.includes('Competitividade do preço'));assert(!html.includes('data-radar-axis='));
  assert.match(html,/Referência independente; não integra o IAP/);assert.match(html,/Score/);assert.match(html,/Peso/);
  await context.window.NexumRadarUI.openRadar({...options,fetchData:async()=>({...result,rows:[],rankings:{vso:[]}})});
  assert.match(html,/Nenhum empreendimento/);
  await context.window.NexumRadarUI.openRadar({...options,fetchData:async()=>{throw Error('Falha de teste');}});
  assert.match(html,/Falha de teste/);
  console.log('OK: 6 eixos fixos, seleção múltipla, ranking interativo, séries N/D abertas, tooltips e detalhamento independente.');
})().catch(error=>{console.error(error);process.exitCode=1;});
