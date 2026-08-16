async function loadCommercialLimits() {
  const fallback = {
    entradaMinimaPercentual: 10,
    prazoMaximoMeses: 60,
    intercaladaMinimaCentavos: 200000,
    parcelasIntercaladas36: 3,
    parcelasIntercaladas60: 5
  };

  try {
    const response = await fetch('cti_limites_comerciais.csv', { cache: 'no-store' });
    if (!response.ok) return fallback;
    const text = await response.text();
    const rows = text.trim().split(/\r?\n/).slice(1).map((line) => {
      const [regra, valor] = line.split(',');
      return [regra, Number(valor)];
    });
    const map = Object.fromEntries(rows);
    return {
      entradaMinimaPercentual: map.entrada_minima || fallback.entradaMinimaPercentual,
      prazoMaximoMeses: map.prazo_maximo || fallback.prazoMaximoMeses,
      intercaladaMinimaCentavos: map.intercalada_minima || fallback.intercaladaMinimaCentavos,
      parcelasIntercaladas36: map.parcelas_intercaladas_36 || fallback.parcelasIntercaladas36,
      parcelasIntercaladas60: map.parcelas_intercaladas_60 || fallback.parcelasIntercaladas60
    };
  } catch (_) {
    return fallback;
  }
}

async function loadTabelaRows() {
  const response = await fetch('tabela.html', { cache: 'no-store' });
  if (!response.ok) throw new Error('Nao foi possivel carregar tabela.html');
  const html = await response.text();
  const match = html.match(/const\s+TABELA_ROWS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Base TABELA_ROWS nao encontrada em tabela.html');
  return JSON.parse(match[1]);
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromCents(cents) {
  return cents / 100;
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatArea(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  }) + ' m²';
}

function calculateProposal(row, input, limits) {
  const valorCentavos = toCents(row.valor);
  const entradaCentavos = toCents(input.entrada);
  const prazo = Number(input.prazo);
  const intercaladas = Number(input.intercaladas);
  const valorIntercaladaCentavos = toCents(input.valorIntercalada);
  const entradaMinimaCentavos = Math.ceil(valorCentavos * limits.entradaMinimaPercentual / 100);
  const totalIntercaladasCentavos = intercaladas * valorIntercaladaCentavos;
  const saldoCentavos = valorCentavos - entradaCentavos - totalIntercaladasCentavos;
  const errors = [];

  if (entradaCentavos < entradaMinimaCentavos) {
    errors.push(`Entrada minima: ${formatBRL(fromCents(entradaMinimaCentavos))}.`);
  }
  if (!prazo || prazo > limits.prazoMaximoMeses) {
    errors.push(`Prazo maximo permitido: ${limits.prazoMaximoMeses} meses.`);
  }
  if (intercaladas > 0 && valorIntercaladaCentavos < limits.intercaladaMinimaCentavos) {
    errors.push(`Intercalada minima: ${formatBRL(fromCents(limits.intercaladaMinimaCentavos))}.`);
  }
  if (saldoCentavos <= 0) {
    errors.push('Saldo a parcelar deve ser maior que zero.');
  }

  return {
    valid: errors.length === 0,
    errors,
    valorCentavos,
    entradaCentavos,
    entradaMinimaCentavos,
    totalIntercaladasCentavos,
    saldoCentavos,
    parcelaCentavos: saldoCentavos > 0 && prazo ? Math.ceil(saldoCentavos / prazo) : 0,
    prazo,
    intercaladas,
    valorIntercaladaCentavos
  };
}
