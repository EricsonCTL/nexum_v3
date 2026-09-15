'use strict';
requireCTIUser(['ADMIN']);
let store={versions:[],events:[],activeId:null},selected=null;
const el=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—',pct=value=>typeof value==='number'?num(value*100)+'%':'—';
function render(){
  el('versions').innerHTML=store.versions.slice().reverse().map(v=>`<option value="${esc(v.id)}">${esc(v.label||'Histórico V'+v.number)} · ${new Date(v.createdAt).toLocaleString('pt-BR')} · ${v.id===store.activeId?'VIGENTE':v.status}</option>`).join('');
  el('versions').value=selected||'';const v=store.versions.find(v=>v.id===selected);
  el('save').disabled=!v||v.model!=='parametrica_segmentada';
  el('status').textContent=v?(v.id===store.activeId?'VIGENTE':v.status):'Nenhuma versão';
  el('metadata').textContent=v?`Criada por ${v.createdBy?.nome||'—'} · ${v.model==='parametrica_segmentada'?'Parâmetros fixos por padrão econômico. O salvamento já torna esta curva vigente.':'Histórico legado: somente consulta.'}`:'Nenhuma versão disponível.';
  el('rows').innerHTML=(v?.periods||[]).map(r=>`<tr><td>${esc(r.faixa)}</td>${['popular_mcmv','medio','alto'].map(key=>`<td>${r.rates?`<input type="number" step="any" min="0" max="95" aria-label="${esc(key)} ${esc(r.faixa)}" data-index="${r.indice}" data-segment="${key}" value="${Number((r.rates[key]*100).toFixed(6))}"> %`:'—'}</td>`).join('')}<td>${esc(r.origem||'Histórico')} ${!r.rates?'· taxa legada '+pct(r.validada):''}</td></tr>`).join('');
  el('method').textContent=v?.metodologia||'';
  el('audit').textContent=(store.events||[]).slice().reverse().map(e=>`${new Date(e.at).toLocaleString('pt-BR')} · ${e.actor?.nome||'—'} · ${e.action} · V${store.versions.find(v=>v.id===e.versionId)?.number||'—'}`).join('\n');
  document.querySelectorAll('[data-index]').forEach(input=>{input.dataset.initial=input.value;input.oninput=()=>input.classList.toggle('manual',input.value!==input.dataset.initial||!!v.periods[Number(input.dataset.index)].alteradoManualmente);});
}
async function request(action){
  const payload={action,id:selected};
  if(action==='save'){
    const inputs=[...document.querySelectorAll('[data-index]')];
    if(inputs.some(input=>input.value===''||!input.checkValidity())){el('notice').textContent='Preencha todas as reduções entre 0% e 95% antes de salvar.';return;}
    payload.values=(store.versions.find(v=>v.id===selected)?.periods||[]).map(row=>({...row.rates}));
    inputs.forEach(input=>{payload.values[Number(input.dataset.index)][input.dataset.segment]=Number(input.value)/100;});
  }
  document.querySelectorAll('button').forEach(b=>b.disabled=true);el('notice').textContent='Processando…';
  try{
    const actor=JSON.parse(sessionStorage.getItem('ctiUserSession')||localStorage.getItem('ctiUserSession')||'null');
    const response=await fetch('/api/gestao/ivv-curves',{method:'POST',headers:{'Content-Type':'application/json','x-nexum-actor':encodeURIComponent(JSON.stringify(actor||{}))},body:JSON.stringify(payload)}),data=await response.json();
    if(!response.ok)throw Error(data.error||'Falha ao atualizar curva.');store=data;selected=action==='save'?store.activeId:store.versions.at(-1).id;
    el('notice').textContent=action==='save'?'Nova versão salva e aplicada. As próximas projeções já usarão esta curva vigente.':'Cópia dos parâmetros criada para revisão.';
  }catch(error){el('notice').textContent=error.message;}finally{render();}
}
el('versions').onchange=()=>{selected=el('versions').value;render();};
el('save').onclick=()=>request('save');
fetch('/api/gestao/ivv-curves').then(async r=>{if(!r.ok)throw Error('Não foi possível carregar as versões.');store=await r.json();selected=store.activeId||store.versions.at(-1)?.id;render();}).catch(e=>el('notice').textContent=e.message);
