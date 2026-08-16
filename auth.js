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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNexumFooter, { once: true });
else mountNexumFooter();
