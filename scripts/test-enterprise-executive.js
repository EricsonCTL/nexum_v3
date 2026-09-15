'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const response = await fetch('http://localhost:3000/api/empreendimentos/EMP-000001/analytics');
  assert.equal(response.status, 200, 'A leitura individual deve estar disponível.');
  const data = await response.json();
  assert.equal(data.contextoCompetitivo.territorial.raioKm, 2, 'A leitura territorial usa exatamente 2 km.');
  assert.match(data.contextoCompetitivo.territorial.leitura, /2 km/);
  assert.equal(data.indicesMacroPeriodo.descricao, 'Acumulado composto dos últimos 12 meses publicados.');
  for (const index of ['igpm', 'ipca', 'incc']) {
    assert.equal(data.indicesMacro[index].period.meses, 12, `${index} deve usar 12 divulgações publicadas.`);
    assert.ok(Number.isFinite(data.indicesMacro[index].accumulated), `${index} precisa de acumulado calculado.`);
  }
  assert.ok(data.radarNexum && Object.keys(data.radarNexum.values).length >= 6, 'O Radar NEXUM deve acompanhar o ativo.');
  const page = fs.readFileSync('analytics.html', 'utf8');
  assert.match(page, /detail-thermal-map/, 'A página individual deve conter o mapa térmico.');
  assert.match(page, /fitTerritorialView/, 'O mapa individual deve permitir reenquadrar o raio territorial.');
  assert.match(page, /paddingTopLeft:\[leftPanelPadding,22\]/, 'O enquadramento deve deslocar o ativo para fora do painel de leitura.');
  assert.match(page, /zoomControl:true/, 'O mapa individual deve oferecer zoom.');
  assert.match(page, /exact-iap-gauge/, 'A página individual deve conter a régua de aceitação de preço.');
  assert.match(page, /\['pressure','IPD \+ IPO'\]/, 'IPD e IPO devem ser uma seleção única no histórico.');
  assert.match(page, /label:'IPD · Demanda'.*label:'IPO · Oferta'/, 'O histórico territorial deve desenhar as duas linhas no mesmo gráfico.');
  assert.match(page, /exactScenarioCompetitive\(data\)/, 'O cenário competitivo deve ser renderizado como bloco próprio.');
  assert.match(page, /data-open-detail-iap/, 'Os detalhes devem abrir por botão contextual.');
  console.log('OK: Raio territorial de 2 km, índices macro em 12 meses publicados e Raio-X executivo.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
