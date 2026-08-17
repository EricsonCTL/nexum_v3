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

function mountNexumShell() { mountNexumFooter(); enhanceNexumNavigation(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNexumShell, { once: true });
else mountNexumShell();
