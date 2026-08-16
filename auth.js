const CTI_SESSION_KEY = 'ctiUserSession';

const CTI_USERS = {
  ADMIN: {
    code: 'ADMIN',
    name: 'Marcos',
    role: 'ADMIN',
    roleLabel: 'Administrador'
  },
  BROKER: {
    code: 'BROKER',
    name: 'Corretor',
    role: 'BROKER',
    roleLabel: 'Corretor'
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
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(user.role)) {
    window.location.replace(pageUrl('empreendimentos.html'));
    return null;
  }
  return user;
}

function logoutCTI() {
  clearCTIUser();
  window.location.href = pageUrl('index.html');
}
