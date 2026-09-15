(function () {
  'use strict';
  const axes = [
    {key:'vso',label:'VSO',kind:'Observado/derivado',description:'Velocidade de vendas em relação à oferta. Reutiliza o VSO mensal calculado pelo NEXUM.'},
    {key:'ivv',label:'IVV',kind:'Observado/derivado',description:'Índice de velocidade de vendas conforme o serviço atual do NEXUM, expresso em unidades por mês. Não é substituído pelo VSO.'},
    {key:'absorption',label:'Absorção',kind:'Estimado',description:'(Estoque disponível inicial − estoque disponível final) ÷ dias observados × 30,44. É a absorção estimada por movimentação de disponibilidade, não venda comprovada; novas entradas também afetam o saldo.'},
    {key:'coverage',label:'Cobertura',kind:'Estimado',description:'Estoque disponível atual ÷ absorção mensal estimada. Quanto menor a cobertura, melhor. Sem ritmo de absorção, não há prazo finito estimável.'},
    {key:'adjustment',label:'Reajuste vs. IGP-M',kind:'Observado/derivado',description:'Mediana do reajuste de unidades comparáveis menos o IGP-M acumulado, em pontos percentuais. O índice é referência, não obrigação de reajuste. Score maior indica menor distância da referência.'},
    {key:'iap',label:'IAP',kind:'Composto/analítico',description:'Índice de 0 a 100 pontos: preço competitivo 30%, VSO 25%, IVV 15%, absorção 15%, cobertura 15%. Não é percentual de compradores nem preço efetivamente realizado.'}
  ];
  const colors=['#6427ff','#00b99a','#247cff','#ff9029','#e94898','#497d94','#8c8530','#9b55b0'];
  const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,digits=1)=>valid(v)?Number(v).toLocaleString('pt-BR',{maximumFractionDigits:digits}):'N/D';
  const pct=v=>valid(v)?`${v>0?'+':''}${num(v)}%`:'N/D';
  const cash=v=>valid(v)?Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'N/D';
  const date=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'N/D';
  const axis=key=>axes.find(item=>item.key===key);
  let state={data:null,rankBy:'vso',selected:new Set(),focused:null,mode:'radar',version:0,options:null};
  const host=()=>document.getElementById('radar-analysis-root');
  const isOpen=()=>host()&&!document.getElementById('analytics-overlay').hidden;
  const sortedRows=()=>{const byId=new Map(state.data.rows.map(row=>[row.id,row]));return (state.data.rankings[state.rankBy]||[]).map(id=>byId.get(id)).filter(Boolean);};
  const colorOf=id=>colors[[...state.data.rows].sort((a,b)=>a.id.localeCompare(b.id)).findIndex(row=>row.id===id)%colors.length];

  function realValue(row, key) {
    const value=row.values[key];
    if(!valid(value))return 'N/D';
    if(key==='vso')return `${num(value)}%`;
    if(key==='ivv'||key==='absorption')return `${num(value)} un./mês`;
    if(key==='coverage')return `${num(value)} meses`;
    if(key==='iap')return `${num(value)}/100`;
    return row.adjustment.position==='aligned'?'≈ 0,0 p.p.':`${value<0?'↓ ':value>0?'↑ +':''}${num(value)} p.p.`;
  }
  function reason(row,key) {
    if(key==='absorption')return row.absorption.reason;
    if(key==='coverage')return row.coverage.reason;
    if(key==='adjustment')return row.adjustment.reason;
    if(key==='iap')return `Componentes sem dados: ${row.iap.missing.map(item=>item==='price'?'comparáveis de preço':axis(item)?.label).join(', ')}. Pesos não redistribuídos.`;
    return 'Sem intervalo comercial comparável no período selecionado.';
  }
  function interpretation(row,key) {
    if(!valid(row.values[key]))return reason(row,key);
    if(key==='iap')return `${row.iap.band} aceitação relativa`;
    if(key==='adjustment')return row.adjustment.position==='aligned'?'Reajuste alinhado ao IGP-M (tolerância de arredondamento).':row.values[key]<0?'Abaixo do IGP-M':'Acima do IGP-M';
    if(key==='absorption')return `${row.values.absorption<0?'Aumento líquido de disponibilidade':row.values.absorption===0?'Sem redução líquida de disponibilidade':'Absorção estimada por movimentação de disponibilidade'} · ${num(row.absorption.observedDays,0)} dias observados`;
    if(key==='coverage')return row.scores[key]>50?'Cobertura relativamente menor; quanto menor, melhor.':row.scores[key]<50?'Cobertura relativamente maior; quanto menor, melhor.':'Posição intermediária ou sem diferenciação na base.';
    return row.scores[key]>50?'Acima da posição mediana no recorte.':row.scores[key]<50?'Abaixo da posição mediana no recorte.':'Posição intermediária ou sem diferenciação na base.';
  }
  function tooltip(row,key) {
    const definition=axis(key), score=valid(row.scores[key])?`${num(row.scores[key])}/100`:'N/D';
    let text=`${row.name}\n${definition.label}: ${realValue(row,key)}\nScore Radar: ${score}\n${interpretation(row,key)}`;
    if(key==='absorption')text+=`\nEstoque inicial: ${num(row.absorption.initialStock,0)} un.\nEstoque final: ${num(row.absorption.finalStock,0)} un.\nSaldo inicial − final: ${num(row.absorption.absorbedUnits,0)} un.\nPeríodo: ${date(row.absorption.from)} → ${date(row.absorption.to)}\nEstimativa; não representa vendas comprovadas.`;
    if(key==='adjustment')text+=`\nReajuste observado: ${pct(row.adjustment.value)}\nIGP-M acumulado: ${pct(row.adjustment.igpm)}\nPeríodo: ${date(row.adjustment.from)} → ${date(row.adjustment.to)}`;
    return text;
  }

  function radarChart(rows) {
    const cx=320,cy=260,r=204,xy=(radius,index)=>({x:cx+Math.cos(-Math.PI/2+index*Math.PI/3)*radius,y:cy+Math.sin(-Math.PI/2+index*Math.PI/3)*radius});
    const rings=[20,40,60,80,100].map(value=>`<polygon class="radar-ring" points="${axes.map((_,index)=>{const p=xy(r*value/100,index);return `${p.x},${p.y}`;}).join(' ')}"/><text class="radar-scale" x="${cx}" y="${cy-r*value/100+5}" text-anchor="middle">${value}</text>`).join('')+`<text class="radar-scale" x="${cx}" y="${cy+5}" text-anchor="middle">0</text>`;
    const labels=axes.map((item,index)=>{const edge=xy(r,index),label=xy(r+42,index),tip=`${item.label}\n${item.description}\n${rows.map(row=>`${row.name}: ${realValue(row,item.key)}`).join('\n')}`;return `<g data-radar-axis="${item.key}"><line class="radar-axis" x1="${cx}" y1="${cy}" x2="${edge.x}" y2="${edge.y}"/><text class="radar-axis-label" x="${label.x}" y="${label.y}" text-anchor="middle" tabindex="0" data-radar-tip="${escape(tip)}">${item.key==='adjustment'?`<tspan x="${label.x}" dy="-4">Reajuste</tspan><tspan x="${label.x}" dy="15">vs. IGP-M</tspan>`:item.label}<title>${escape(tip)}</title></text></g>`;}).join('');
    const series=rows.map(row=>{
      const points=axes.map((item,index)=>valid(row.scores[item.key])?{...xy(r*row.scores[item.key]/100,index),key:item.key}:null),complete=points.every(Boolean),color=colorOf(row.id);
      let path='';
      if(complete)path=points.map((point,index)=>`${index?'L':'M'}${point.x} ${point.y}`).join(' ')+' Z';
      else points.forEach((point,index)=>{const next=points[(index+1)%6];if(point&&next)path+=`M${point.x} ${point.y} L${next.x} ${next.y} `;});
      return `<g class="radar-series ${complete?'is-complete':'is-incomplete'}" style="--series:${color}" data-series-id="${escape(row.id)}"><path class="radar-six-shape" d="${path}"/>${points.filter(Boolean).map(point=>`<circle class="radar-value-point" cx="${point.x}" cy="${point.y}" r="6.5" tabindex="0" data-radar-tip="${escape(tooltip(row,point.key))}"><title>${escape(tooltip(row,point.key))}</title></circle>`).join('')}</g>`;
    }).join('');
    return `<div class="radar-six-wrap"><svg class="radar-six-chart" viewBox="0 0 640 530" role="img" aria-label="Radar comparativo com seis eixos normalizados de zero a cem">${rings}${labels}${series}</svg><div class="radar-point-tooltip" role="tooltip" hidden></div></div>`;
  }
  function explanation() {
    return `<details class="radar-explanation"><summary>Entenda os indicadores</summary><div>${axes.map(item=>`<article><strong>${item.label} <small>${item.kind}</small></strong><p>${item.description}</p></article>`).join('')}</div><p>${escape(state.data.methodology.normalization)} ${escape(state.data.methodology.adjustment)}</p><p>${escape(state.data.methodology.indexPeriod)} ${escape(state.data.methodology.iap)}</p><p>Preço/m² e IGP-M são dados observados/de referência. O IAP é uma interpretação analítica, não pesquisa de intenção, preço realizado, desconto ou margem.</p><p>Absorção: usa a tabela mais antiga e a mais recente dentro do período selecionado. Saldo = estoque inicial − final; mensalização = saldo ÷ dias × 30,44. Saldo negativo indica aumento de estoque; cobertura só é calculada com absorção positiva. Absorção e cobertura são normalizadas no grupo de produto comparável. Reajustes dentro de ±0,05 p.p. (limite exclusivo) são apresentados como alinhados ao IGP-M.</p></details>`;
  }
  function valueTable(row) {
    return `<section class="radar-observed-values"><header><h3>${escape(row.name)}</h3><small>Valores reais e leitura do empreendimento em foco</small></header><div class="radar-table-scroll"><table><thead><tr><th>Indicador</th><th>Resultado real</th><th>Score</th><th>Interpretação</th></tr></thead><tbody>${axes.map(item=>`<tr><th>${item.label}<small class="radar-kind">${item.kind}</small></th><td title="${escape(tooltip(row,item.key))}">${item.key==='adjustment'?`${pct(row.adjustment.value)} vs. ${pct(row.adjustment.igpm)}<small class="radar-kind">${escape(realValue(row,item.key))}</small>`:escape(realValue(row,item.key))}</td><td>${valid(row.scores[item.key])?num(row.scores[item.key])+'/100':'N/D'}</td><td>${escape(interpretation(row,item.key))}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function adjustmentDetails(row) {
    const item=row.adjustment,gap=item.gap,description=!valid(item.value)?item.reason:!item.event?`Sem reajuste identificado desde ${date(item.monitoredSince)}.`:`Último reajuste observado em ${date(item.event.date)}. Preço sem novo evento identificado desde essa data.`;
    return `<section class="radar-adjustment-detail"><header><h3>Reajuste vs. IGP-M</h3><small>Referência independente; não integra o IAP.</small></header><div class="radar-adjustment-metrics"><article><span>Reajuste observado</span><strong>${pct(item.value)}</strong></article><article><span>IGP-M acumulado</span><strong>${pct(item.igpm)}</strong></article><article><span>Gap</span><strong class="${valid(gap)?item.position==='aligned'?'neutral':gap<0?'negative':'positive':''}">${realValue(row,'adjustment')}</strong></article></div><p>${escape(description)}</p><p>Período da comparação: ${date(item.from)} → ${date(item.to)} · Base: ${escape(item.basis||'N/D')} · ${num(item.comparableUnits,0)} unidades comparáveis.</p>${valid(gap)?`<p>O reajuste observado ficou ${item.position==='aligned'?'alinhado, dentro da tolerância de arredondamento, ao':`${num(Math.abs(gap))} p.p. ${gap<0?'abaixo':'acima'} do`} IGP-M acumulado. O índice é uma referência comparativa, não uma obrigação de reajuste.</p>`:`<p class="radar-data-warning">${escape(item.reason||'Histórico insuficiente para cálculo.')}</p>`}${item.incompleteHistory?'<p class="radar-data-warning">Há lacunas de comparação no histórico; o evento mostrado é o último identificável.</p>':''}<p class="radar-source"><a href="https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarSeries&amp;series=189" target="_blank" rel="noopener">Fonte: FGV · Banco Central, SGS 189</a>${state.data.indexSource.fetchedAt?` · Consulta ${date(state.data.indexSource.fetchedAt)}`:''}</p></section>`;
  }
  function summary(row) {
    if(!valid(row.values.iap))return `IAP indisponível. ${reason(row,'iap')}`;
    const price=row.price.relative<=0?'preço/m² igual ou abaixo da mediana dos comparáveis':'preço/m² acima da mediana dos comparáveis',velocity=row.counts.vso<2?'VSO sem outras observações válidas para diferenciar posições':row.scores.vso>50?'VSO acima da posição mediana':row.scores.vso<50?'VSO abaixo da posição mediana':'VSO em posição intermediária ou sem diferenciação',coverage=row.counts.coverage<2?'cobertura sem outras observações válidas para diferenciar posições':row.scores.coverage>50?'cobertura relativamente menor':row.scores.coverage<50?'cobertura relativamente maior':'cobertura em posição intermediária ou sem diferenciação';
    return `${row.iap.band} aceitação relativa: ${price}, ${velocity} e ${coverage}. Leitura restrita ao grupo e ao período disponíveis; não mede compradores que aceitaram o preço.`;
  }
  function iapDetails(row) {
    return `<section class="radar-iap-detail"><header><div><span>IAP · Índice de Aceitação de Preço</span><h3>${escape(row.name)}</h3></div><div class="radar-iap-score"><strong>${valid(row.values.iap)?num(row.values.iap):'N/D'}${valid(row.values.iap)?'<small>/100</small>':''}</strong><span>${valid(row.values.iap)?`${row.iap.band} aceitação relativa`:'Componentes insuficientes'}</span></div></header><p>${escape(summary(row))}</p><div class="radar-price-reference"><article><span>Preço/m² do empreendimento</span><strong>${cash(row.price.value)}</strong></article><article><span>Mediana dos comparáveis</span><strong>${cash(row.price.reference)}</strong></article></div><p>${escape(row.price.group)} ${row.price.peerCount} comparável(is), excluindo o próprio empreendimento.${row.price.reduced?' Base comparativa reduzida.':''}</p><div class="radar-table-scroll"><table><thead><tr><th>Componente</th><th>Valor real</th><th>Score</th><th>Peso</th></tr></thead><tbody>${row.iap.components.map(item=>`<tr><th>${item.metric==='price'?'Competitividade do preço':axis(item.metric).label}</th><td>${item.metric==='price'?cash(item.value):realValue(row,item.metric)}</td><td>${valid(item.score)?num(item.score)+'/100':'N/D'}</td><td>${num(item.weight*100,0)}%</td></tr>`).join('')}</tbody></table></div><p class="radar-iap-formula">IAP = preço × 0,30 + VSO × 0,25 + IVV × 0,15 + absorção × 0,15 + cobertura × 0,15. Componentes em scores 0–100; IGP-M não integra o cálculo.</p></section>`;
  }
  function render() {
    if(!isOpen()||!state.data)return;
    const rows=sortedRows(),focused=state.data.rows.find(row=>row.id===state.focused)||rows[0];
    if(!rows.length){host().innerHTML='<div class="analytics-empty-chart">Nenhum empreendimento com tabela válida no recorte atual.</div>';return;}
    state.focused=focused.id;
    const warning=state.data.rows.some(row=>row.reduced)?'<p class="radar-data-warning">Base comparativa reduzida. Os scores são relativos, não metas absolutas; N/D não equivale a zero.</p>':'';
    const sourceWarning=state.data.indexSource.warning?`<p class="radar-data-warning">${escape(state.data.indexSource.warning)}</p>`:'';
    if(state.mode==='acceptance') {
      host().innerHTML=`<div class="radar-controls"><label>Empreendimento<select data-radar-focus>${rows.map(row=>`<option value="${escape(row.id)}" ${row.id===focused.id?'selected':''}>${escape(row.name)}</option>`).join('')}</select></label></div>${warning}${sourceWarning}<div class="radar-acceptance-grid">${iapDetails(focused)}${adjustmentDetails(focused)}</div>${explanation()}`;
    } else {
      const selected=rows.filter(row=>state.selected.has(row.id));
      host().innerHTML=`<div class="radar-controls"><label>Ranquear por<select data-radar-ranking>${axes.map(item=>`<option value="${item.key}" ${item.key===state.rankBy?'selected':''}>${item.label}</option>`).join('')}</select></label></div><section class="radar-six-layout">${radarChart(selected)}<section class="radar-ranking" aria-label="Ranking e legenda dos empreendimentos"><h3>Ranking — ${axis(state.rankBy).label}</h3>${rows.map((row,index)=>{const missing=axes.filter(item=>!valid(row.values[item.key])).length,color=colorOf(row.id);return `<article class="${row.id===focused.id?'is-focused':''}"><label class="radar-series-toggle" style="--series:${color}"><input type="checkbox" data-radar-series="${escape(row.id)}" aria-label="Comparar ${escape(row.name)}" ${state.selected.has(row.id)?'checked':''}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg></label><span class="radar-rank-number">${index+1}</span><button type="button" data-radar-focus-id="${escape(row.id)}" aria-pressed="${row.id===focused.id}">${escape(row.name)}${missing?`<small>${missing} indicador(es) N/D</small>`:''}</button><strong>${escape(realValue(row,state.rankBy))}</strong></article>`;}).join('')}<p class="radar-legend-hint">Clique na cor para mostrar ou ocultar a série.</p></section></section><div class="radar-footnote">${!selected.length?'Selecione um empreendimento para comparar.':'Escala 0–100 · Linhas interrompidas: indicador N/D.'}${state.data.rows.some(row=>row.reduced)?' Base comparativa reduzida.':''}</div><details class="radar-explanation radar-details"><summary><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7v.5"/></svg>Detalhes</summary><div>${warning}${sourceWarning}${valueTable(focused)}<div class="radar-acceptance-grid">${iapDetails(focused)}${adjustmentDetails(focused)}</div>${explanation()}</div></details>`;
    }
    bind();
  }
  function bind() {
    host().querySelector('[data-radar-ranking]')?.addEventListener('change',event=>{state.rankBy=event.target.value;render();});
    host().querySelector('[data-radar-focus]')?.addEventListener('change',event=>{state.focused=event.target.value;render();});
    host().querySelectorAll('[data-radar-series]').forEach(input=>input.addEventListener('change',()=>{input.checked?state.selected.add(input.dataset.radarSeries):state.selected.delete(input.dataset.radarSeries);render();}));
    host().querySelectorAll('[data-radar-focus-id]').forEach(button=>button.addEventListener('click',()=>{state.focused=button.dataset.radarFocusId;state.selected.add(state.focused);render();}));
    const wrap=host().querySelector('.radar-six-wrap'),tip=wrap?.querySelector('.radar-point-tooltip');
    host().querySelectorAll('[data-radar-tip]').forEach(point=>{
      const show=()=>{tip.textContent=point.dataset.radarTip;tip.hidden=false;const parent=wrap.getBoundingClientRect(),rect=point.getBoundingClientRect();tip.style.left=`${Math.max(0,Math.min(parent.width-tip.offsetWidth,rect.x-parent.x+8))}px`;tip.style.top=`${Math.max(0,rect.y-parent.y-tip.offsetHeight-8)}px`;};
      point.addEventListener('mouseenter',show);point.addEventListener('focus',show);point.addEventListener('mouseleave',()=>tip.hidden=true);point.addEventListener('blur',()=>tip.hidden=true);
    });
  }
  async function load(resetSelection=false) {
    const version=++state.version;
    if(host())host().innerHTML='<div class="analytics-empty-chart" role="status">Calculando indicadores e consultando o IGP-M…</div>';
    try{
      const data=await state.options.fetchData();if(version!==state.version||!isOpen())return;
      state.data=data;
      if(resetSelection)state.selected=new Set(data.rankings.vso||[]);
      else state.selected=new Set([...state.selected].filter(id=>data.rows.some(row=>row.id===id)));
      if(!data.rows.some(row=>row.id===state.focused))state.focused=data.rankings.vso?.[0]||null;
      render();
    }catch(error){if(version===state.version&&isOpen())host().innerHTML=`<div class="notice error">${escape(error.message||'Não foi possível carregar os indicadores.')}</div>`;}
  }
  function open(options,mode) {
    state.options=options;state.mode=mode;state.rankBy='vso';state.focused=null;
    options.openOverlay(mode==='radar'?'Radar':'Aceitação de Preço',mode==='radar'?'Compare o desempenho dos principais indicadores dos empreendimentos.':'Posicionamento de preço, desempenho comercial e contexto do reajuste observado.',`<div id="radar-analysis-root" data-mode="${mode}"></div>`);
    return load(true);
  }
  window.addEventListener('nexum:global-filters',()=>{if(isOpen())requestAnimationFrame(()=>load(false));});
  window.addEventListener('nexum:enterprise-selection',()=>{if(isOpen())requestAnimationFrame(()=>load(false));});
  window.NexumRadarUI={openRadar:options=>open(options,'radar'),openAcceptance:options=>open(options,'acceptance')};
})();
