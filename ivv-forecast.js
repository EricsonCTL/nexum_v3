'use strict';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function assertForecastInput({ curve, initialIvv, stock, segment }) {
  if (!curve?.available || !Array.isArray(curve.periods) || !curve.periods.length) throw new Error('Nenhuma Curva NEXUM validada disponível.');
  if (!finite(initialIvv) || initialIvv < 1) throw new Error('Dados insuficientes para projeção de IVV.');
  if (!finite(stock) || stock <= 0) throw new Error('Estoque disponível insuficiente para projeção de IVV.');
  if (!segment) throw new Error('Padrão econômico sem correspondência na Curva NEXUM.');
}

function validateReduction(reduction, band) {
  if (!finite(reduction) || reduction < 0 || reduction > .95) throw new Error(`Curva NEXUM inválida na faixa ${band?.faixa || 'não identificada'}.`);
}

function buildQuarterlySchedule({ curve, initialIvv, segment, maxHorizonMonths }) {
  const periods = curve.periods;
  const lastBandIndex = periods.length - 1;
  const schedule = [{
    forecastMonth: 0,
    previousIvv: initialIvv,
    appliedRate: null,
    projectedIvv: initialIvv,
    bandIndex: 0,
    band: periods[0]?.faixa || null,
    rule: 'T0_SEM_REDUCAO'
  }];
  let projectedIvv = initialIvv;
  let lastAppliedBandIndex = null;
  for (let forecastMonth = 3; forecastMonth <= maxHorizonMonths; forecastMonth += 3) {
    // A curva é sempre prospectiva: T0 é a fotografia; +3 usa 0–3,
    // +6 usa 3–6 e assim sucessivamente.
    // A idade histórica do empreendimento não entra no forecast.
    // O primeiro avanço trimestral recebe a primeira faixa (0–3), pois ela
    // descreve exatamente o primeiro trimestre contado a partir de T0.
    const bandIndex = Math.min(lastBandIndex, Math.floor((forecastMonth - 1) / 3));
    const band = periods[bandIndex];
    const previousIvv = projectedIvv;
    let appliedRate = null;
    let appliedReduction = null;
    let rule = 'FAIXA_JA_APLICADA_IVV_MANTIDO';
    if (bandIndex !== lastAppliedBandIndex) {
      appliedReduction = band?.rates?.[segment];
      validateReduction(appliedReduction, band);
      appliedRate = -appliedReduction;
      projectedIvv = Math.max(1, previousIvv * (1 - appliedReduction));
      lastAppliedBandIndex = bandIndex;
      rule = bandIndex === lastBandIndex ? 'ULTIMA_FAIXA_APLICADA_UMA_VEZ' : 'REDUCAO_RECURSIVA';
    }
    if (!finite(projectedIvv) || projectedIvv > previousIvv + 1e-12) throw new Error(`Falha de validação: IVV projetado crescente em +${forecastMonth} meses.`);
    schedule.push({ forecastMonth, previousIvv, appliedRate, appliedReduction, projectedIvv, bandIndex, band: band?.faixa || null, rule });
  }
  return schedule;
}

function buildScenarioSeries({ kind, depletionMonths, quarterly, valueAt, stockAt, initialStock }) {
  const rows = quarterly.filter((row) => row.forecastMonth < depletionMonths).map((row) => ({
    cenario: kind,
    meses: row.forecastMonth,
    label: row.forecastMonth === 0 ? 'Atual' : `+${row.forecastMonth} meses`,
    faixaMaturidade: row.band,
    valor: valueAt(row),
    saldo: stockAt(row.forecastMonth),
    vendasCiclo: Math.min(stockAt(row.forecastMonth), valueAt(row) * 3)
  }));
  const terminalQuarter = quarterly[Math.min(quarterly.length - 1, Math.floor(Math.max(0, depletionMonths - 1e-9) / 3))];
  rows.push({
    cenario: kind,
    meses: depletionMonths,
    label: `+${depletionMonths.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} meses`,
    faixaMaturidade: terminalQuarter.band,
    valor: valueAt(terminalQuarter),
    saldo: 0,
    vendasCiclo: null,
    terminal: true
  });
  return rows.length === 1 ? [{ ...rows[0], meses: 0, label: 'Atual', saldo: initialStock, terminal: false }, rows[0]] : rows;
}

function forecastAbsorption(input) {
  assertForecastInput(input);
  const { curve, initialIvv, stock, segment } = input;
  // Como o IVV projetado tem piso 1, estoque + uma margem para as faixas cobre
  // qualquer cenário válido sem criar uma cauda arbitrária de desaceleração.
  const maxHorizonMonths = Math.max(36, Math.ceil(stock) + 39);
  const quarterly = buildQuarterlySchedule({ curve, initialIvv, segment, maxHorizonMonths });
  const quarterlyByStartMonth = new Map(quarterly.map((row) => [row.forecastMonth, row]));
  const projectedAtMonthStart = (month) => quarterlyByStartMonth.get(Math.floor(Math.max(0, month - 1) / 3) * 3)?.projectedIvv ?? quarterly.at(-1).projectedIvv;
  let fixedStock = stock;
  let projectedStock = stock;
  let fixedDepletionMonths = null;
  let projectedDepletionMonths = null;
  const monthly = [{ month: 0, fixedIvv: initialIvv, projectedIvv: initialIvv, fixedSales: 0, projectedSales: 0, fixedStock, projectedStock }];
  for (let month = 1; month <= maxHorizonMonths; month += 1) {
    const projectedIvv = projectedAtMonthStart(month);
    const priorProjectedIvv = monthly.at(-1).projectedIvv;
    if (projectedIvv > priorProjectedIvv + 1e-12) throw new Error(`Falha de validação: IVV projetado crescente no mês ${month}.`);
    const fixedBefore = fixedStock;
    const projectedBefore = projectedStock;
    const fixedSales = Math.min(fixedBefore, initialIvv);
    const projectedSales = Math.min(projectedBefore, projectedIvv);
    if (fixedDepletionMonths === null && fixedSales >= fixedBefore) fixedDepletionMonths = (month - 1) + fixedBefore / initialIvv;
    if (projectedDepletionMonths === null && projectedSales >= projectedBefore) projectedDepletionMonths = (month - 1) + projectedBefore / projectedIvv;
    fixedStock = Math.max(0, fixedBefore - fixedSales);
    projectedStock = Math.max(0, projectedBefore - projectedSales);
    monthly.push({ month, fixedIvv: fixedStock > 0 ? initialIvv : 0, projectedIvv: projectedStock > 0 ? projectedIvv : 0, fixedSales, projectedSales, fixedStock, projectedStock });
    if (fixedStock === 0 && projectedStock === 0) break;
  }
  if (!finite(fixedDepletionMonths) || !finite(projectedDepletionMonths)) throw new Error('A projeção não alcançou o esgotamento do estoque.');
  const fixedStockAt = (month) => Math.max(0, stock - initialIvv * month);
  const projectedStockAt = (month) => monthly[Math.min(monthly.length - 1, Math.max(0, Math.round(month)))]?.projectedStock ?? 0;
  const chartHorizon = Math.ceil(Math.max(fixedDepletionMonths, projectedDepletionMonths) / 3) * 3;
  const chartQuarterly = quarterly.filter((row) => row.forecastMonth <= chartHorizon);
  const fixedIvvSeries = buildScenarioSeries({ kind: 'IVV_FIXO', depletionMonths: fixedDepletionMonths, quarterly: chartQuarterly, valueAt: () => initialIvv, stockAt: fixedStockAt, initialStock: stock });
  const projectedIvvSeries = buildScenarioSeries({ kind: 'IVV_PROJETADO', depletionMonths: projectedDepletionMonths, quarterly: chartQuarterly, valueAt: (row) => row.projectedIvv, stockAt: projectedStockAt, initialStock: stock });
  const fixedStockSeries = fixedIvvSeries.map((row) => ({ ...row, valor: row.saldo }));
  const projectedStockSeries = projectedIvvSeries.map((row) => ({ ...row, valor: row.saldo }));
  const audit = chartQuarterly.map((row) => ({
    horizonteMeses: row.forecastMonth,
    faixa: row.band,
    ivvAnterior: row.previousIvv,
    taxaAplicada: row.appliedRate,
    reducaoAplicada: row.appliedReduction,
    ivvProjetado: row.projectedIvv,
    estoqueFixo: fixedStockAt(row.forecastMonth),
    estoqueProjetado: projectedStockAt(row.forecastMonth),
    regra: row.rule
  }));
  return {
    fixedDepletionMonths,
    projectedDepletionMonths,
    monthly,
    quarterly: chartQuarterly,
    audit,
    series: {
      ivv_fixo: fixedIvvSeries,
      ivv_projetado: projectedIvvSeries,
      saldo_ivv_fixo: fixedStockSeries,
      saldo_ivv_projetado: projectedStockSeries
    }
  };
}

module.exports = { forecastAbsorption, buildQuarterlySchedule };
