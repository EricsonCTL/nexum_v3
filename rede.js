(function () {
  'use strict';
  const page = document.body.dataset.redePage;
  const root = document.getElementById('rede-app');
  const fmt = new Intl.NumberFormat('pt-BR');
  const colors = { locacao_ofertada:'#1c8e83', locacao_procurada:'#4b75c9', venda_ofertada:'#dd7b2b', repasse:'#9b5fc0', compra_procurada:'#cf4f5e', permuta:'#7c8997', indefinida:'#9ba6b1' };
  const labels = { locacao_ofertada:'Locação ofertada', locacao_procurada:'Locação procurada', venda_ofertada:'Venda ofertada', repasse:'Repasse', compra_procurada:'Compra procurada', permuta:'Permuta', indefinida:'Indefinida' };
  const ENTERPRISE_STORAGE = 'rede.enterpriseSelection.v1';
  let previewToken = '';
  let gisMap = null;
  let gisEnterprises = [];
  let enterpriseCatalog = [];
  let selectedEnterpriseIds = loadEnterpriseSelection();
  let controlsMounted = false;
  let neighborhoodView = 'dados';
  let brokerTop = '10';

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
  function number(value) { return fmt.format(Number(value || 0)); }
  function dateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }); }
  function currency(value) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value).toLocaleString('pt-BR',{ style:'currency',currency:'BRL',maximumFractionDigits:0 }) : '—'; }
  function loadEnterpriseSelection() { try { const values = JSON.parse(sessionStorage.getItem(ENTERPRISE_STORAGE) || '[]'); return Array.isArray(values) ? values.map(String) : []; } catch (_) { return []; } }
  function persistEnterpriseSelection() { sessionStorage.setItem(ENTERPRISE_STORAGE, JSON.stringify(selectedEnterpriseIds)); }
  window.nexumGetEnterpriseSelection = () => [...selectedEnterpriseIds];
  async function api(url, options) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.'); return payload; }
  function periodBounds(period) {
    if (!period || period === 'all') return {};
    const now = new Date(), month = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`, start = new Date(now);
    if (period === '30d' || period === 'current-month') return { de:month(now), ate:month(now) };
    if (period === '60d') start.setMonth(start.getMonth() - 1);
    else if (period === '90d') start.setMonth(start.getMonth() - 2);
    else if (period === '12m') start.setMonth(start.getMonth() - 11);
    else if (period === 'current-year') return { de:`${now.getFullYear()}-01`, ate:month(now) };
    return { de:month(start), ate:month(now) };
  }
  function query(extra = {}) {
    const filters = window.nexumGlobalFilters || {};
    const accepted = ['search','bairro','tipo','padrao','ticket','dormitorios','caracteristicas','vagas','operacoes'];
    const params = new URLSearchParams({ aplicarPeriodo:'1', ...periodBounds(filters.period), ...extra });
    accepted.forEach((key) => { if (filters[key]) params.set(key, filters[key]); });
    if (selectedEnterpriseIds.length) params.set('empreendimentos', selectedEnterpriseIds.join(','));
    return params;
  }
  function header(title, description, filter = true) {
    return `<header class="rede-page-head"><div><span>Rede NEXUM</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div></header><div class="rede-chips" id="rede-filter-chips"></div>`;
  }
  function filterLabel(key, value) {
    const names = { period:'Período',search:'Busca',bairro:'Bairro',tipo:'Tipo',padrao:'Padrão',fase:'Fase',ticket:'Faixa',dormitorios:'Dormitórios',caracteristicas:'Características',vagas:'Vagas',operacoes:'Operações',favorite:'Favoritos' };
    const periods = { '30d':'Últimos 30 dias','current-month':'Mês atual','60d':'Últimos 60 dias','90d':'Últimos 90 dias','12m':'Últimos 12 meses','current-year':'Ano corrente' };
    return `${names[key] || key}: ${key === 'period' ? (periods[value] || value) : value === true ? 'Somente favoritos' : String(value).replaceAll(',', ', ')}`;
  }
  function renderFilterChips() {
    const chips = document.getElementById('rede-filter-chips');
    if (!chips) return;
    chips.replaceChildren();
    const add = (label, handler) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'rede-chip';
      button.innerHTML = `<span>${esc(label)}</span><b aria-hidden="true">×</b>`;
      button.onclick = handler; chips.append(button);
    };
    enterpriseCatalog.filter((item) => selectedEnterpriseIds.includes(String(item.id))).forEach((item) => add(`Empreendimento: ${item.nome}`, () => {
      selectedEnterpriseIds = selectedEnterpriseIds.filter((id) => id !== String(item.id)); persistEnterpriseSelection(); window.dispatchEvent(new CustomEvent('rede:enterprise-selection'));
    }));
    Object.entries(window.nexumGlobalFilters || {}).filter(([key,value]) => value && !(key === 'period' && value === '12m')).forEach(([key,value]) => add(filterLabel(key, value), () => {
      window.nexumSetGlobalFilters?.({ ...(window.nexumGlobalFilters || {}), [key]:key === 'period' ? '12m' : key === 'favorite' ? false : '' });
    }));
  }
  function mountRedeControls() {
    if (controlsMounted) { renderFilterChips(); return; }
    controlsMounted = true;
    const controls = document.createElement('section');
    controls.id = 'rede-floating-actions'; controls.setAttribute('aria-label','Controles da Rede');
    controls.innerHTML = '<button type="button" class="nexum-floating-action rede-enterprise-fab" id="rede-enterprise-trigger" aria-label="Empreendimentos" title="Empreendimentos" data-tooltip="Empreendimentos"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 21V4.5L12 2v19"/><path d="M12 21h8V7l-8-2.5"/><path d="M7 7h2M7 11h2M7 15h2M15 10h2M15 14h2M15 18h2"/></svg></button><button type="button" class="nexum-floating-action rede-filter-fab" id="rede-filter-trigger" aria-label="Filtros" title="Filtros" data-tooltip="Filtros"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 5H20L14 12V18L10 20V12L4 5Z"/></svg></button>';
    document.body.append(controls);
    const clearAll = document.getElementById('nexum-clear-all-filters'); if (clearAll) controls.append(clearAll);
    window.mountNexumEnterpriseSelector?.(document.getElementById('rede-enterprise-trigger'));
    window.mountNexumGlobalFilters?.(document.getElementById('rede-filter-trigger'));
    window.addEventListener('nexum:enterprise-selection', (event) => {
      selectedEnterpriseIds = [...new Set((event.detail?.ids || []).map(String))]; persistEnterpriseSelection(); window.dispatchEvent(new CustomEvent('rede:enterprise-selection'));
    });
    window.addEventListener('nexum:clear-enterprise-selection', () => {
      if (!selectedEnterpriseIds.length) return;
      selectedEnterpriseIds = []; persistEnterpriseSelection(); window.dispatchEvent(new CustomEvent('rede:enterprise-selection'));
    });
    api('/api/empreendimentos').then((rows) => { enterpriseCatalog = rows || []; renderFilterChips(); }).catch(() => {});
  }
  function bindFilters() { mountRedeControls(); renderFilterChips(); }
  function bars(rows, maxValue) {
    const max = maxValue || Math.max(1, ...rows.map((item) => Number(item.value || 0)));
    return rows.map((item) => `<div class="rede-bar-row"><span><i class="rede-operation-dot" style="background:${esc(item.color || '#07877f')}"></i>${esc(item.label)}</span><i><b style="width:${Math.max(0, Math.min(100, Number(item.value || 0) / max * 100))}%;background:${esc(item.color || '#07877f')}"></b></i><strong>${number(item.value)}</strong></div>`).join('');
  }
  function renderRedeFooter(data) {
    let footer = document.getElementById('rede-footer');
    if (!footer) { footer = document.createElement('footer'); footer.id = 'rede-footer'; footer.className = 'rede-footer'; document.body.append(footer); }
    const market = data?.marketSummary || {};
    const icons = {
      records: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>',
      neighborhoods: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 19 9 5l6 14 5-14"/><path d="M6 14h12"/></svg>',
      saleSupply: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="m4 15 5-5 4 4 7-8M15 6h5v5"/></svg>',
      saleDemand: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><circle cx="10" cy="10" r="5"/><path d="m14 14 5 5M10 7v6M7 10h6"/></svg>',
      rentSupply: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 20h16M6 20V8l6-4 6 4v12M9 20v-5h6v5"/></svg>',
      rentDemand: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 19a7 7 0 1 1 14 0M12 12V5M9 8l3-3 3 3"/></svg>'
    };
    const metric = (icon, label, value) => `<div class="rede-footer-metric"><i aria-hidden="true">${icons[icon]}</i><span>${esc(label)}</span><strong>${value}</strong></div>`;
    footer.innerHTML = `${metric('records','Registros',number(data?.gis?.totalRecords || data?.meta?.analyticalOpportunities))}${metric('neighborhoods','Bairros',number(data?.gis?.totalNeighborhoods))}${metric('saleSupply','Vendas (Oferta)',currency(market.saleSupplyTicket))}${metric('saleDemand','Compras (Demanda)',currency(market.saleDemandTicket))}${metric('rentSupply','Locação (Oferta)',currency(market.rentSupplyTicket))}${metric('rentDemand','Locação (Demanda)',currency(market.rentDemandTicket))}<p>© Ericson Tenório 2026.<br>Todos os direitos reservados.</p>`;
  }
  function refreshRedeFooter() { api(`/api/rede-corretores?${query({ top:10 })}`).then(renderRedeFooter).catch(() => {}); }

  async function renderMarkets() {
    root.innerHTML = `${header('Mercados','Oferta e demanda identificadas nas conversas da rede de corretores.')}<div class="rede-loading">Carregando mercado…</div>`; bindFilters();
    const data = await api(`/api/rede-corretores?${query({ top:10 })}`), counts = data.operationCounts || {};
    const supply = Number(counts.locacao_ofertada || 0) + Number(counts.venda_ofertada || 0) + Number(counts.repasse || 0);
    const demand = Number(counts.locacao_procurada || 0) + Number(counts.compra_procurada || 0);
    const operations = Object.entries(counts).map(([key,value]) => ({ key, label:labels[key] || key, value, color:colors[key] }));
    root.querySelector('.rede-loading').outerHTML = `<section class="rede-grid rede-kpis"><article class="rede-card rede-total-kpi"><span>Total</span><strong>${number(data.gis?.totalRecords || data.meta?.analyticalOpportunities)}</strong><small>registros no recorte</small></article><article class="rede-card"><span>Oferta</span><strong>${number(supply)}</strong><small>registros no recorte</small></article><article class="rede-card"><span>Demanda</span><strong>${number(demand)}</strong><small>registros no recorte</small></article></section><section class="rede-grid rede-two"><article class="rede-card"><div class="rede-section"><header><div><h2>Operações de mercado</h2><p>Distribuição já classificada pelo motor incorporado.</p></div></header>${bars(operations)}</div></article><article class="rede-card"><div class="rede-section"><header><div><h2>Concentração territorial</h2><p>Bairros com mais registros.</p></div></header>${bars((data.bubbles || []).slice(0,8).map((item) => ({ label:item.bairro, value:item.total })))}</div></article></section><section class="rede-card rede-section"><header><div><h2>Evolução mensal</h2><p>Operações disponíveis nos últimos períodos da base filtrada.</p></div></header>${renderTimeline(data.timeSeries)}</section><p class="rede-note">IPD e IPO continuam usando as fórmulas atuais do NEXUM; somente a base de operações é atualizada pelas importações.</p>`;
    renderRedeFooter(data);
  }
  function renderTimeline(timeSeries) {
    const periods = timeSeries?.periods || [], series = timeSeries?.series || [];
    if (!periods.length) return '<div class="rede-empty">Sem períodos para o recorte selecionado.</div>';
    return `<div class="table-wrap"><table class="rede-table"><thead><tr><th>Período</th>${series.map((item) => `<th class="num">${esc(item.label)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>${periods.map((period,index) => { const values = series.map((item) => Number(item.values?.[index] || 0)); return `<tr><td>${esc(period.label)}</td>${values.map((value) => `<td class="num">${number(value)}</td>`).join('')}<td class="num"><strong>${number(values.reduce((sum,value) => sum + value, 0))}</strong></td></tr>`; }).join('')}</tbody></table></div>`;
  }

  async function renderGis() {
    root.innerHTML = `${header('Mapa GIS','Leitura territorial exclusiva da Rede, separada do mapa original do NEXUM.')}<section class="rede-map-layout"><aside class="rede-card rede-map-controls"><label class="rede-gis-search">Buscar empreendimento, construtora ou bairro<input id="gis-enterprise-search" type="search" placeholder="Buscar no cadastro NEXUM"></label><label>Empreendimento de referência<select id="gis-enterprise"><option value="">Visão geral do mercado</option></select></label><label>Raio territorial<select id="gis-radius"><option value="2">2 km</option><option value="3" selected>3 km</option><option value="5">5 km</option></select></label><p class="rede-note" id="gis-note">Sem empreendimento selecionado, todos os bairros da rede são exibidos.</p><div class="rede-map-legend"><span style="--legend:#1c8e83">Oferta / concentração</span><span style="--legend:#4b75c9">Demanda / concentração</span><span style="--legend:#173f68">Empreendimento selecionado</span></div></aside><div id="rede-gis-map" class="rede-map"></div></section>`; bindFilters();
    gisEnterprises = (await api('/api/empreendimentos')).filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)));
    const select = document.getElementById('gis-enterprise');
    const drawOptions = () => {
      const search = String(document.getElementById('gis-enterprise-search').value || '').trim().toLocaleLowerCase('pt-BR'), previous = select.value;
      const rows = gisEnterprises.filter((item) => !search || `${item.nome || ''} ${item.construtora || ''} ${item.bairro || ''}`.toLocaleLowerCase('pt-BR').includes(search));
      select.innerHTML = '<option value="">Visão geral do mercado</option>' + rows.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)} · ${esc(item.bairro || 'bairro não informado')}</option>`).join('');
      if ([...select.options].some((item) => item.value === previous)) select.value = previous;
    };
    drawOptions();
    const selected = selectedEnterpriseIds.find((id) => gisEnterprises.some((item) => String(item.id) === id)); if (selected) select.value = selected;
    document.getElementById('gis-enterprise-search').oninput = drawOptions;
    select.onchange = refreshGis; document.getElementById('gis-radius').onchange = refreshGis; await refreshGis();
  }
  async function refreshGis() {
    const enterpriseId = document.getElementById('gis-enterprise')?.value || '', km = Number(document.getElementById('gis-radius')?.value || 3);
    const enterprise = gisEnterprises.find((item) => String(item.id) === String(enterpriseId));
    const extra = { top:'all' }; if (enterprise) Object.assign(extra, { raioLat:enterprise.latitude, raioLng:enterprise.longitude, raioKm:km, zoom:12 });
    const data = await api(`/api/rede-corretores?${query(extra)}`);
    if (!window.L) throw new Error('Biblioteca do mapa indisponível.');
    if (gisMap) gisMap.remove(); gisMap = L.map('rede-gis-map').setView([-7.2306,-35.8811],12);
    const radiusPane = gisMap.createPane('rede-radius-pane'); radiusPane.style.zIndex = '350'; radiusPane.style.pointerEvents = 'none';
    const brokerPane = gisMap.createPane('rede-broker-pane'); brokerPane.style.zIndex = '450';
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ attribution:'© OpenStreetMap' }).addTo(gisMap);
    const bounds = [];
    (data.bubbles || []).filter((item) => !enterprise || item.inRadius).forEach((item) => {
      const demand = Number(item.operations?.locacao_procurada || 0) + Number(item.operations?.compra_procurada || 0), supply = Number(item.total || 0) - demand, color = demand > supply ? colors.locacao_procurada : colors.locacao_ofertada;
      const marker = L.circleMarker([item.latitude,item.longitude],{ pane:'rede-broker-pane',radius:Math.max(7,Math.min(28,Number(item.radius || 9))),color,fillColor:color,fillOpacity:.48,weight:2,bubblingMouseEvents:false });
      marker.bindTooltip(`<div class="rede-gis-tooltip"><strong>${esc(item.bairro)}</strong><br>${number(item.total)} registros · ${number(item.brokers)} corretores<br>Oferta ${number(supply)} · Demanda ${number(demand)}</div>`, { sticky:true,direction:'top',className:'rede-broker-tooltip' });
      marker.on('mouseover', () => marker.bringToFront()); marker.addTo(gisMap); bounds.push([item.latitude,item.longitude]);
    });
    if (enterprise) {
      L.marker([enterprise.latitude,enterprise.longitude]).addTo(gisMap).bindTooltip(`<strong>${esc(enterprise.nome)}</strong>`);
      L.circle([enterprise.latitude,enterprise.longitude],{ pane:'rede-radius-pane',interactive:false,radius:km*1000,color:'#173f68',fillColor:'#173f68',fillOpacity:.055,dashArray:'7 7' }).addTo(gisMap); bounds.push([enterprise.latitude,enterprise.longitude]);
      document.getElementById('gis-note').textContent = `${enterprise.nome} como referência · região de ${km} km visível no mapa.`;
    } else document.getElementById('gis-note').textContent = 'Sem empreendimento selecionado, todos os bairros da rede são exibidos.';
    if (enterprise) gisMap.setView([enterprise.latitude,enterprise.longitude],12,{ animate:false });
    else if (bounds.length) gisMap.fitBounds(bounds,{ padding:[44,44],maxZoom:12 });
    renderRedeFooter(data);
  }

  async function renderBrokers() {
    root.innerHTML = `${header('Corretores','Participação dos remetentes nas oportunidades classificadas.')}<div class="rede-loading">Carregando corretores…</div>`; bindFilters();
    const data = await api(`/api/rede-corretores?${query({ top:brokerTop })}`), rows = data.topBrokers || [];
    root.querySelector('.rede-loading').outerHTML = `<section class="rede-card"><header class="rede-section-head"><div><h2>${number(rows.length)} corretores exibidos</h2><p>Ranking por quantidade de registros no recorte.</p></div><label class="rede-top-selector">Exibir<select id="broker-top"><option value="10" ${brokerTop==='10'?'selected':''}>Top 10</option><option value="20" ${brokerTop==='20'?'selected':''}>Top 20</option><option value="30" ${brokerTop==='30'?'selected':''}>Top 30</option><option value="50" ${brokerTop==='50'?'selected':''}>Top 50</option><option value="all" ${brokerTop==='all'?'selected':''}>Todos</option></select></label></header><div class="table-wrap"><table class="rede-table"><thead><tr><th>#</th><th>Corretor</th><th class="num">Registros</th><th class="num">Participação</th><th class="num">Bairros</th><th>Padrão predominante</th></tr></thead><tbody>${rows.map((item,index) => `<tr><td>${index+1}</td><td><strong>${esc(item.label)}</strong></td><td class="num">${number(item.total)}</td><td class="num">${Number(item.percent || 0).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1})}</td><td class="num">${number(item.neighborhoods)}</td><td>${esc(item.patterns?.[0]?.label || 'Indefinido')}</td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<div class="rede-empty">Nenhum corretor no recorte.</div>'}</section>`;
    document.getElementById('broker-top').onchange = (event) => { brokerTop = event.target.value; renderBrokers(); };
    renderRedeFooter(data);
  }

  function neighborhoodValueTable(rows) {
    const metric = (item, name, average = false) => average ? currency(item[name]?.media) : number(item[name]?.qtd);
    return `<div class="table-wrap"><table class="rede-table rede-values-table"><thead><tr><th rowspan="2">Bairro</th><th rowspan="2" class="num">Total</th><th colspan="2" class="num">Vendas (Oferta)</th><th colspan="2" class="num">Compras (Demanda)</th><th colspan="2" class="num">Locação (Oferta)</th><th colspan="2" class="num">Locação (Demanda)</th><th rowspan="2" class="num">Repasse</th></tr><tr><th class="num">Qtd</th><th class="num">Tkt méd.</th><th class="num">Qtd</th><th class="num">Tkt méd.</th><th class="num">Qtd</th><th class="num">Tkt méd.</th><th class="num">Qtd</th><th class="num">Tkt méd.</th></tr></thead><tbody>${rows.filter((item) => item.total).map((item) => `<tr><td><strong>${esc(item.nome)}</strong></td><td class="num">${number(item.total)}</td><td class="num">${metric(item,'venda')}</td><td class="num">${metric(item,'venda',true)}</td><td class="num">${metric(item,'compra')}</td><td class="num">${metric(item,'compra',true)}</td><td class="num">${metric(item,'locacaoOferta')}</td><td class="num">${metric(item,'locacaoOferta',true)}</td><td class="num">${metric(item,'locacaoDemanda')}</td><td class="num">${metric(item,'locacaoDemanda',true)}</td><td class="num">${metric(item,'repasse')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function renderNeighborhoods() {
    const actions = `<div class="rede-view-switch" role="group" aria-label="Visão de bairros"><button type="button" data-neighborhood-view="dados" class="${neighborhoodView === 'dados' ? 'active' : ''}">Dados</button><button type="button" data-neighborhood-view="valores" class="${neighborhoodView === 'valores' ? 'active' : ''}">Valores</button></div>`;
    root.innerHTML = `<header class="rede-page-head"><div><span>Rede NEXUM</span><h1>Bairros</h1><p>${neighborhoodView === 'dados' ? 'Cadastro mestre e atividade territorial disponível na Rede.' : 'Valores médios e volumes por operação territorial.'}</p></div>${actions}</header><div class="rede-chips" id="rede-filter-chips"></div><div class="rede-loading">Carregando bairros…</div>`; bindFilters();
    const rows = await api(`/api/rede/bairros?${query()}`);
    const dataTable = `<div class="table-wrap"><table class="rede-table"><thead><tr><th>Bairro</th><th>Localidade</th><th class="num">Registros</th><th class="num">Oferta</th><th class="num">Demanda</th><th class="num">Corretores</th><th>Cadastro</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${esc(item.nome)}</strong></td><td>${esc([item.cidade,item.uf].filter(Boolean).join('/'))}</td><td class="num">${number(item.total)}</td><td class="num">${number(item.oferta)}</td><td class="num">${number(item.demanda)}</td><td class="num">${number(item.corretores)}</td><td><span class="rede-status ${item.revisoesPendentes?'warn':''}">${item.revisoesPendentes?`${number(item.revisoesPendentes)} revisão(ões)`:'Ativo'}</span></td></tr>`).join('')}</tbody></table></div>`;
    root.querySelector('.rede-loading').outerHTML = `<section class="rede-card">${neighborhoodView === 'dados' ? dataTable : neighborhoodValueTable(rows)}</section>`;
    root.querySelectorAll('[data-neighborhood-view]').forEach((button) => button.onclick = () => { neighborhoodView = button.dataset.neighborhoodView; renderNeighborhoods(); });
    renderRedeFooter(await api(`/api/rede-corretores?${query({ top:10 })}`));
  }

  async function renderReviews() {
    root.innerHTML = `${header('Revisão','Consulta cronológica das conversas classificadas pela Rede.')}<section class="rede-card rede-conversation-panel"><header class="rede-conversation-head"><div><h2>Conversas da Rede</h2><p>Mais recentes primeiro · 50 conversas por página.</p></div><div class="rede-conversation-search"><input id="review-search" type="search" placeholder="Buscar trecho aproximado"><button type="button" id="review-run-search">Buscar</button><button type="button" id="review-order" aria-pressed="true">Mais recentes</button></div></header><div id="review-conversation-body" class="rede-loading">Carregando conversas…</div></section>`; bindFilters();
    let reviewPage = 1, reviewSearch = '', reviewSearchTimer;
    const body = document.getElementById('review-conversation-body');
    const loadPage = async (pageNumber = reviewPage) => {
      body.className = 'rede-loading'; body.textContent = 'Carregando conversas…';
      const data = await api(`/api/rede/revisao-amostras?${query({ limit:50, page:pageNumber, reviewSearch })}`);
      reviewPage = data.page;
      const rows = data.samples || [];
      const chips = [`${number(data.total)} conversas no escopo`, `${number(rows.length)} nesta página`, `página ${number(data.page)} de ${number(data.pageCount)}`];
      body.className = '';
      body.innerHTML = `<div class="rede-conversation-pills">${chips.map((item) => `<span>${esc(item)}</span>`).join('')}</div><p class="rede-note">A base histórica não guarda o texto bruto: a coluna Mensagem mostra o resumo mascarado e auditável do registro.</p><div class="table-wrap"><table class="rede-table rede-conversation-table"><thead><tr><th>Data/hora</th><th>Contato</th><th>Operação</th><th>Bairro / imóvel</th><th>Mensagem</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${esc(dateTime(item.occurredAt))}</strong></td><td>${esc(item.sender)}</td><td>${esc(item.operationLabel || 'Indefinida')}</td><td>${esc(item.territoryLabel || 'Indefinido')}</td><td class="rede-conversation-message">${esc(item.sourceMessageMasked)}</td></tr>`).join('')}</tbody></table></div>${rows.length ? `<nav class="rede-pagination" aria-label="Paginação das conversas"><button type="button" data-review-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>← Anterior</button><span>Página ${number(data.page)} de ${number(data.pageCount)}</span><button type="button" data-review-page="${data.page + 1}" ${data.page >= data.pageCount ? 'disabled' : ''}>Próxima →</button></nav>` : '<div class="rede-empty">Nenhuma conversa encontrada para o recorte atual.</div>'}`;
      body.querySelectorAll('[data-review-page]').forEach((button) => button.onclick = () => loadPage(Number(button.dataset.reviewPage)));
    };
    const applySearch = () => { reviewSearch = String(document.getElementById('review-search').value || '').trim(); loadPage(1).catch((error) => { body.className = 'rede-result error'; body.textContent = error.message; }); };
    document.getElementById('review-search').oninput = () => { clearTimeout(reviewSearchTimer); reviewSearchTimer = setTimeout(applySearch, 280); };
    document.getElementById('review-run-search').onclick = applySearch;
    await loadPage();
    refreshRedeFooter();
  }

  function checkpointMarkup(checkpoint) { return `<div class="rede-checkpoint"><div><span>Data</span><strong>${esc(checkpoint?.date || '—')}</strong></div><div><span>Hora</span><strong>${esc(checkpoint?.time || '—')}</strong></div><div><span>Remetente</span><strong>${esc(checkpoint?.sender || '—')}</strong></div></div>`; }
  async function renderImport() {
    root.innerHTML = `${header('Importar Conversas','Continuidade incremental do histórico completo do WhatsApp.',false)}<section class="rede-upload"><article class="rede-upload-drop"><h2>Subir arquivo de conversa</h2><p>Selecione o TXT completo exportado do grupo Construindo Parceria CG.</p><input id="conversation-file" type="file" accept=".txt,text/plain"><div style="margin-top:16px"><button class="rede-button" id="prepare-import">Analisar arquivo</button></div></article><div id="import-stage"></div></section><section class="rede-card rede-section" id="import-history"><div class="rede-loading">Carregando histórico…</div></section>`;
    document.getElementById('prepare-import').onclick = prepareUpload; await refreshImportHistory(); await refreshRedeFooter();
  }
  async function prepareUpload() {
    const file = document.getElementById('conversation-file').files[0], stage = document.getElementById('import-stage'), button = document.getElementById('prepare-import');
    if (!file) return alert('Selecione o arquivo TXT.');
    const form = new FormData(); form.append('conversation',file); button.disabled=true; stage.innerHTML='<div class="rede-loading">Localizando o checkpoint…</div>';
    try {
      const preview = await api('/api/rede/importacoes/preparar',{ method:'POST',body:form }); previewToken=preview.token;
      stage.innerHTML = `<article class="rede-card rede-preview"><span>Último registro no NEXUM</span>${checkpointMarkup(preview.checkpoint)}<p>O arquivo contém <strong>${number(preview.newMessageCount)}</strong> mensagem(ns) nova(s) após esse ponto.</p><p class="rede-note">O histórico anterior será ignorado. Somente o conteúdo posterior ao checkpoint será enviado ao motor.</p><button class="rede-button" id="confirm-import">${preview.newMessageCount?'Iniciar processamento':'Confirmar arquivo sem novidades'}</button></article>`;
      document.getElementById('confirm-import').onclick=confirmImport;
    } catch(error) { stage.innerHTML=`<div class="rede-result error">${esc(error.message)}</div>`; }
    finally { button.disabled=false; await refreshImportHistory(); }
  }
  async function confirmImport() {
    const stage=document.getElementById('import-stage'), button=document.getElementById('confirm-import'); button.disabled=true; button.textContent='Processando…';
    try {
      const result=await api('/api/rede/importacoes/processar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:previewToken})}); previewToken='';
      stage.innerHTML=`<div class="rede-result"><strong>${result.status==='sem_alteracoes'?'NENHUMA ATUALIZAÇÃO NECESSÁRIA':'ATUALIZAÇÃO CONCLUÍDA'}</strong>${checkpointMarkup(result.finalCheckpoint)}<p>Mensagens importadas: <b>${number(result.messagesImported)}</b><br>Oportunidades geradas: <b>${number(result.opportunitiesGenerated)}</b><br>Itens para revisão: <b>${number(result.reviewsGenerated)}</b></p></div>`;
    } catch(error) { stage.innerHTML=`<div class="rede-result error">${esc(error.message)}</div>`; }
    await refreshImportHistory();
  }
  async function refreshImportHistory() {
    const host=document.getElementById('import-history'); if(!host)return; const rows=await api('/api/rede/importacoes');
    host.innerHTML=`<header><div><h2>Histórico de importações</h2><p>Checkpoint, volume e resultado de cada tentativa.</p></div></header><table class="rede-table"><thead><tr><th>Arquivo</th><th>Data</th><th>Usuário</th><th class="num">Mensagens</th><th class="num">Oportunidades</th><th>Status</th><th>Erro</th></tr></thead><tbody>${rows.map((item)=>`<tr><td>${esc(item.fileName||'—')}</td><td>${dateTime(item.processedAt||item.uploadedAt)}</td><td>${esc(item.actor?.nome||'—')}</td><td class="num">${number(item.messagesImported)}</td><td class="num">${number(item.opportunitiesGenerated)}</td><td><span class="rede-status ${item.status==='falha'?'error':item.status==='sem_alteracoes'?'warn':''}">${esc(item.status)}</span></td><td class="rede-history-error">${esc(item.error||'')}</td></tr>`).join('')}</tbody></table>${rows.length?'':'<div class="rede-empty">Nenhuma importação registrada.</div>'}`;
  }

  async function load() {
    try {
      if (page === 'mercados') await renderMarkets();
      else if (page === 'gis') await renderGis();
      else if (page === 'corretores') await renderBrokers();
      else if (page === 'bairros') await renderNeighborhoods();
      else if (page === 'revisao') await renderReviews();
      else if (page === 'importar') await renderImport();
    } catch (error) { root.innerHTML = `<div class="rede-result error">${esc(error.message)}</div>`; }
  }
  window.addEventListener('nexum:global-filters', () => load());
  window.addEventListener('rede:enterprise-selection', () => load());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',load,{once:true}); else load();
})();
