(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexumBrokerNetwork = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const OPERATION_META = {
    venda_ofertada: { label: 'Venda ofertada', color: '#c8341f' },
    compra_procurada: { label: 'Compra procurada', color: '#1e3e85' },
    locacao_ofertada: { label: 'Locação ofertada', color: '#146b70' },
    locacao_procurada: { label: 'Locação procurada', color: '#a8701a' },
    repasse: { label: 'Repasse', color: '#7a4a2b' },
    permuta: { label: 'Permuta', color: '#5b4b9c' },
    indefinida: { label: 'Indefinida', color: '#6b7280' }
  };

  const TYPE_META = {
    apartamento: { investlar: 'APARTAMENTO', label: 'Apartamento' },
    casa: { investlar: 'CASA', label: 'Casa' },
    terreno_lote: { investlar: 'TERRENO_LOTE', label: 'Lote/Terreno' },
    galpao: { investlar: 'GALPAO', label: 'Galpão' },
    sala_comercial: { investlar: 'SALA_COMERCIAL', label: 'Sala comercial' },
    ponto_comercial: { investlar: 'PONTO_COMERCIAL', label: 'Ponto comercial' },
    predio_comercial: { investlar: 'PREDIO_COMERCIAL', label: 'Prédio comercial' },
    rural: { investlar: 'SITIO_CHACARA_FAZENDA', label: 'Rural' },
    studio_kitnet: { investlar: 'KITNET_FLAT_STUDIO', label: 'Studio/Kitnet' },
    indefinido: { investlar: 'INDEFINIDO', label: 'Indefinido' }
  };

  const PATTERN_ORDER = ['indefinido', 'popular_mcmv', 'alto', 'medio', 'nao_aplicavel', 'luxo'];
  const PATTERN_META = {
    indefinido: { label: 'Indefinido' },
    popular_mcmv: { label: 'Popular/MCMV' },
    alto: { label: 'Alto' },
    medio: { label: 'Médio' },
    nao_aplicavel: { label: 'Não aplicável' },
    luxo: { label: 'Luxo' }
  };

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function canonicalType(value) {
    const key = normalizeText(value);
    const aliases = {
      apartamento: 'apartamento',
      casa: 'casa',
      terreno_lote: 'terreno_lote',
      'terreno lote': 'terreno_lote',
      'lote terreno': 'terreno_lote',
      lote: 'terreno_lote',
      terreno: 'terreno_lote',
      galpao: 'galpao',
      sala_comercial: 'sala_comercial',
      'sala comercial': 'sala_comercial',
      ponto_comercial: 'ponto_comercial',
      'ponto comercial': 'ponto_comercial',
      predio_comercial: 'predio_comercial',
      'predio comercial': 'predio_comercial',
      sitio_chacara_fazenda: 'rural',
      'sitio chacara fazenda': 'rural',
      rural: 'rural',
      kitnet_flat_studio: 'studio_kitnet',
      'kitnet flat studio': 'studio_kitnet',
      studio: 'studio_kitnet',
      kitnet: 'studio_kitnet',
      flat: 'studio_kitnet',
      indefinido: 'indefinido'
    };
    return aliases[key] || aliases[key.replace(/ /g, '_')] || '';
  }

  function canonicalPattern(value) {
    const key = normalizeText(value);
    const aliases = {
      popular: 'popular_mcmv',
      mcmv: 'popular_mcmv',
      'popular mcmv': 'popular_mcmv',
      popular_mcmv: 'popular_mcmv',
      medio: 'medio',
      'medio padrao': 'medio',
      alto: 'alto',
      'alto padrao': 'alto',
      luxo: 'luxo',
      nao_aplicavel: 'nao_aplicavel',
      'nao aplicavel': 'nao_aplicavel',
      indefinido: 'indefinido'
    };
    return aliases[key] || aliases[key.replace(/ /g, '_')] || '';
  }

  function canonicalNeighborhood(value) {
    return normalizeText(value);
  }

  function typeLabel(key) {
    return TYPE_META[key]?.label || String(key || 'Indefinido');
  }

  function patternLabel(key) {
    return PATTERN_META[key]?.label || String(key || 'Indefinido');
  }

  function operationMeta(key) {
    return OPERATION_META[key] || OPERATION_META.indefinida;
  }

  function isAnalyticalRecord(item) {
    return ['VALIDO', 'PARCIAL'].includes(String(item?.status_extracao || ''))
      && String(item?.operacao_mercado || 'indefinida') !== 'indefinida'
      && !item?.fora_campina_grande_flag;
  }

  function primaryTicketValue(item) {
    return Number(item?.valor_venda || item?.valor_orcamento_maximo || item?.valor_repasse_agio || 0);
  }

  function ticketMatches(item, band) {
    if (!band) return true;
    const value = primaryTicketValue(item);
    if (!value) return false;
    if (band === 'ate-500') return value <= 500000;
    if (band === '500-800') return value > 500000 && value <= 800000;
    if (band === '800-1200') return value > 800000 && value <= 1200000;
    if (band === 'acima-1200') return value > 1200000;
    return true;
  }

  function applySharedFilters(records, filters = {}) {
    const bairro = canonicalNeighborhood(filters.bairro);
    const bairros = new Set((Array.isArray(filters.bairros) ? filters.bairros : String(filters.bairros || '').split(','))
      .map((item) => canonicalNeighborhood(item)).filter(Boolean));
    const tipo = canonicalType(filters.tipo) || String(filters.tipo || '');
    const padrao = canonicalPattern(filters.padrao) || String(filters.padrao || '');
    return records.filter((item) => {
      if (bairro && canonicalNeighborhood(item.bairro_normalizado) !== bairro) return false;
      if (bairros.size && !bairros.has(canonicalNeighborhood(item.bairro_normalizado))) return false;
      if (tipo && canonicalType(item.tipo_imovel || 'INDEFINIDO') !== tipo) return false;
      if (padrao && canonicalPattern(item.padrao_economico || 'indefinido') !== padrao) return false;
      return ticketMatches(item, filters.ticket);
    });
  }

  function selectedOperations(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return new Set(values.map((item) => String(item || '').trim()).filter((item) => Object.hasOwn(OPERATION_META, item)));
  }

  function applyOperationFilter(records, operations) {
    if (String(operations || '').split(',').map((item) => item.trim()).includes('__none__')) return [];
    const selected = selectedOperations(operations);
    return selected.size ? records.filter((item) => selected.has(String(item.operacao_mercado || 'indefinida'))) : records;
  }

  function countBy(records, keyFn) {
    const result = {};
    for (const item of records) {
      const key = keyFn(item);
      if (!key) continue;
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }

  function topKey(counts) {
    return Object.entries(counts || {}).sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), 'pt-BR'))[0]?.[0] || '';
  }

  function trimmedMean(values, min, max) {
    const rows = values.map(Number).filter((value) => Number.isFinite(value) && value >= min && value <= max).sort((a, b) => a - b);
    if (!rows.length) return null;
    const trim = rows.length >= 8 ? Math.floor(rows.length * 0.1) : 0;
    const scoped = trim ? rows.slice(trim, rows.length - trim) : rows;
    return scoped.reduce((sum, value) => sum + value, 0) / scoped.length;
  }

  function getBubbleRadius(quantity, totalFiltered) {
    if (!quantity || !totalFiltered || quantity <= 0 || totalFiltered <= 0) return 0;
    const minRadius = 7;
    const maxRadius = 21; // Até 3x o mínimo visual (7px), mantendo proporção entre bairros.
    return minRadius + (maxRadius - minRadius) * Math.sqrt(quantity / totalFiltered);
  }

  function aggregateBubbles(records, totalFiltered = records.length) {
    const groups = new Map();
    for (const item of records) {
      const latitude = Number(item.latitude);
      const longitude = Number(item.longitude);
      const bairro = String(item.bairro_normalizado || '').trim();
      if (!bairro || !Number.isFinite(latitude) || !Number.isFinite(longitude) || item.fora_campina_grande_flag) continue;
      const key = canonicalNeighborhood(bairro);
      if (!groups.has(key)) groups.set(key, { bairro, bairroKey: key, regiao: item.regiao || '', latitude, longitude, total: 0, operations: {}, patterns: {}, types: {}, saleValues: [], rentValues: [], brokers: new Set(), brokerSides: { supply: new Set(), demand: new Set() } });
      const row = groups.get(key);
      const operation = item.operacao_mercado || 'indefinida';
      const pattern = canonicalPattern(item.padrao_economico || 'indefinido') || 'indefinido';
      const type = canonicalType(item.tipo_imovel || 'INDEFINIDO') || 'indefinido';
      row.total += 1;
      row.operations[operation] = (row.operations[operation] || 0) + 1;
      row.patterns[pattern] = (row.patterns[pattern] || 0) + 1;
      row.types[type] = (row.types[type] || 0) + 1;
      if (item.sender_id) {
        const sender = String(item.sender_id);
        const demand = operation === 'compra_procurada' || operation === 'locacao_procurada';
        row.brokers.add(sender);
        if (operation !== 'indefinida') row.brokerSides[demand ? 'demand' : 'supply'].add(sender);
      }
      if (Number(item.valor_venda) >= 50000) row.saleValues.push(Number(item.valor_venda));
      if (Number(item.valor_locacao) >= 200 && Number(item.valor_locacao) <= 15000) row.rentValues.push(Number(item.valor_locacao));
    }
    return [...groups.values()].map((row) => {
      const dominantOperation = topKey(row.operations) || 'indefinida';
      return {
        bairro: row.bairro,
        bairroKey: row.bairroKey,
        regiao: row.regiao,
        latitude: row.latitude,
        longitude: row.longitude,
        total: row.total,
        brokers: row.brokers.size,
        brokerSides: { supply: row.brokerSides.supply.size, demand: row.brokerSides.demand.size },
        operations: row.operations,
        patterns: row.patterns,
        types: row.types,
        dominantOperation,
        dominantPattern: topKey(row.patterns) || 'indefinido',
        dominantType: topKey(row.types) || 'indefinido',
        color: operationMeta(dominantOperation).color,
        radius: getBubbleRadius(row.total, totalFiltered),
        saleMean: trimmedMean(row.saleValues, 50000, 10000000),
        rentMean: trimmedMean(row.rentValues, 200, 15000)
      };
    }).sort((left, right) => right.total - left.total || left.bairro.localeCompare(right.bairro, 'pt-BR'));
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const radians = Math.PI / 180;
    const latitudeDistance = (lat2 - lat1) * radians;
    const longitudeDistance = (lng2 - lng1) * radians;
    const h = Math.sin(latitudeDistance / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitudeDistance / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  function bubbleRadiusKm(row, totalFiltered, zoom = 12) {
    const radiusPx = getBubbleRadius(row.total, totalFiltered);
    const metersPerPixel = (40075016.686 * Math.cos((Number(row.latitude) * Math.PI) / 180)) / Math.pow(2, Number(zoom || 12) + 8);
    return (radiusPx * metersPerPixel) / 1000;
  }

  function radiusNeighborhoods(bubbles, radius, totalFiltered) {
    if (!radius || !Number.isFinite(radius.lat) || !Number.isFinite(radius.lng) || !Number.isFinite(radius.km) || radius.km <= 0) return new Set(bubbles.map((item) => item.bairroKey));
    return new Set(bubbles.filter((item) => distanceKm(radius.lat, radius.lng, item.latitude, item.longitude) <= radius.km + bubbleRadiusKm(item, totalFiltered, radius.zoom)).map((item) => item.bairroKey));
  }

  function isTrustworthyName(name, phone, senderId) {
    const value = String(name || '').trim();
    if (!value) return false;
    const normalized = normalizeText(value);
    const digits = value.replace(/\D/g, '');
    return normalized !== normalizeText(phone) && normalized !== normalizeText(senderId) && !(digits && digits === String(phone || '').replace(/\D/g, ''));
  }

  function buildBrokerLabels(directory) {
    const rows = [...(directory || [])].sort((left, right) => String(left.sender_id || '').localeCompare(String(right.sender_id || '')));
    const labels = new Map();
    let unidentified = 0;
    for (const item of rows) {
      const senderId = String(item.sender_id || '');
      if (!senderId) continue;
      const phone = String(item.telefone_corretor || '').trim();
      const name = String(item.nome_corretor || '').trim();
      let label = isTrustworthyName(name, phone, senderId) ? name : phone;
      if (!label) label = `Não identificado #${++unidentified}`;
      labels.set(senderId, label);
    }
    return labels;
  }

  function aggregateBrokers(records, directory, totalScope, limit) {
    const labels = buildBrokerLabels(directory);
    const groups = new Map();
    for (const item of records) {
      const key = String(item.sender_id || '');
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, label: labels.get(key) || '', total: 0, neighborhoods: new Set(), patterns: {} });
      const row = groups.get(key);
      row.total += 1;
      if (item.bairro_normalizado) row.neighborhoods.add(canonicalNeighborhood(item.bairro_normalizado));
      const pattern = canonicalPattern(item.padrao_economico || 'indefinido') || 'indefinido';
      row.patterns[pattern] = (row.patterns[pattern] || 0) + 1;
    }
    let missingIndex = 0;
    return [...groups.values()]
      .map((row) => ({
        key: row.key,
        label: row.label || `Não identificado #${++missingIndex}`,
        total: row.total,
        percent: totalScope ? row.total / totalScope : 0,
        neighborhoods: row.neighborhoods.size,
        patterns: Object.entries(row.patterns).sort((left, right) => right[1] - left[1]).map(([key, value]) => ({ key, label: patternLabel(key), value }))
      }))
      .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label, 'pt-BR'))
      .slice(0, limit);
  }

  function distribution(records, keyFn, labelFn, limit = Infinity, fixedOrder = []) {
    const counts = countBy(records, keyFn);
    const keys = fixedOrder.length ? fixedOrder : Object.keys(counts);
    const total = records.length;
    return keys.map((key, order) => ({ key, label: labelFn(key), value: counts[key] || 0, percent: total ? (counts[key] || 0) / total : 0, order }))
      .sort((left, right) => right.value - left.value || left.order - right.order || left.label.localeCompare(right.label, 'pt-BR'))
      .slice(0, limit)
      .map(({ order, ...row }) => row);
  }

  function buildFilterOptions(records) {
    const neighborhoods = new Map();
    const types = new Set();
    const patterns = new Set();
    for (const item of records) {
      if (item.bairro_normalizado) neighborhoods.set(canonicalNeighborhood(item.bairro_normalizado), item.bairro_normalizado);
      const type = canonicalType(item.tipo_imovel || 'INDEFINIDO');
      const pattern = canonicalPattern(item.padrao_economico || 'indefinido');
      if (type) types.add(type);
      if (pattern) patterns.add(pattern);
    }
    return {
      neighborhoods: [...neighborhoods].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR')),
      types: [...types].map((key) => ({ key, label: typeLabel(key) })).sort((left, right) => left.label.localeCompare(right.label, 'pt-BR')),
      patterns: PATTERN_ORDER.filter((key) => patterns.has(key)).map((key) => ({ key, label: patternLabel(key) })),
      operations: distribution(records, (item) => item.operacao_mercado || 'indefinida', (key) => operationMeta(key).label, Infinity, Object.keys(OPERATION_META))
    };
  }

  function buildAnalytics(opportunities, directory, options = {}) {
    const analytical = (opportunities || []).filter(isAnalyticalRecord);
    const sharedFiltered = applySharedFilters(analytical, options.filters || {});
    const filtered = applyOperationFilter(sharedFiltered, options.operations);
    const fullBubbles = aggregateBubbles(filtered, filtered.length);
    const radius = options.radius?.active ? options.radius : null;
    const inRadius = radiusNeighborhoods(fullBubbles, radius, filtered.length);
    const territorialScope = radius ? filtered.filter((item) => inRadius.has(canonicalNeighborhood(item.bairro_normalizado))) : filtered;
    const requestedFocus = canonicalNeighborhood(options.bairroFoco);
    const validFocus = requestedFocus && territorialScope.some((item) => canonicalNeighborhood(item.bairro_normalizado) === requestedFocus) ? requestedFocus : '';
    const analyticalScope = validFocus ? territorialScope.filter((item) => canonicalNeighborhood(item.bairro_normalizado) === validFocus) : territorialScope;
    const mapRecords = options.corretorSelecionado ? filtered.filter((item) => String(item.sender_id || '') === String(options.corretorSelecionado)) : filtered;
    const bubbles = aggregateBubbles(mapRecords, mapRecords.length).map((item) => ({ ...item, inRadius: !radius || inRadius.has(item.bairroKey), selected: Boolean(validFocus && item.bairroKey === validFocus) }));
    const scopeBubbles = aggregateBubbles(analyticalScope, analyticalScope.length);
    const topConcentration = scopeBubbles[0] || null;
    const operationCounts = countBy(analyticalScope, (item) => item.operacao_mercado || 'indefinida');
    const patternCounts = countBy(analyticalScope, (item) => canonicalPattern(item.padrao_economico || 'indefinido') || 'indefinido');
    const focusBubble = validFocus ? fullBubbles.find((item) => item.bairroKey === validFocus) : null;
    const focusRecords = focusBubble ? territorialScope.filter((item) => canonicalNeighborhood(item.bairro_normalizado) === focusBubble.bairroKey) : [];
    return {
      filterOptions: buildFilterOptions(sharedFiltered),
      bubbles,
      topBrokers: aggregateBrokers(analyticalScope, directory, analyticalScope.length, options.top || 10),
      gis: {
        totalRecords: analyticalScope.length,
        totalBrokers: new Set(analyticalScope.map((item) => item.sender_id).filter(Boolean)).size,
        totalNeighborhoods: new Set(analyticalScope.map((item) => canonicalNeighborhood(item.bairro_normalizado)).filter(Boolean)).size,
        topNeighborhood: topConcentration?.bairro || '',
        topNeighborhoodTotal: topConcentration?.total || 0,
        dominantOperation: topKey(operationCounts) || 'indefinida',
        dominantOperationLabel: operationMeta(topKey(operationCounts)).label,
        dominantPattern: topKey(patternCounts) || 'indefinido',
        dominantPatternLabel: patternLabel(topKey(patternCounts) || 'indefinido'),
        focusNeighborhood: validFocus ? (fullBubbles.find((item) => item.bairroKey === validFocus)?.bairro || options.bairroFoco) : ''
      },
      bairroFocus: {
        bairro: focusBubble?.bairro || '',
        explicit: Boolean(validFocus),
        total: focusRecords.length,
        operations: distribution(focusRecords, (item) => item.operacao_mercado || 'indefinida', (key) => operationMeta(key).label)
      },
      propertyTypes: distribution(analyticalScope, (item) => canonicalType(item.tipo_imovel || 'INDEFINIDO') || 'indefinido', typeLabel, 9),
      economicPatterns: distribution(analyticalScope, (item) => canonicalPattern(item.padrao_economico || 'indefinido') || 'indefinido', patternLabel, Infinity, PATTERN_ORDER),
      scope: { filteredRecords: filtered.length, mapRecords: mapRecords.length, territorialRecords: territorialScope.length, analyticalRecords: analyticalScope.length }
    };
  }

  return {
    OPERATION_META,
    TYPE_META,
    PATTERN_META,
    PATTERN_ORDER,
    normalizeText,
    canonicalType,
    canonicalPattern,
    canonicalNeighborhood,
    typeLabel,
    patternLabel,
    operationMeta,
    isAnalyticalRecord,
    primaryTicketValue,
    ticketMatches,
    applySharedFilters,
    applyOperationFilter,
    selectedOperations,
    getBubbleRadius,
    aggregateBubbles,
    distanceKm,
    bubbleRadiusKm,
    radiusNeighborhoods,
    buildFilterOptions,
    buildAnalytics
  };
});
