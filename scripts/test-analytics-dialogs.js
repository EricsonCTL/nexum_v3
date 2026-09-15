const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'analytics.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'nexo.css'), 'utf8');
for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  new vm.Script(script[1]);
}

const start = html.indexOf('    function openRadar()');
const end = html.indexOf('    function neighborhoodHeatRows(', start);
assert(start >= 0 && end > start, 'Os dois controladores devem existir.');
let dialog;
const context = {
  payload: { dispersao: [] },
  valid: value => value != null && Number.isFinite(Number(value)),
  esc: value => String(value ?? ''),
  money: value => `R$ ${value}`,
  num: value => String(value),
  percentValue: value => `${value}%`,
  window: { NexumRadarUI: {
    openRadar: options => { options.openOverlay('Radar', '', '<svg data-test="radar-only"></svg>'); },
    openAcceptance: options => { options.openOverlay('Aceitação de Preço', '', '<div data-test="acceptance-only"></div>'); }
  } },
  openOverlay: (title, subtitle, body) => { dialog = { title, body: body ?? subtitle }; }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

for (const rows of [[], [{
  empreendimento: 'Empreendimento de teste', ticketMedio: 350000,
  ivv: 2, vso: 5, vgvDisponivel: 14000000, disponiveis: 40,
  periodo: { mesInicial: '2026-01', mesFinal: '2026-02' }
}]]) {
  context.payload.dispersao = rows;
  context.openRadar();
  assert.equal(dialog.title, 'Radar');
  assert(dialog.body.includes('data-test="radar-only"'));
  assert(!dialog.body.includes('scatter-wrap'));
  context.openScatter();
  assert.equal(dialog.title, 'Dispersão preço × VSO');
  assert(!dialog.body.includes('radar-only'));
  assert(!dialog.body.includes('analytics-modal-radar'));
  assert(dialog.body.includes(rows.length ? 'scatter-wrap' : 'Não há preço e IVV'));
}

assert(html.includes('data-analytics-action="radar"'));
assert(html.includes('radar:openRadar'));
context.openAcceptance();
assert.equal(dialog.title, 'Aceitação de Preço');
assert(dialog.body.includes('acceptance-only'));
assert(html.indexOf('data-analytics-action="acceptance"') < html.indexOf('data-analytics-action="operations"'));
assert.match(html, /data-analytics-action="acceptance"[^]*?Aceitação de Preço<\/button><button type="button" data-analytics-action="operations"/);
assert(!html.includes('function overviewRadar('), 'O renderer legado de cinco eixos não deve continuar disponível.');
assert.equal((html.match(/function exactMaturityChart\(/g)||[]).length,1,'Deve existir apenas um renderer da curva de absorção.');
assert(html.includes('model.memoriaTrimestral||[]'),'O eixo X deve nascer somente da memória trimestral auditável.');
assert(!html.includes('meses de empreendimento'),'A idade histórica não pode aparecer no eixo da curva.');
assert(html.includes('dateLabel=month(row.dataProjetada)'),'O eixo X deve exibir o mês e ano da fotografia projetada.');
assert(html.includes("filter(row=>!row.terminal)"),'Pontos terminais fracionários não devem receber rótulos no gráfico.');
assert(html.includes("milestone('actual'")&&html.includes("milestone('projected'"),'Os cards verde e roxo devem permanecer ligados aos dois esgotamentos.');
assert.match(css,/\.maturity-milestone path\{[^}]*stroke-dasharray:/,'As linhas dos cards até o eixo X devem ser pontilhadas.');
console.log('OK: Radar, Dispersão e Aceitação de Preço são janelas independentes.');
