document.addEventListener('DOMContentLoaded', () => {
  let selected = 'ADMIN';
  const options = [...document.querySelectorAll('[data-user-code]')];
  function select(code) {
    selected = code;
    options.forEach((option) => {
      const active = option.dataset.userCode === code;
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-pressed', String(active));
    });
  }
  options.forEach((button) => button.addEventListener('click', () => select(button.dataset.userCode)));
  document.getElementById('login-submit').addEventListener('click', () => {
    if (setCTIUser(selected)) window.location.href = './empreendimentos.html';
  });
});
