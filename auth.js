const CTI_SESSION_KEY = 'ctiUserSession';

const CTI_USERS = {
  ADMIN: {
    code: 'ADMIN',
    name: 'Marcos',
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
    window.location.replace(pageUrl('index.html'));
    return null;
  }
  const isLegacyCommercialAccess = user.role === 'INCORPORADORA' && allowedRoles?.includes('BROKER');
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(user.role) && !isLegacyCommercialAccess) {
    window.location.replace(pageUrl('empreendimentos.html'));
    return null;
  }
  return user;
}

function logoutCTI() {
  clearCTIUser();
  window.location.href = pageUrl('index.html');
}

function mountNexumFooter() {
  if (!getCTIUser() || document.body.classList.contains('map-page') || document.querySelector('.app-statusbar')) return;
  const footer = document.createElement('footer');
  footer.className = 'app-statusbar app-global-footer';
  footer.innerHTML = '<p>© Ericson Tenório 2026. Todos os direitos reservados.</p>';
  document.body.append(footer);
}

function enhanceNexumNavigation() {
  const user = getCTIUser(); const nav = document.querySelector('.topbar .nav');
  if (!user || document.body.classList.contains('login-page') || !nav || nav.querySelector('.enterprise-nav-menu')) return;
  const enterpriseLink = [...nav.querySelectorAll('a')].find((link) => /empreendimentos\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  if (!enterpriseLink) return;
  const isHome = /empreendimentos\.html$/.test(location.pathname) || location.pathname.endsWith('/');
  const home = document.createElement('a'); home.href = pageUrl('empreendimentos.html'); home.textContent = 'Início'; home.className = isHome ? 'active nav-home-link' : 'nav-home-link';
  const menu = document.createElement('div'); menu.className = 'enterprise-nav-menu';
  menu.innerHTML = `<button class="nav-enterprise-trigger ${isHome ? '' : 'active'}" type="button" aria-expanded="false">Empreendimentos <span>⌄</span></button><section class="enterprise-nav-panel" hidden><div class="enterprise-nav-search"><input type="search" placeholder="Buscar empreendimento" aria-label="Buscar empreendimento"><a class="button teal" href="${pageUrl('empreendimento.html')}?novo=1">+ Novo</a></div><div class="enterprise-nav-results" role="listbox"><p>Carregando empreendimentos…</p></div></section>`;
  enterpriseLink.replaceWith(menu); nav.insertBefore(home, menu);
  const exit = nav.querySelector('button[onclick*="logoutCTI"]');
  if (exit && !nav.querySelector('.nav-notifications')) { const notifications = document.createElement('button'); notifications.type = 'button'; notifications.className = 'nav-notifications'; notifications.setAttribute('aria-label', 'Notificações'); notifications.title = 'Notificações'; notifications.innerHTML = '<span>◔</span><small>Notificações</small>'; nav.insertBefore(notifications, exit); }
  const mapFilters = document.getElementById('open-filters');
  if (exit && mapFilters) { mapFilters.classList.add('nav-filters'); nav.insertBefore(mapFilters, exit); }
  else if (exit && !nav.querySelector('.nav-filters')) { const filters = document.createElement('a'); filters.className = 'nav-filters'; filters.href = `${pageUrl('mapa.html')}?filtros=1`; filters.textContent = 'Filtros'; nav.insertBefore(filters, exit); }
  const trigger = menu.querySelector('.nav-enterprise-trigger'), panel = menu.querySelector('.enterprise-nav-panel'), input = menu.querySelector('input'), results = menu.querySelector('.enterprise-nav-results'); let records = [];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const draw = () => { const query = input.value.trim().toLocaleLowerCase('pt-BR'); const filtered = records.filter((item) => `${item.nome} ${item.bairro || ''} ${item.cidade || ''}`.toLocaleLowerCase('pt-BR').includes(query)); results.innerHTML = filtered.length ? filtered.map((item) => `<a role="option" data-enterprise-id="${escape(item.id)}" data-enterprise-name="${escape(item.nome)}" href="${pageUrl('empreendimentos.html')}?empreendimento=${encodeURIComponent(item.id)}"><strong>${escape(item.nome)}</strong><span>${escape([item.bairro,item.cidade,item.estado].filter(Boolean).join(' · ') || 'Ver ações do empreendimento')}</span></a>`).join('') : '<p>Nenhum empreendimento encontrado.</p>'; };
  trigger.onclick = () => { const open = trigger.getAttribute('aria-expanded') === 'true'; trigger.setAttribute('aria-expanded', String(!open)); panel.hidden = open; if (!open) input.focus(); };
  input.oninput = draw;
  results.onclick = (event) => { const selected = event.target.closest('[data-enterprise-id]'); if (!selected || !isHome) return; event.preventDefault(); window.dispatchEvent(new CustomEvent('nexum:filter-enterprise', { detail: { id: selected.dataset.enterpriseId, name: selected.dataset.enterpriseName } })); trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true; };
  document.addEventListener('click', (event) => { if (!menu.contains(event.target)) { trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true; } });
  fetch('/api/empreendimentos').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { records = data; draw(); }).catch(() => { results.innerHTML = '<p>Não foi possível carregar os empreendimentos.</p>'; });
}

function enhanceNexumNavigationV2() {
  const user = getCTIUser(); const nav = document.querySelector('.topbar .nav');
  if (!user || document.body.classList.contains('login-page') || !nav || nav.dataset.nexumHeader === 'ready') return;
  const enterpriseLink = [...nav.querySelectorAll('a')].find((link) => /empreendimentos\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  const mapLink = [...nav.querySelectorAll('a')].find((link) => /mapa\.html(?:$|[?#])/.test(link.getAttribute('href') || ''));
  if (!enterpriseLink || !mapLink) return;
  const currentId = new URLSearchParams(location.search).get('id');
  const currentPage = location.pathname.split('/').pop() || 'empreendimentos.html';
  const isHome = currentPage === 'empreendimentos.html' || location.pathname.endsWith('/');
  const isMap = currentPage === 'mapa.html';
  const isAnalytics = /^(radar|analise)\.html$/.test(currentPage);
  const isEnterpriseContext = /^(empreendimento|simulador)\.html$/.test(currentPage);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const home = document.createElement('a'); home.href = pageUrl('empreendimentos.html'); home.className = isHome ? 'active nav-home-link' : 'nav-home-link'; home.innerHTML = '<span aria-hidden="true">⌂</span> Início';
  mapLink.className = isMap ? 'active' : ''; mapLink.textContent = 'Mapa';
  const portfolio = document.createElement('div'); portfolio.className = 'enterprise-nav-menu nav-portfolio-menu';
  portfolio.innerHTML = `<button class="nav-enterprise-trigger ${isEnterpriseContext ? 'active' : ''}" type="button" aria-expanded="false">Empreendimentos <span aria-hidden="true"></span></button><section class="enterprise-nav-panel" hidden><div class="enterprise-nav-search"><input type="search" placeholder="Buscar empreendimento" aria-label="Buscar empreendimento"><a class="button teal" href="${pageUrl('empreendimento.html')}?novo=1">+ Novo</a></div><div class="enterprise-nav-results" role="listbox"><p>Carregando empreendimentos…</p></div></section>`;
  const analytics = document.createElement('a'); analytics.className = `${isAnalytics ? 'active ' : ''}nav-analytics`; analytics.href = currentId ? `${pageUrl('radar.html')}?id=${encodeURIComponent(currentId)}` : pageUrl('empreendimentos.html'); analytics.textContent = 'Analytics';
  const search = document.createElement('div'); search.className = 'nav-global-search';
  search.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" placeholder="Buscar empreendimento ou bairro" aria-label="Busca global de empreendimentos"><section class="nav-global-results" hidden role="listbox"></section>';
  const notifications = document.createElement('button'); notifications.type = 'button'; notifications.className = 'nav-notifications'; notifications.setAttribute('aria-label', 'Notificações'); notifications.title = 'Notificações'; notifications.innerHTML = '<svg aria-hidden="true" viewBox="0 0 64 64" focusable="false"><defs><linearGradient id="nexum-bell-gradient" x1="16" y1="8" x2="49" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#A5FFF5"/><stop offset=".5" stop-color="#36DED1"/><stop offset="1" stop-color="#09A9A1"/></linearGradient></defs><path d="M32 8C23.7 8 17 14.7 17 23v8.2c0 4.6-1.5 8-4.6 11C11.1 43.5 12 45.8 13.8 45.8h36.4c1.8 0 2.7-2.3 1.4-3.6-3.1-3-4.6-6.4-4.6-11V23C47 14.7 40.3 8 32 8Z" fill="none" stroke="url(#nexum-bell-gradient)" stroke-width="4" stroke-linejoin="round"/><path d="M23 51c1.8 3.5 4.8 5.5 9 5.5s7.2-2 9-5.5" fill="none" stroke="#D8FFFF" stroke-width="4" stroke-linecap="round"/></svg><i class="sr-only">Notificações</i>';
  const mapFilters = document.getElementById('open-filters');
  const filters = mapFilters || document.createElement('a'); filters.classList.add('nav-filter-icon'); filters.setAttribute('aria-label','Filtros'); filters.title='Filtros';
  if (!mapFilters) filters.href = `${pageUrl('mapa.html')}?filtros=1`; filters.innerHTML = '<span aria-hidden="true"></span>';
  const profile = document.createElement('button'); profile.type = 'button'; profile.className = 'nav-profile'; profile.title = `Sair como ${user.name}`;
  profile.innerHTML = `<b>${escape(String(user.name || 'U').trim().slice(0, 1).toUpperCase())}</b><span><strong>${escape(user.name || 'Usuário')}</strong><small>Sair</small></span>`;
  profile.onclick = () => logoutCTI();
  nav.replaceChildren(home, portfolio, mapLink, analytics, search, filters, notifications, profile); nav.dataset.nexumHeader = 'ready';
  const trigger = portfolio.querySelector('.nav-enterprise-trigger'), panel = portfolio.querySelector('.enterprise-nav-panel'), portfolioInput = portfolio.querySelector('input'), portfolioResults = portfolio.querySelector('.enterprise-nav-results');
  const globalInput = search.querySelector('input'), globalResults = search.querySelector('.nav-global-results'); let records = [];
  const resultMarkup = (items) => items.length ? items.map((item) => `<a role="option" href="${pageUrl('empreendimento.html')}?id=${encodeURIComponent(item.id)}"><strong>${escape(item.nome)}</strong><span>${escape([item.bairro,item.cidade,item.estado].filter(Boolean).join(' · ') || 'Abrir cadastro')}</span></a>`).join('') : '<p>Nenhum empreendimento encontrado.</p>';
  const filtered = (query) => records.filter((item) => `${item.nome} ${item.bairro || ''} ${item.cidade || ''}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
  const drawPortfolio = () => { portfolioResults.innerHTML = resultMarkup(filtered(portfolioInput.value)); };
  const drawGlobal = () => { globalResults.innerHTML = resultMarkup(filtered(globalInput.value)); globalResults.hidden = false; };
  trigger.onclick = () => { const open = trigger.getAttribute('aria-expanded') === 'true'; trigger.setAttribute('aria-expanded', String(!open)); panel.hidden = open; if (!open) portfolioInput.focus(); };
  portfolioInput.oninput = drawPortfolio; globalInput.oninput = drawGlobal; globalInput.onfocus = drawGlobal;
  document.addEventListener('click', (event) => { if (!portfolio.contains(event.target)) { trigger.setAttribute('aria-expanded', 'false'); panel.hidden = true; } if (!search.contains(event.target)) globalResults.hidden = true; });
  fetch('/api/empreendimentos').then((response) => response.ok ? response.json() : Promise.reject()).then((data) => { records = data; drawPortfolio(); }).catch(() => { portfolioResults.innerHTML = '<p>Não foi possível carregar os empreendimentos.</p>'; });
}

function mountNexumShell() { mountNexumFooter(); enhanceNexumNavigationV2(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNexumShell, { once: true });
else mountNexumShell();
