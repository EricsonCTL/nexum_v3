const CTI_SESSION_KEY = 'ctiUserSession';
// Shared economic reference and Analytics simulator.
{ const script=document.createElement('script');script.src='/reajuste-ui.js';script.async=false;document.head.append(script);const style=document.createElement('link');style.rel='stylesheet';style.href='/reajuste-ui.css';document.head.append(style); }

const CTI_USERS = {
  ADMIN: {
    code: 'ADMIN',
    name: 'Ericson',
    role: 'ADMIN',
    roleLabel: 'Administrador'
  },
  INCORPORADORA: {
    code: 'INCORPORADORA',
    name: 'Incorporadora',
    role: 'INCORPORADORA',
    roleLabel: 'Incorporadora'
  }
};

function setCTIUser(code) {
  const user = CTI_USERS[code];
  if (!user) return false;
  sessionStorage.setItem(CTI_SESSION_KEY, JSON.stringify({
    code: user.code,
    name: user.name,
    role: user.role,
    roleLabel: user.roleLabel,
    createdAt: Date.now()
  }));
  return true;
}

function getCTIUser() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CTI_SESSION_KEY) || 'null');
    if (!stored || !CTI_USERS[stored.code]) return null;
    return { ...CTI_USERS[stored.code], createdAt: stored.createdAt };
  } catch (_) {
    return null;
  }
}

function clearCTIUser() {
  sessionStorage.removeItem(CTI_SESSION_KEY);
}

function getBasePath() {
  if (location.pathname.endsWith('/')) return location.pathname;
  const lastSegment = location.pathname.split('/').pop();
  if (lastSegment && lastSegment.includes('.')) {
    return location.pathname.replace(/[^/]*$/, '');
  }
  return location.pathname + '/';
}

function pageUrl(filename) {
  const basePath = getBasePath();
  if (location.protocol.startsWith('http')) {
    return location.origin + basePath + filename;
  }
  return basePath + filename;
}

function requireCTIUser(allowedRoles) {
  const user = getCTIUser();
  if (!user) {
    window.location.replace(location.pathname.startsWith('/gestao') ? '/index.html' : pageUrl('index.html'));
    return null;
  }
  const isLegacyCommercialAccess = user.role === 'INCORPORADORA' && allowedRoles?.includes('BROKER');
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(user.role) && !isLegacyCommercialAccess) {
    window.location.replace(location.pathname.startsWith('/gestao') ? '/inicio.html' : pageUrl('inicio.html'));
    return null;
  }
  return user;
}

function logoutCTI() {
  clearCTIUser();
  window.location.href = pageUrl('index.html');
}

// As telas continuam usando fetch normalmente, mas toda mutação local passa a
// carregar o ator da sessão para a trilha de auditoria do motor comercial.
if (!window.__nexumAuditedFetch) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function nexumAuditedFetch(input, options = {}) {
    const url = typeof input === 'string' ? input : input?.url || ''; const method = String(options.method || input?.method || 'GET').toUpperCase();
    if (/^\/api\//.test(url)) {
      const user = getCTIUser(); const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
      if (user) headers.set('X-Nexum-Actor', encodeURIComponent(JSON.stringify({ code: user.code, name: user.name, role: user.role })));
      options = { ...options, headers };
    }
    return nativeFetch(input, options);
  };
  window.__nexumAuditedFetch = true;
}

function formatNexumCurrency(value) {
  const amount = Number(value || 0);
  if (!amount) return '—';
  return `R$ ${Math.round(amount).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

function formatNexumNumber(value, options = {}) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR', { maximumFractionDigits: 0, ...options }) : '—';
}

function formatNexumPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '—';
  return `${amount > 0 ? '+' : ''}${(amount * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatNexumMonthlyAdjustment(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return `${(amount * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatNexumIvv(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' un./mês' : '—';
}

function escapeNexumHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}

const NEXUM_FOOTER_ICONS = {
  enterprises: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 21V4.5L12 2v19M12 21h8V7l-8-2.5M7 7h2M7 11h2M7 15h2M15 10h2M15 14h2M15 18h2"/></svg>',
  units: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
  available: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 20V5l8-2 8 2v15M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"/></svg>',
  sales: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="m4 15 5-5 4 4 7-8M15 6h5v5"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 7h14v4a2 2 0 0 0 0 4v4H5v-4a2 2 0 0 0 0-4V7Z"/><path d="M9 10v4M12 10v4M15 10v4"/></svg>',
  m2: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 19 19 5M7 5h12v12M5 7v12h12"/><path d="M9 15h6M12 12v6"/></svg>',
  adjusted: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M6 8h12M6 16h12M9 5v6M15 13v6"/><circle cx="9" cy="8" r="2"/><circle cx="15" cy="16" r="2"/></svg>',
  ivv: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 17 10 12l3 3 6-8"/><path d="M15 7h4v4"/></svg>',
  vso: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>'
};

function nexumFooterMarkup() {
  NEXUM_FOOTER_ICONS.reference = NEXUM_FOOTER_ICONS.adjusted;
  const metric = (key, label) => `<div class="footer-metric" data-footer-metric="${key}"><i aria-hidden="true">${NEXUM_FOOTER_ICONS[key]}</i><span>${label}</span><strong>—</strong></div>`;
  return `<div class="footer-metrics-grid">${metric('enterprises','Empreend.')}${metric('units','Unidades')}${metric('available','Disponíveis')}${metric('sales','Vendidas')}${metric('ticket','Ticket médio')}${metric('m2','M² médio')}${metric('adjusted','Reajuste Médio')}${metric('reference','Índice ref.')}${metric('ivv','IVV mensal')}${metric('vso','VSO')}</div><p class="footer-rights">© Ericson Tenório 2026.<br>Todos os direitos reservados.</p>`;
}

function updateNexumFooterMetrics(items, summary = {}) {
  const footers = [...document.querySelectorAll('.app-statusbar:not(.enterprise-statusbar), .nexum-home-footer')];
  if (!footers.length) return;
  const records = Array.isArray(items) ? items : [];
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const priceByEnterprise = records.map((item) => Number(item.current?.averagePrice || 0)).filter(Boolean);
  const pricePerM2ByEnterprise = records.map((item) => Number(item.current?.pricePerM2 || 0)).filter(Boolean);
  const ivvValues = records.map((item) => item.ivv?.available ? Number(item.ivv.monthly) : null).filter(Number.isFinite);
  const adjustedValue = formatNexumMonthlyAdjustment(summary.reajusteMedioMensal ?? summary.reajusteMedio ?? summary.adjusted ?? 0);
  const values = {
    enterprises: formatNexumNumber(summary.empreendimentos ?? summary.enterprises ?? records.length),
    units: formatNexumNumber(summary.unidades ?? summary.units ?? records.reduce((sum, item) => sum + Number(item.current?.units || 0), 0)),
    available: formatNexumNumber(summary.disponiveis ?? summary.available ?? records.reduce((sum, item) => sum + Number(item.current?.available || 0), 0)),
    sales: formatNexumNumber(summary.vendasValidadas ?? summary.sales ?? records.reduce((sum, item) => sum + Number(item.comparison?.salesConfirmed ?? item.current?.sold ?? 0), 0)),
    ticket: formatNexumCurrency(summary.ticketMedio ?? summary.ticket ?? average(priceByEnterprise)),
    m2: formatNexumCurrency(summary.precoMedioM2 ?? summary.m2 ?? average(pricePerM2ByEnterprise)),
    adjusted: adjustedValue === '—' ? '—' : `${adjustedValue} a.m.`,
    ivv: formatNexumIvv(summary.ivv ?? (ivvValues.length ? average(ivvValues) : null)),
    vso: formatNexumPercent(Number(summary.vso ?? (average(records.map((item) => Number(item.ivv?.vsoMedioMensal ?? item.vso)).filter(Number.isFinite)))) / 100)
  };
  footers.forEach((footer) => Object.entries(values).forEach(([key, value]) => {
    const target = footer.querySelector(`[data-footer-metric="${key}"] strong`);
    if (target) target.textContent = value;
  }));
}

function resetNexumFooterMetrics() {
  document.querySelectorAll('.app-statusbar [data-footer-metric] strong, .nexum-home-footer [data-footer-metric] strong').forEach((target) => { target.textContent = '—'; });
}

function updateNexumFooterContext(context = {}) {
  window.nexumFooterContextLocked = true;
  const values = {
    enterprises: context.enterprises ?? context.empreendimentos,
    units: context.units ?? context.unidades,
    available: context.available ?? context.disponiveis,
    sales: context.sales ?? context.vendasConfirmadas,
    ticket: context.ticket ?? context.ticketMedio,
    m2: context.m2 ?? context.precoMedioM2,
    adjusted: context.adjusted ?? context.reajusteMedio,
    ivv: context.ivv,
    vso: context.vso
  };
  const formatted = { enterprises: values.enterprises == null ? '—' : formatNexumNumber(values.enterprises), units: values.units == null ? '—' : formatNexumNumber(values.units), available: values.available == null ? '—' : formatNexumNumber(values.available), sales: values.sales == null ? '—' : formatNexumNumber(values.sales), ticket: formatNexumCurrency(values.ticket), m2: formatNexumCurrency(values.m2), adjusted: values.adjusted == null ? '—' : context.adjustedMonthly ? `${formatNexumMonthlyAdjustment(values.adjusted)}${formatNexumMonthlyAdjustment(values.adjusted)==='—'?'':' a.m.'}` : formatNexumPercent(values.adjusted), ivv: formatNexumIvv(values.ivv), vso: formatNexumPercent(Number(values.vso) / 100) };
  Object.entries(formatted).forEach(([key, value]) => { document.querySelectorAll(`.app-statusbar [data-footer-metric="${key}"] strong, .nexum-home-footer [data-footer-metric="${key}"] strong`).forEach((target) => { target.textContent = value; }); });
}

window.nexumFooterMarkup = nexumFooterMarkup;
window.nexumNumber = formatNexumNumber;
window.updateNexumFooterMetrics = updateNexumFooterMetrics;
window.updateNexumFooterContext = updateNexumFooterContext;
window.resetNexumFooterMetrics = resetNexumFooterMetrics;

function nexumFooterAnalyticsQuery() {
  const filters = window.nexumGlobalFilters || {}, query = new URLSearchParams();
  for (const key of ['period','search','bairro','tipo','padrao','fase','ticket','dormitorios','caracteristicas','vagas','operacoes','favorite']) if (filters[key]) query.set(key, filters[key]);
  return query;
}

function refreshNexumGlobalFooter() {
  if (window.nexumFooterContextLocked || document.body.classList.contains('map-page')) return;
  const footer = document.querySelector('.app-statusbar'); if (!footer || footer.classList.contains('enterprise-statusbar')) return;
  fetch(`/api/portfolio-home?${nexumFooterAnalyticsQuery()}`).then((response) => response.ok ? response.json() : Promise.reject()).then((data) => {
    if (!window.nexumFooterContextLocked) {
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const average = (values) => {
        const validValues = values.map(Number).filter(Number.isFinite);
        return validValues.length ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length : null;
      };
      updateNexumFooterMetrics(entries, {
        ...(data.kpis || {}),
        unidades: entries.reduce((sum, row) => sum + Number(row.current?.units || 0), 0),
        vendasValidadas: data.kpis?.vendasValidadas ?? entries.reduce((sum, row) => sum + Number(row.comparison?.salesConfirmed ?? row.current?.sold ?? 0), 0),
        ticketMedio: average(entries.map((row) => row.current?.averagePrice)),
        precoMedioM2: average(entries.map((row) => row.current?.pricePerM2))
      });
    }
  }).catch(() => { if (!window.nexumFooterContextLocked) updateNexumFooterMetrics([]); });
}

window.refreshNexumGlobalFooter = refreshNexumGlobalFooter;

function mountNexumFooter() {
  if (!getCTIUser()) return;
  if (document.body.classList.contains('nexum-portfolio-frame') || document.body.classList.contains('nexum-home-page') || document.querySelector('.nexum-home-footer')) return;
  const existing = document.querySelector('.app-statusbar');
  if (document.body.classList.contains('map-page')) {
    if (existing && !existing.classList.contains('enterprise-statusbar')) { existing.classList.add('app-metrics-footer'); existing.innerHTML = nexumFooterMarkup(); }
    return;
  }
  if (existing) return;
  const footer = document.createElement('footer');
  footer.className = 'app-statusbar app-global-footer app-metrics-footer';
  footer.innerHTML = nexumFooterMarkup();
  document.body.append(footer);
  resetNexumFooterMetrics();
  refreshNexumGlobalFooter();
}

function mountNexumNotifications(button, requestedMode) {
  if (!button || document.getElementById('nexum-notification-center')) return;
  const management = requestedMode === 'gestao' || (!requestedMode && (location.pathname.startsWith('/gestao') || document.body.classList.contains('gestao-page')));
  const panel = document.createElement('aside');
  panel.id = 'nexum-notification-center'; panel.className = `nexum-notification-center ${management ? 'is-operational' : 'is-enterprises'}`; panel.hidden = true;
  panel.setAttribute('aria-label', management ? 'Central de pendências operacionais' : 'Novos empreendimentos');
  panel.innerHTML = `<header><div><span>${management ? 'PENDÊNCIAS' : 'PORTFÓLIO'}</span><h2>${management ? 'Central de notificações' : 'Novos empreendimentos'}</h2></div><button type="button" aria-label="Fechar notificações">×</button></header><div class="nexum-notification-summary" aria-live="polite"></div><div class="nexum-notification-list"></div>${management ? '' : '<footer><button type="button" data-read-all>Marcar todas como lidas</button><button type="button" class="button teal" data-notification-ok>OK</button></footer>'}`;
  document.body.append(panel);
  button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', 'false');
  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  const markRead = (enterpriseIds, all = false) => fetch('/api/notificacoes/empreendimentos/lidos', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ enterpriseIds, all }) }).then((response) => response.ok ? response.json() : Promise.reject());
  const render = (payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [], count = Number(payload?.total || 0), badge = button.querySelector('[data-notification-count]');
    if (badge) { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !count; }
    button.setAttribute('aria-label', count ? `Notificações: ${count} ${management ? 'pendência' : 'empreendimento novo'}${count === 1 ? '' : 's'}` : 'Notificações: nenhuma novidade');
    panel.querySelector('.nexum-notification-summary').innerHTML = management ? (count ? `<span class="critical">${payload.critical || 0} críticas</span><span class="attention">${payload.attention || 0} atenção</span><span>${payload.pending || 0} em revisão</span>` : '') : `<span>${count} não lido${count===1?'':'s'}</span><span>${items.length} empreendimento${items.length===1?'':'s'} recente${items.length===1?'':'s'}</span>`;
    panel.querySelector('.nexum-notification-list').innerHTML = items.length ? (management ? items.map((item) => `<a class="nexum-notification-item ${escapeNexumHtml(item.severity)}" href="/gestao/empreendimento?id=${encodeURIComponent(item.enterpriseId)}&revisarTabela=${encodeURIComponent(item.tableId)}&criticidade=1"><span class="nexum-notification-level">${item.severity === 'critico' ? 'Crítico' : item.severity === 'atencao' ? 'Atenção' : 'Revisar'}</span><strong>${escapeNexumHtml(item.enterpriseName)}</strong><small>${escapeNexumHtml(item.tableName)}${item.validityDate ? ` · ${escapeNexumHtml(item.validityDate.split('-').reverse().join('/'))}` : ''}</small><p>${escapeNexumHtml(item.summary)}</p></a>`).join('') : items.map((item) => `<button type="button" class="nexum-notification-item enterprise-news ${item.read?'is-read':'is-unread'}" data-enterprise-news="${encodeURIComponent(item.enterpriseId)}"><span class="nexum-notification-level">${item.read?'Lido':'Novo'}</span><strong>${escapeNexumHtml(item.enterpriseName)}</strong><small>${escapeNexumHtml(item.builder)} · ${escapeNexumHtml(item.location)}</small><p>${escapeNexumHtml(item.classification)}${item.launchDate?` · lançamento ${escapeNexumHtml(item.launchDate.split('-').reverse().join('/'))}`:''}</p></button>`).join('')) : `<div class="nexum-notification-empty"><strong>${management?'Nenhuma pendência no momento.':'Nenhum empreendimento cadastrado.'}</strong><span>${management?'As tabelas ativas estão sem alertas de revisão.':'As novidades do portfólio aparecerão aqui.'}</span></div>`;
    if(!management)panel.querySelectorAll('[data-enterprise-news]').forEach((item)=>item.onclick=()=>{const enterpriseId=decodeURIComponent(item.dataset.enterpriseNews);markRead([enterpriseId]).finally(()=>{location.href=`/empreendimento.html?id=${encodeURIComponent(enterpriseId)}`})});
  };
  const load = () => fetch(`/api/notificacoes${management?'':'?tipo=novos'}`).then((response) => response.ok ? response.json() : Promise.reject()).then(render).catch(() => render({ items: [] }));
  button.onclick = () => { const willOpen = panel.hidden; if (willOpen) { panel.hidden = false; button.setAttribute('aria-expanded', 'true'); load(); } else close(); };
  panel.querySelector('header button').onclick = close;
  panel.querySelector('[data-read-all]')?.addEventListener('click',()=>markRead([],true).then(render));
  panel.querySelector('[data-notification-ok]')?.addEventListener('click',close);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { close(); button.focus(); } });
  document.addEventListener('click', (event) => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close(); });
  load();
}

function mountNexumEnterpriseSelector(trigger) {
  if (!trigger || document.getElementById('nexum-enterprise-selector')) return;
  const panel = document.createElement('aside');
  panel.id = 'nexum-enterprise-selector'; panel.className = 'nexum-enterprise-selector'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Selecionar empreendimentos');
  panel.innerHTML = '<header><h2>Empreendimentos</h2><button type="button" data-close aria-label="Fechar empreendimentos">×</button></header><div class="nexum-enterprise-selector-body"><label class="nexum-enterprise-selector-favorites"><input type="checkbox" data-favorites-only> Mostrar somente favoritos</label><input type="search" data-search placeholder="Buscar empreendimento, construtora ou bairro" aria-label="Buscar empreendimento, construtora ou bairro"><div class="nexum-enterprise-selector-actions"><button type="button" data-select-all>Selecionar tudo</button><button type="button" data-clear>Limpar</button></div><p class="nexum-enterprise-selector-count" data-count></p><div class="nexum-enterprise-selector-list" data-results></div></div><footer><button type="button" class="button teal" data-apply>Aplicar seleção</button></footer>';
  document.body.append(panel);
  trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const search = panel.querySelector('[data-search]'), favoritesOnly = panel.querySelector('[data-favorites-only]'), results = panel.querySelector('[data-results]'), count = panel.querySelector('[data-count]');
  let records = [], selected = new Set();
  const scope = () => {
    const current = typeof window.nexumGetEnterpriseSelectionScope === 'function' ? window.nexumGetEnterpriseSelectionScope() : records;
    return Array.isArray(current) ? current : records;
  };
  const visible = () => {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    return scope().filter((item) => (!favoritesOnly.checked || item.favorite) && `${item.nome || ''} ${item.construtora || ''} ${item.bairro || ''} ${item.endereco || ''} ${item.cidade || ''} ${item.estado || ''}`.toLocaleLowerCase('pt-BR').includes(query));
  };
  const render = () => {
    const items = visible().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{sensitivity:'base',numeric:true})); const scopedIds = new Set(scope().map((item) => item.id));
    selected = new Set([...selected].filter((id) => scopedIds.has(id)));
    count.textContent = selected.size ? `${selected.size} empreendimento${selected.size === 1 ? '' : 's'} selecionado${selected.size === 1 ? '' : 's'}` : 'Nenhum selecionado · todos do recorte serão exibidos';
    results.innerHTML = items.length ? items.map((item) => {
      const context = [item.construtora || 'Construtora não informada', item.bairro || 'Bairro não informado'].join(' · ');
      return `<label class="nexum-enterprise-selector-row"><input type="checkbox" value="${escape(item.id)}" ${selected.has(item.id) ? 'checked' : ''}><span><strong>${escape(item.nome)}</strong><small>${escape(context)}</small></span></label>`;
    }).join('') : '<p class="nexum-enterprise-selector-empty">Nenhum empreendimento corresponde aos filtros atuais.</p>';
    results.querySelectorAll('input').forEach((input) => input.onchange = () => { input.checked ? selected.add(input.value) : selected.delete(input.value); render(); });
  };
  const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const open = () => { selected = new Set((typeof window.nexumGetEnterpriseSelection === 'function' ? window.nexumGetEnterpriseSelection() : []).map(String)); panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render(); search.focus(); };
  trigger.onclick = () => panel.hidden ? open() : close();
  panel.querySelector('[data-close]').onclick = () => { close(); trigger.focus(); };
  panel.querySelector('[data-search]').oninput = render;
  favoritesOnly.onchange = () => { window.nexumSetGlobalFilters?.({ ...(window.nexumGlobalFilters || {}), favorite:favoritesOnly.checked }); render(); };
  panel.querySelector('[data-select-all]').onclick = () => { visible().forEach((item) => selected.add(item.id)); render(); };
  panel.querySelector('[data-clear]').onclick = () => { selected.clear(); render(); };
  panel.querySelector('[data-apply]').onclick = () => {
    window.dispatchEvent(new CustomEvent('nexum:enterprise-selection', { detail: { ids: [...selected], scopeIds: scope().map((item) => item.id) } }));
    close(); trigger.focus();
  };
  window.addEventListener('nexum:clear-enterprise-selection', () => { selected.clear(); search.value = ''; render(); });
  window.addEventListener('nexum:global-filters', (event) => { favoritesOnly.checked = Boolean(event.detail?.favorite); render(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); } });
  fetch('/api/empreendimentos').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { records = data; }).catch(() => { records = []; });
}

function enhanceNexumNavigation() {
  const user = getCTIUser(); const nav = document.querySelector('.topbar .nav');
  if (!user || document.body.classList.contains('login-page') || !nav || nav.querySelector('.enterprise-nav-menu')) return;
  const enterpriseLink = [...nav.querySelectorAll('a')].find((link) => /empreendimentos\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  if (!enterpriseLink) return;
  const isHome = /empreendimentos\.html$/.test(location.pathname) || location.pathname.endsWith('/');
  const home = document.createElement('a'); home.href = pageUrl('empreendimentos.html'); home.textContent = 'Início'; home.className = isHome ? 'active nav-home-link' : 'nav-home-link';
  const menu = document.createElement('div'); menu.className = 'enterprise-nav-menu';
  menu.innerHTML = `<button class="nav-enterprise-trigger ${isHome ? '' : 'active'}" type="button" aria-expanded="false">Empreendimentos <span>⌄</span></button><section class="enterprise-nav-panel" hidden><div class="enterprise-nav-search"><input type="search" placeholder="Buscar empreendimento" aria-label="Buscar empreendimento"></div><div class="enterprise-nav-results" role="listbox"><p>Carregando empreendimentos…</p></div></section>`;
  enterpriseLink.replaceWith(menu); nav.insertBefore(home, menu);
  const exit = nav.querySelector('button[onclick*="logoutCTI"]');
  if (exit && !nav.querySelector('.nav-notifications')) { const notifications = document.createElement('button'); notifications.type = 'button'; notifications.className = 'nav-notifications'; notifications.setAttribute('aria-label', 'Notificações'); notifications.title = 'Notificações'; notifications.innerHTML = '<span>◔</span><small>Notificações</small>'; nav.insertBefore(notifications, exit); }
  const mapFilters = document.getElementById('open-filters');
  if (exit && mapFilters) { mapFilters.classList.add('nav-filters'); nav.insertBefore(mapFilters, exit); }
  else if (exit && !nav.querySelector('.nav-filters')) { const filters = document.createElement('button'); filters.type = 'button'; filters.className = 'nav-filters'; filters.textContent = 'Filtros'; nav.insertBefore(filters, exit); mountNexumGlobalFilters(filters); }
  const trigger = menu.querySelector('.nav-enterprise-trigger'), panel = menu.querySelector('.enterprise-nav-panel'), input = menu.querySelector('input'), results = menu.querySelector('.enterprise-nav-results'); let records = [];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const draw = () => { const query = input.value.trim().toLocaleLowerCase('pt-BR'); const filtered = records.filter((item) => `${item.nome} ${item.bairro || ''} ${item.cidade || ''}`.toLocaleLowerCase('pt-BR').includes(query)).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{sensitivity:'base',numeric:true})); results.innerHTML = filtered.length ? filtered.map((item) => `<a role="option" data-enterprise-id="${escape(item.id)}" data-enterprise-name="${escape(item.nome)}" href="${pageUrl('empreendimentos.html')}?empreendimento=${encodeURIComponent(item.id)}"><strong>${escape(item.nome)}</strong><span>${escape([item.bairro,item.cidade,item.estado].filter(Boolean).join(' · ') || 'Ver ações do empreendimento')}</span></a>`).join('') : '<p>Nenhum empreendimento encontrado.</p>'; };
  trigger.onclick = () => { const open = trigger.getAttribute('aria-expanded') === 'true'; trigger.setAttribute('aria-expanded', String(!open)); panel.hidden = open; if (!open) input.focus(); };
  input.oninput = draw;
  results.onclick = (event) => { const selected = event.target.closest('[data-enterprise-id]'); if (!selected) return; event.preventDefault(); const ids = [selected.dataset.enterpriseId]; window.dispatchEvent(new CustomEvent('nexum:enterprise-selection', { detail: { ids, scopeIds: records.map((item) => item.id) } })); if (isHome) window.dispatchEvent(new CustomEvent('nexum:filter-enterprise', { detail: { id: selected.dataset.enterpriseId, name: selected.dataset.enterpriseName } })); trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true; };
  document.addEventListener('click', (event) => { if (!menu.contains(event.target)) { trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true; } });
  fetch('/api/empreendimentos').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { records = data; draw(); }).catch(() => { results.innerHTML = '<p>Não foi possível carregar os empreendimentos.</p>'; });
}

// v2 inicia uma sessão limpa após a mudança de semântica da seleção de
// empreendimentos. O estado v1 podia manter um recorte invisível ativo.
const NEXUM_GLOBAL_FILTERS_STORAGE = 'nexum.globalFilters.v2';
function nexumGlobalFilterDefaults() { return { period:'12m', search:'', bairro:'', tipo:'', padrao:'', fase:'', ticket:'', dormitorios:'', caracteristicas:'', vagas:'', operacoes:'', favorite:false }; }
function initializeNexumGlobalFilters() { try { window.nexumGlobalFilters = { ...nexumGlobalFilterDefaults(), ...JSON.parse(sessionStorage.getItem(NEXUM_GLOBAL_FILTERS_STORAGE) || '{}') }; } catch (_) { window.nexumGlobalFilters = nexumGlobalFilterDefaults(); } window.nexumSetGlobalFilters = (value) => { const next = { ...nexumGlobalFilterDefaults(), ...value, favorite:Boolean(value?.favorite) }; window.nexumGlobalFilters = next; sessionStorage.setItem(NEXUM_GLOBAL_FILTERS_STORAGE, JSON.stringify(next)); window.dispatchEvent(new CustomEvent('nexum:global-filters', { detail:next })); window.refreshNexumGlobalFooter?.(); }; }
initializeNexumGlobalFilters();

function clearNexumAllFilters() {
  // Primeiro limpa recortes específicos da tela; depois publica um único estado global vazio.
  window.nexumClearAllMapFilters?.({ syncGlobal:false });
  window.nexumClearGlobalFilterControls?.();
  window.dispatchEvent(new CustomEvent('nexum:clear-enterprise-selection'));
  window.nexumSetGlobalFilters?.({ ...nexumGlobalFilterDefaults(), period:'' });
  window.dispatchEvent(new CustomEvent('nexum:clear-all-filters'));
}
window.nexumClearAllFilters = clearNexumAllFilters;

function mountNexumClearAllFilters() {
  if (!getCTIUser() || document.body.classList.contains('login-page') || document.getElementById('nexum-clear-all-filters')) return;
  const button = document.createElement('button');
  button.id = 'nexum-clear-all-filters'; button.type = 'button'; button.className = 'nexum-global-clear-filters nexum-floating-action';
  button.setAttribute('aria-label','Limpar todos os filtros'); button.dataset.tooltip = 'Apagar todos os filtros'; button.title = 'Apagar todos os filtros';
  button.innerHTML = '<img src="/logo/clear-filters.svg" alt="" aria-hidden="true">';
  button.onclick = clearNexumAllFilters;
  const mapActions = document.getElementById('map-enterprise-action'), homeActions = document.getElementById('nexum-home-floating-actions'), pageActions = document.querySelector('.home-page .nexum-page-action-controls');
  (mapActions || homeActions || pageActions || document.body).append(button);
}

function mountNexumGlobalFilters(trigger) {
  if (!trigger || document.getElementById('nexum-global-filter')) return;
  const emptyFilters = nexumGlobalFilterDefaults(), stored = { ...emptyFilters, ...(window.nexumGlobalFilters || {}) }, values = (key) => String(stored[key] || '').split(',').filter(Boolean);
  const panel = document.createElement('aside'); panel.id = 'nexum-global-filter'; panel.className = 'nexum-global-filter'; panel.hidden = true; panel.setAttribute('aria-label', 'Filtros globais');
  const filterIcon = (group) => ({ dormitorios:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18v-7a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v2h7a3 3 0 0 1 3 3v2M3 18v3m18-3v3M3 18h18M6 8V5h9a3 3 0 0 1 3 3v5"/></svg>', caracteristicas:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.38 1.06 6.18L12 17.18 6.44 20.1 7.5 13.92 3 9.54l6.22-.91L12 3Z"/></svg>', vagas:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16 1.6-6.1A2 2 0 0 1 8.53 8.4h6.94a2 2 0 0 1 1.93 1.5L19 16M4 16h16v4H4zM7 20v1m10-1v1M7 16h.01M17 16h.01"/></svg>' })[group] || '';
  const checkGroup = (group, title, items) => `<section class="nexum-filter-group nexum-filter-group-${group}"><div class="nexum-filter-group-title"><span>${filterIcon(group)}</span><strong>${title}</strong></div><div class="nexum-filter-options">${items.map(([key,label])=>`<label class="nexum-filter-option"><input type="checkbox" data-filter-group="${group}" value="${key}" ${values(group).includes(key)?'checked':''}><span>${label}</span></label>`).join('')}</div></section>`;
  panel.innerHTML = `<header><div><span>FILTROS</span><h2>Refinar contexto</h2></div><button type="button" data-close aria-label="Fechar filtros">×</button></header><div class="nexum-global-filter-body"><label>Período<select data-period><option value="">Todos os períodos</option><option value="30d">Últimos 30 dias</option><option value="current-month">Mês atual</option><option value="60d">Últimos 60 dias</option><option value="90d">Últimos 90 dias</option><option value="12m">Últimos 12 meses</option><option value="current-year">Ano corrente</option></select></label><label>Buscar<input type="search" data-search placeholder="Empreendimento ou localização"></label><label>Bairro<input type="search" data-bairro-search placeholder="Buscar bairro..." list="nexum-neighborhood-options"><input type="hidden" data-bairro><datalist id="nexum-neighborhood-options"></datalist></label><label>Tipo de imóvel<select data-tipo><option value="">Todos</option></select></label><label>Padrão Econômico<select data-padrao><option value="">Todos</option></select></label><label>Status / fase<select data-fase><option value="">Todos</option><option>Lançamento</option><option>Novo</option><option>Entregue</option></select></label><label>Faixa de valor<select data-ticket><option value="">Todas</option><option value="ate-500">Até R$ 500 mil</option><option value="500-800">R$ 500 mil a R$ 800 mil</option><option value="800-1200">R$ 800 mil a R$ 1,2 mi</option><option value="acima-1200">Acima de R$ 1,2 mi</option></select></label>${checkGroup('dormitorios','Dormitórios',[['1','1 quarto'],['2','2 quartos'],['3','3 quartos'],['4','4 quartos'],['5_mais','5+ quartos']])}${checkGroup('caracteristicas','Características',[['suite','Suíte'],['area_lazer','Área de lazer'],['piscina','Piscina'],['mobiliado','Mobiliado'],['financiavel','Financiável']])}${checkGroup('vagas','Vagas',[['1','1 vaga'],['2','2 vagas'],['3','3 vagas'],['4_mais','4+ vagas']])}${checkGroup('operacoes','Operações',[['locacao_ofertada','Locação ofertada'],['locacao_procurada','Locação procurada'],['venda_ofertada','Venda ofertada'],['repasse','Repasse'],['compra_procurada','Compra procurada'],['permuta','Permuta'],['indefinida','Indefinida']])}<label class="nexum-favorite-filter"><input type="checkbox" data-favorite> Mostrar somente favoritos</label></div><footer><button type="button" data-clear>Limpar tudo</button><button type="button" class="button teal" data-apply>Aplicar filtros</button></footer>`;
  const compactFeature = (key, label, className = 'nexum-filter-option') => `<label class="${className}"><input type="checkbox" data-filter-group="caracteristicas" value="${key}" ${values('caracteristicas').includes(key)?'checked':''}><span>${label}</span></label>`;
  panel.querySelector('.nexum-filter-group-caracteristicas .nexum-filter-options').insertAdjacentHTML('beforeend', compactFeature('condominio_fechado','Condomínio fechado'));
  panel.querySelector('.nexum-filter-group-vagas').insertAdjacentHTML('beforeend', compactFeature('vaga_coberta','Vaga coberta','nexum-filter-covered'));
  document.body.append(panel);
  const period=panel.querySelector('[data-period]'),search=panel.querySelector('[data-search]'),bairro=panel.querySelector('[data-bairro]'),bairroSearch=panel.querySelector('[data-bairro-search]'),tipo=panel.querySelector('[data-tipo]'),padrao=panel.querySelector('[data-padrao]'),fase=panel.querySelector('[data-fase]'),ticket=panel.querySelector('[data-ticket]'),favorite=panel.querySelector('[data-favorite]');
  let neighborhoods=[];
  const syncControls=(state={})=>{const next={...emptyFilters,...state},selectedValues=(key)=>String(next[key]||'').split(',').filter(Boolean);period.value=next.period||'';search.value=next.search||'';bairro.value=next.bairro||'';tipo.value=next.tipo||'';padrao.value=next.padrao||'';fase.value=next.fase||'';ticket.value=next.ticket||'';favorite.checked=Boolean(next.favorite);panel.querySelectorAll('[data-filter-group]').forEach(node=>node.checked=selectedValues(node.dataset.filterGroup).includes(node.value));const selectedNeighborhood=neighborhoods.find(item=>item.id===next.bairro);bairroSearch.value=selectedNeighborhood?`${selectedNeighborhood.nome}${selectedNeighborhood.cidade?` — ${selectedNeighborhood.cidade}/${selectedNeighborhood.uf}`:''}`:'';};
  window.nexumClearGlobalFilterControls=()=>syncControls({...nexumGlobalFilterDefaults(),period:''});
  window.addEventListener('nexum:global-filters',event=>syncControls(event.detail||{}));
  syncControls(stored);
  const close=()=>{panel.hidden=true;trigger.setAttribute('aria-expanded','false')}; const grouped=(key)=>[...panel.querySelectorAll(`[data-filter-group="${key}"]:checked`)].map(node=>node.value).join(',');
  const apply=()=>{window.nexumSetGlobalFilters({period:period.value,search:search.value.trim(),bairro:bairro.value,tipo:tipo.value,padrao:padrao.value,fase:fase.value,ticket:ticket.value,dormitorios:grouped('dormitorios'),caracteristicas:grouped('caracteristicas'),vagas:grouped('vagas'),operacoes:grouped('operacoes'),favorite:favorite.checked});close()};
  trigger.type='button';trigger.onclick=()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)search.focus()};panel.querySelector('[data-close]').onclick=close;panel.querySelector('[data-apply]').onclick=apply;panel.querySelector('[data-clear]').onclick=()=>{period.value='';search.value='';bairro.value='';bairroSearch.value='';tipo.value='';padrao.value='';fase.value='';ticket.value='';favorite.checked=false;panel.querySelectorAll('[data-filter-group]').forEach(node=>node.checked=false);window.dispatchEvent(new CustomEvent('nexum:clear-enterprise-selection'));apply()};document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)close()});
  Promise.all([fetch('/api/dominios').then(response=>response.ok?response.json():Promise.reject()),fetch('/api/empreendimentos').then(response=>response.ok?response.json():Promise.reject())]).then(([domains,records])=>{window.nexumDomains=domains;const options=(element,rows)=>{element.innerHTML='<option value="">Todos</option>'+rows.map(([value,label])=>`<option value="${escapeNexumHtml(value)}">${escapeNexumHtml(label)}</option>`).join('')};options(tipo,[...new Set(records.map(item=>item.tipo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(item=>[item,item]));options(padrao,(domains.economicStandards||[]).map(item=>[item.id,item.nome]));neighborhoods=domains.neighborhoods||[];panel.querySelector('#nexum-neighborhood-options').innerHTML=neighborhoods.map(item=>`<option value="${escapeNexumHtml(`${item.nome}${item.cidade?` — ${item.cidade}/${item.uf}`:''}`)}" data-id="${escapeNexumHtml(item.id)}"></option>`).join('');bairroSearch.oninput=()=>{const selectedOption=[...neighborhoods].find(item=>`${item.nome}${item.cidade?` — ${item.cidade}/${item.uf}`:''}`===bairroSearch.value);bairro.value=selectedOption?.id||''};syncControls(window.nexumGlobalFilters||{})}).catch(()=>{});
}

function enhanceNexumNavigationV2() {
  const user = getCTIUser(); const nav = document.querySelector('.topbar .nav');
  if (!user || document.body.classList.contains('login-page') || !nav || nav.dataset.nexumHeader === 'ready') return;
  const enterpriseLink = [...nav.querySelectorAll('a')].find((link) => /empreendimentos\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  const mapLink = [...nav.querySelectorAll('a')].find((link) => /mapa\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  if (!mapLink) return;
  const currentId = new URLSearchParams(location.search).get('id');
  const currentPage = location.pathname.split('/').pop() || 'inicio.html';
  const isHome = currentPage === 'inicio.html' || location.pathname.endsWith('/');
  const isMap = currentPage === 'mapa.html';
  const isAnalytics = currentPage === 'analytics.html' || location.pathname === '/analytics';
  const isRede = /^rede-(mercados|gis|corretores|bairros|revisao|importar)\.html$/.test(currentPage);
  const isEnterpriseContext = /^(empreendimento|simulador)\.html$/.test(currentPage);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const icons = {
    home: '<svg class="nav-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
    enterprises: '<svg class="nav-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 21V4.5L12 2v19"/><path d="M12 21h8V7l-8-2.5"/><path d="M7 7h2"/><path d="M7 11h2"/><path d="M7 15h2"/><path d="M15 10h2"/><path d="M15 14h2"/><path d="M15 18h2"/></svg>',
    map: '<svg class="nav-menu-icon nav-map-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>',
    analytics: '<svg class="nav-menu-icon nav-analytics-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 19.5h16"/><path d="M6.5 16V11"/><path d="M11.5 16V7"/><path d="M16.5 16v-4"/><path d="m5 9 5-4 4 2 5-5"/></svg>',
    network: '<svg class="nav-menu-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="m10.7 7.2-4.4 8.5M13.3 7.2l4.4 8.5M7.5 18h9"/></svg>'
  };
  const home = document.createElement('a'); home.href = pageUrl('inicio.html'); home.className = isHome ? 'active nav-home-link' : 'nav-home-link'; home.innerHTML = `${icons.home}<span>Início</span>`;
  mapLink.className = `${isMap ? 'active ' : ''}nav-map-link`; mapLink.innerHTML = `${icons.map}<span>Mapa</span>`;
  const enterprises = document.createElement('a'); enterprises.href = pageUrl('empreendimentos.html'); enterprises.className = currentPage === 'empreendimentos.html' ? 'active nav-enterprises-link' : 'nav-enterprises-link'; enterprises.innerHTML = `${icons.enterprises}<span>Empreendimentos</span>`;
  const analytics = document.createElement('a'); analytics.className = `${isAnalytics ? 'active ' : ''}nav-analytics`; analytics.href = pageUrl('analytics.html'); analytics.innerHTML = `${icons.analytics}<span>Analytics</span>`;
  const rede = document.createElement('a'); rede.className = `${isRede ? 'active ' : ''}nav-analytics nav-rede`; rede.href = pageUrl('rede-mercados.html'); rede.innerHTML = `${icons.network}<span>Rede</span>`;
  const mapFilters = document.getElementById('open-filters');
  const notifications = document.createElement('button'); notifications.type = 'button'; notifications.className = 'nav-notifications'; notifications.title = 'Notificações';
  notifications.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="nav-notification-count" data-notification-count hidden></span><i class="sr-only">Notificações</i>';
  const profile = document.createElement('button'); profile.type = 'button'; profile.className = 'nav-profile'; profile.title = `Sair como ${user.name}`;
  profile.innerHTML = `<b>${escape(String(user.name || 'U').trim().slice(0, 1).toUpperCase())}</b><span><strong>${escape(user.name || 'Usuário')}</strong><small>Sair</small></span>`;
  profile.onclick = () => logoutCTI();
  nav.replaceChildren(home, enterprises, mapLink, analytics, rede, notifications, profile); nav.dataset.nexumHeader = 'ready';
  mountNexumNotifications(notifications);
  if (isRede) return;
  // O Analytics possui sua própria barra de ações flutuantes. A barra global
  // antiga adicionava um título e uma linha azul antes da hidratação da página.
  if (isAnalytics) return;
  if (document.body.classList.contains('nexum-home-page')) return;
  const action = document.createElement('button'); action.type = 'button'; action.className = 'nexum-enterprise-page-trigger'; action.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 21V4.5L12 2v19M12 21h8V7l-8-2.5M7 7h2M7 11h2M7 15h2M15 10h2M15 14h2M15 18h2"/></svg><span>Empreendimentos</span>';
  const mapAction = document.getElementById('map-enterprise-action');
  if (mapAction) { action.classList.add('nexum-floating-action'); action.setAttribute('aria-label','Empreendimentos'); action.dataset.tooltip = 'Empreendimentos'; action.title = 'Empreendimentos'; action.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 21V4.5L12 2v19"/><path d="M12 21h8V7l-8-2.5"/><path d="M7 7h2"/><path d="M7 11h2"/><path d="M7 15h2"/><path d="M15 10h2"/><path d="M15 14h2"/><path d="M15 18h2"/></svg>'; mapAction.append(action); if (mapFilters) { mapFilters.className = 'map-context-filter nexum-floating-action'; mapFilters.setAttribute('aria-label','Filtro'); mapFilters.dataset.tooltip = 'Filtro'; mapFilters.title = 'Filtro'; mapFilters.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false" xmlns="http://www.w3.org/2000/svg"><path d="M4 5H20L14 12V18L10 20V12L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; mapAction.append(mapFilters); mountNexumGlobalFilters(mapFilters); } }
  else {
    const pageTitles = { 'empreendimentos.html':'Empreendimentos', 'analytics.html':'Analytics', 'empreendimento.html':'Empreendimento', 'analise.html':'Tabela Geral', 'simulador.html':'Simulador' };
    const actionBar = document.createElement('section'); actionBar.className = 'nexum-page-action-bar';
    const title = document.createElement('h1'); title.id = 'nexum-page-title'; title.textContent = pageTitles[currentPage] || 'NEXUM';
    const controls = document.createElement('div'); controls.className = 'nexum-page-action-controls';
    const extras = document.createElement('div'); extras.id = 'nexum-page-extra-actions'; extras.className = 'nexum-page-extra-actions';
    const contextFilter = document.createElement('button'); contextFilter.type = 'button'; contextFilter.className = 'nexum-context-filter'; contextFilter.setAttribute('aria-label','Filtros'); contextFilter.title = 'Filtros'; contextFilter.innerHTML = '<span>Filtro</span><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" focusable="false" xmlns="http://www.w3.org/2000/svg"><path d="M4 5H20L14 12V18L10 20V12L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    let add = null;
    controls.append(extras, action);
    // Cadastro estrutural pertence exclusivamente à área /gestao.
    controls.append(contextFilter); mountNexumGlobalFilters(contextFilter); actionBar.append(title, controls); const homeColumn = isHome ? document.querySelector('.home-left-column') : null;
    if (homeColumn) {
      actionBar.classList.add('home-local-action-bar'); homeColumn.prepend(actionBar);
      const homeActions = document.createElement('section'); homeActions.id = 'nexum-home-floating-actions'; homeActions.setAttribute('aria-label','Ações do portfólio');
      const makeFloating = (element, label, icon) => { element.classList.add('nexum-floating-action'); element.setAttribute('aria-label',label); element.dataset.tooltip=label; element.title=label; element.innerHTML=icon; homeActions.append(element); };
      makeFloating(action,'Empreendimentos','<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 21V4.5L12 2v19"/><path d="M12 21h8V7l-8-2.5"/><path d="M7 7h2M7 11h2M7 15h2M15 10h2M15 14h2M15 18h2"/></svg>');
      makeFloating(contextFilter,'Filtro','<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 5H20L14 12V18L10 20V12L4 5Z"/></svg>');
      if (add) makeFloating(add,'Novo empreendimento','<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M12 5v14M5 12h14"/></svg>');
      actionBar.hidden = true; document.body.append(homeActions);
    } else document.querySelector('.topbar').insertAdjacentElement('afterend', actionBar);
    window.nexumSetPageTitle = (value) => { title.textContent = value || pageTitles[currentPage] || 'NEXUM'; };
    window.nexumSetPageActions = (buttons = []) => extras.replaceChildren(...buttons);
  }
  mountNexumEnterpriseSelector(action);
}

function enhanceManagementNavigation() {
  const nav = document.querySelector('.gestao-page .topbar .nav');
  if (!nav) return;
  if(!nav.querySelector('[href="/gestao/desaceleracao-ivv.html"]')) {
    const link=document.createElement('a');link.href='/gestao/desaceleracao-ivv.html';link.textContent='Parâmetros · IVV';
    const returnLink=[...nav.querySelectorAll('a')].find(a=>/voltar.*nexum/i.test(a.textContent));
    if(returnLink)nav.insertBefore(link,returnLink);else nav.append(link);
  }
  if (![...nav.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/gestao/importar-json')) {
    const anchor = [...nav.querySelectorAll('a')].find((link) => link.getAttribute('href') === '/gestao/tabelas') || nav.querySelector('a');
    const link = document.createElement('a'); link.href = '/gestao/importar-json'; link.textContent = 'Importar JSON';
    anchor?.insertAdjacentElement('afterend', link);
  }
  if (!nav.querySelector('[data-management-notifications]')) {
    const returnLink=[...nav.querySelectorAll('a')].find((link)=>/voltar.*nexum/i.test(link.textContent)||['/','/index.html','../index.html'].includes(link.getAttribute('href')));
    const button=document.createElement('button');button.type='button';button.className='nav-notification-button management-notification-button';button.dataset.managementNotifications='true';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span data-notification-count hidden></span>';
    button.setAttribute('aria-label','Pendências operacionais');
    returnLink?.insertAdjacentElement('afterend',button) || nav.prepend(button);
    mountNexumNotifications(button,'gestao');
  }
}
function enhanceEnterprisePhaseOptions() {
  document.querySelectorAll('select[name="fase"], select[data-fase], select#phase').forEach((select) => {
    if ([...select.options].some((option) => option.value === 'Em obras' || option.textContent.trim() === 'Em obras')) return;
    const option = document.createElement('option'); option.value = 'Em obras'; option.textContent = 'Em obras';
    const delivered = [...select.options].find((item) => item.value === 'Entregue' || item.textContent.trim() === 'Entregue');
    delivered ? select.insertBefore(option, delivered) : select.append(option);
  });
}
function enhanceEnterpriseDeleteAction() {
  const form = document.querySelector('#enterprise-form'), id = new URLSearchParams(location.search).get('id');
  if (!form || !id || form.querySelector('[data-delete-enterprise]')) return;
  const footer = form.querySelector('.form-footer'); if (!footer) return;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button danger-button'; button.dataset.deleteEnterprise = 'true'; button.textContent = 'Excluir empreendimento';
  button.onclick = async () => {
    const reason = window.prompt('Motivo da exclusão do empreendimento (opcional):', ''); if (reason === null) return;
    if (!window.confirm('O empreendimento sairá da operação e será preservado como registro inativo. Confirmar exclusão?')) return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/empreendimentos/${encodeURIComponent(id)}${reason.trim() ? `?motivo=${encodeURIComponent(reason.trim())}` : ''}`, { method: 'DELETE' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível excluir o empreendimento.');
      location.href = '/gestao/empreendimentos';
    } catch (error) { window.alert(error.message); button.disabled = false; }
  };
  footer.prepend(button);
}
function mountNexumShell() { mountNexumFooter(); enhanceManagementNavigation(); enhanceEnterprisePhaseOptions(); enhanceEnterpriseDeleteAction(); if (!window.nexumPhaseObserver && window.MutationObserver) { window.nexumPhaseObserver = new MutationObserver(() => { enhanceEnterprisePhaseOptions(); enhanceEnterpriseDeleteAction(); }); window.nexumPhaseObserver.observe(document.body, { childList:true, subtree:true }); } enhanceNexumNavigationV2(); if (!document.body.classList.contains('nexum-home-page') && !document.body.classList.contains('nexum-portfolio-frame')) mountNexumClearAllFilters(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNexumShell, { once: true });
else mountNexumShell();
