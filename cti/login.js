document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-user-code]').forEach((button) => {
    button.addEventListener('click', () => {
      const ok = setCTIUser(button.dataset.userCode);
      if (ok) window.location.href = './empreendimentos.html';
    });
  });
});
