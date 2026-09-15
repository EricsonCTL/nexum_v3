(() => {
  const names={incc:'INCC — Índice Nacional de Custo da Construção',cub:'CUB-PB — média dos padrões oficiais',igpm:'IGP-M — Índice Geral de Preços do Mercado',ipca:'IPCA — Índice Nacional de Preços ao Consumidor Amplo'};
  const shortNames={incc:'INCC-M',cub:'CUB-PB (média)',igpm:'IGP-M',ipca:'IPCA'};
  const percent=value=>typeof value==='number'&&Number.isFinite(value)?`${(value*100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:'—';
  const signedPoints=value=>typeof value==='number'&&Number.isFinite(value)?`${value>=0?'+':''}${(value*100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} p.p.`:'—';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=(name)=>{
    const paths={
      mark:'<path d="M3 19h3v-5H3v5Zm5 0h3V9H8v10Zm5 0h3V4h-3v15Zm5 0h3v-8h-3v8Z" fill="currentColor"/>',
      trend:'<path d="M4 18 9 13l4 3 7-8"/><path d="M15 8h5v5"/><path d="M4 21h17"/>',
      market:'<path d="M5 20V10m5 10V4m5 16v-7m5 7V7"/><path d="M3 20h18"/>',
      compare:'<path d="M7 7h12l-3-3m3 3-3 3M17 17H5l3 3m-3-3 3-3"/>',
      cost:'<path d="M4 17c3 2 13 2 16 0"/><path d="M6 13c2 2 10 2 12 0"/><path d="m8 9 4-5 4 5"/><path d="M12 4v12"/>',
      economy:'<path d="M4 20h16"/><path d="M6 18v-5m4 5V8m4 10v-7m4 7V4"/><path d="m5 10 4-3 4 2 6-5"/>',
      bulb:'<path d="M9 18h6m-5 3h4"/><path d="M8 15.5c-1.3-1.1-2-2.7-2-4.4a6 6 0 0 1 12 0c0 1.7-.7 3.3-2 4.4-.8.7-1.2 1.3-1.3 2.5H9.3c-.1-1.2-.5-1.8-1.3-2.5Z"/>',
      info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5V16m0-8.7h.01"/>',
      calendar:'<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3v5m8-5v5M4 10h16"/>',
      close:'<path d="m6 6 12 12M18 6 6 18"/>'
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false">${paths[name]||paths.info}</svg>`;
  };
  const info=label=>`<span class="reajuste-info" title="${escape(label)}" aria-label="${escape(label)}">${icon('info')}</span>`;
  const requests=new Map();
  function get(months){const key=String(months);if(!requests.has(key))requests.set(key,fetch(`/api/reajuste-reference?months=${encodeURIComponent(months)}`).then(async response=>{if(!response.ok)throw new Error('Não foi possível consultar os índices.');return response.json();}).catch(error=>{requests.delete(key);throw error;}));return requests.get(key);}
  function renderFipezap(data){
    const cities=(data?.cities||[]).sort((a,b)=>['Campina Grande','João Pessoa','Brasil'].indexOf(a.cidade)-['Campina Grande','João Pessoa','Brasil'].indexOf(b.cidade));
    return `<section class="reajuste-fipezap" aria-label="Referência de Mercado — FipeZAP"><header><h3>FipeZAP <small>· variação nos últimos 12 meses</small></h3><span>Referência comparativa · não participa do Índice NEXUM</span></header><div class="reajuste-fipezap-cities">${cities.map(city=>{const variation=city.variacao_12m_display||(city.available?percent(city.variacao_12m_pct/100):'—'),detail=[city.preco_m2_display,city.variacao_ytd_display||null].filter(Boolean).join(' · ');return `<article><strong>${escape(city.cidade)}</strong><b>${escape(variation)}</b><small>${detail?escape(detail):city.competencia?escape(city.competencia)+' · últimos 12 meses':'Últimos 12 meses · competência não cadastrada'}</small><small>${escape(city.observacao||('Fonte: '+(city.fonte||'FipeZAP')))}</small></article>`;}).join('')}</div>${data?.warnings?.length?`<details><summary>Avisos da tabela de apoio (${data.warnings.length})</summary>${data.warnings.map(w=>`<p>${escape(w)}</p>`).join('')}</details>`:''}</section>`;
  }
  function renderCompactResult(data,months,fipezap){
    const components=data.components||[],blocks=data.blocks||{},portfolio=data.portfolio||{};
    const portfolioPeriod=portfolio.period,difference=portfolioPeriod!=null&&data.period!=null?portfolioPeriod-data.period:null;
    const component=key=>components.find(item=>item.key===key)||{};
    const incc=component('incc').accumulated,cub=component('cub').accumulated,ipca=component('ipca').accumulated,igpm=component('igpm').accumulated;
    const indicator=(key)=>{const item=component(key);return `<article class="reajuste-indicator"><span>${escape(shortNames[key]||key)}</span><strong>${percent(item.accumulated)}</strong><small>${escape(item.from||'—')} a ${escape(item.to||'—')}</small></article>`;};
    const block=(kind,title,description,value,formula)=>`<article class="reajuste-composition-row ${kind}"><div><span>${title}</span><small>${description}</small></div><b>${value}</b><em>${formula}</em></article>`;
    return `<section class="reajuste-results reajuste-economics-layout" aria-live="polite">
      <div class="reajuste-top-cards">
        <article class="reajuste-top-card portfolio"><header><i>${icon('trend')}</i><div><h3>Reajuste médio da carteira</h3><p>NEXUM · reajuste observado</p></div></header><strong>${percent(portfolioPeriod)}</strong><span>em ${months} ${months===1?'mês':'meses'}</span><p class="reajuste-card-formula">${percent(portfolio.monthly)} a.m. → ${percent(portfolioPeriod)} em ${months} meses</p><small>${portfolio.enterprises||0} empreendimento(s) com reajuste positivo e comparável.</small></article>
        <article class="reajuste-top-card market"><header><i>${icon('market')}</i><div><h3>Índice NEXUM</h3><p>Reajuste Estrutural de Referência</p></div></header><strong>${data.available?percent(data.period):'—'}</strong><span>em ${months} ${months===1?'mês':'meses'}</span><p class="reajuste-card-formula">${percent(data.monthly)} a.m. · cálculo no período selecionado</p><small>Custo e pressão econômica da construção.</small></article>
        <article class="reajuste-top-card difference"><header><i>${icon('compare')}</i><div><h3>Diferença</h3><p>Carteira vs. Índice NEXUM</p></div></header><strong>${difference==null?'—':signedPoints(difference)}</strong><span>no período de ${months} meses</span><p>${difference==null?'Sem comparação disponível.':difference>=0?'A carteira teve reajuste superior à referência estrutural.':'A carteira teve reajuste inferior à referência estrutural.'}</p></article>
      </div>
      ${renderFipezap(fipezap)}
      ${data.available?'':`<p class="reajuste-unavailable">${escape(data.reason||'Indicadores insuficientes.')}</p>`}
      <div class="reajuste-bottom-grid">
        <section class="reajuste-composition-panel"><header><i>${icon('cost')}</i><div><h3>Composição do Índice NEXUM <small>· ${months} ${months===1?'mês':'meses'}</small></h3><p>Recompõe o custo da construção e incorpora a pressão adicional do setor.</p></div></header>
          <div class="reajuste-composition-rows">
            ${block('cost','Custo da construção','Média entre INCC e CUB',percent(blocks.constructionCost),`INCC ${percent(incc)} + CUB ${percent(cub)} ÷ 2`)}
            ${block('economy','Pressão econômica','Média entre IPCA e IGP-M',percent(blocks.economicPressure),`IPCA ${percent(ipca)} + IGP-M ${percent(igpm)} ÷ 2`)}
            ${block('sector','Pressão setorial','Ajuste adicional para o setor',signedPoints(blocks.sectorPressure),`máx. entre zero e ${percent(blocks.constructionCost)} − ${percent(blocks.economicPressure)}`)}
          </div>
          <div class="reajuste-index-formula"><span>Índice NEXUM</span><strong>${percent(blocks.constructionCost)} + ${signedPoints(blocks.sectorPressure)} = ${percent(data.period)}</strong><small>Custo da construção + pressão setorial no período selecionado</small></div>
        </section>
        <section class="reajuste-indicators-panel"><header><i>${icon('economy')}</i><div><h3>Demais indicadores</h3><p>Valores acumulados nos ${months} ${months===1?'mês':'meses'} selecionados.</p></div></header><div class="reajuste-indicator-groups"><section><h4>Custo da construção</h4><div>${indicator('incc')}${indicator('cub')}</div></section><section><h4>Pressão econômica</h4><div>${indicator('igpm')}${indicator('ipca')}</div></section></div></section>
      </div>
      <details class="reajuste-sources"><summary>Fontes e metodologia</summary><p>Índice = custo + máximo(0, custo − pressão econômica). O Índice NEXUM é referência de recomposição estrutural; não é previsão de valorização do imóvel.</p>${components.map(item=>`<p><b>${escape(shortNames[item.key])}</b> · ${escape(item.source||'Fonte indisponível')} · janela: ${escape(item.from||'—')} a ${escape(item.to||'—')}${item.historyGap?' · última janela completa utilizada':''}</p>`).join('')}<p>${escape(data.cubMethod||'')}</p><p>FipeZAP é informativo, lido da tabela de apoio local e não participa do cálculo.</p></details>
    </section>`;
  }
  let footerRevision=0;
  async function refresh(){const revision=++footerRevision;try{const result=await get(6);if(revision!==footerRevision)return;document.querySelectorAll('[data-footer-metric="reference"]').forEach(node=>{node.querySelector('strong').textContent=result.available?percent(result.monthly)+' a.m.':'N/D';node.title=result.available?`Índice NEXUM — Custo e Pressão Econômica · taxa mensal equivalente · ${result.from} a ${result.to} · CUB-PB médio`:(result.reason||'Referência indisponível');});}catch{document.querySelectorAll('[data-footer-metric="reference"] strong').forEach(node=>node.textContent='N/D');}}
  window.openReajusteSimulator=()=>{
    requests.clear();
    const fipezapRequest=fetch('/api/fipezap-reference').then(async r=>{if(!r.ok)throw Error('Referência externa indisponível.');return r.json();}).catch(()=>({cities:['Brasil','João Pessoa','Campina Grande'].map(cidade=>({cidade,available:false,observacao:'Não foi possível ler a referência local.'})),warnings:[]}));
    let dialog=document.getElementById('reajuste-dialog');if(dialog)dialog.remove();dialog=document.createElement('dialog');dialog.id='reajuste-dialog';dialog.className='reajuste-dialog';
    dialog.innerHTML=`<div class="reajuste-modal"><header class="reajuste-modal-header"><button type="button" class="reajuste-close" aria-label="Fechar simulador">${icon('close')}</button><div class="reajuste-modal-title"><div class="reajuste-simulator-intro"><i>${icon('trend')}</i><div><h2>Índice NEXUM</h2><p>Custo e Pressão Econômica</p></div></div><section class="reajuste-period-select"><i>${icon('calendar')}</i><div><strong>Último reajuste há</strong></div><label><input name="months" type="number" min="1" max="12" step="1" inputmode="numeric" value="6" aria-label="Meses desde o último reajuste"> meses</label></section></div></header><main class="reajuste-modal-content"><div class="reajuste-loading">Consultando séries econômicas oficiais…</div></main></div>`;
    document.body.append(dialog);dialog.querySelector('.reajuste-close').onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    let revision=0;
    const periodControl=dialog.querySelector('[name="months"]');
    async function calculate(){const months=Number(periodControl.value),target=dialog.querySelector('.reajuste-modal-content');const run=++revision;if(!Number.isInteger(months)||months<1||months>12){target.innerHTML='<p class="reajuste-unavailable">Informe um período inteiro entre 1 e 12 meses.</p>';return;}target.innerHTML='<div class="reajuste-loading">Consultando séries econômicas oficiais…</div>';try{const [data,fipezap]=await Promise.all([get(months),fipezapRequest]);if(run!==revision)return;target.innerHTML=renderCompactResult(data,months,fipezap);}catch(error){if(run===revision)target.innerHTML=`<p class="reajuste-unavailable">${escape(error.message)}</p>`;}}
    periodControl.onchange=calculate;periodControl.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();calculate();}};dialog.showModal();calculate();
  };
  function mount(){
    if(location.pathname.endsWith('analytics.html')){const nav=document.querySelector('.analytics-v4-actions');if(nav&&!nav.querySelector('[data-reajuste]')){const button=document.createElement('button');button.type='button';button.dataset.reajuste='';button.textContent='Simulador de Reajuste';button.onclick=window.openReajusteSimulator;nav.append(button);}}
    document.querySelectorAll('.footer-metrics-grid').forEach(grid=>{const adjusted=grid.querySelector('[data-footer-metric="adjusted"]');if(adjusted&&!grid.querySelector('[data-footer-metric="reference"]')){const node=adjusted.cloneNode(true);node.dataset.footerMetric='reference';node.querySelector('span').textContent='Índice de referência';node.querySelector('strong').textContent='…';adjusted.after(node);}});
  }
  function initialize(){mount();refresh();let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;mount();const fresh=[...document.querySelectorAll('[data-footer-metric="reference"]')].filter(node=>!node.dataset.loaded);if(fresh.length){fresh.forEach(node=>node.dataset.loaded='1');refresh();}},100);}).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
