const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BrokerNetwork = require('../broker-network');
const { FILES, validateData, getBrokerAnalytics, getBrokerReviewSamples, clearBrokerDataCache } = require('../broker-data');

const manifest = JSON.parse(fs.readFileSync(FILES.manifest, 'utf8'));
const opportunities = JSON.parse(fs.readFileSync(FILES.opportunities, 'utf8'));
const directory = JSON.parse(fs.readFileSync(FILES.directory, 'utf8'));
validateData(manifest, opportunities, directory);

assert.equal(opportunities.length, Number(manifest.total_opportunities));
assert.equal(BrokerNetwork.canonicalType('Apartamento'), BrokerNetwork.canonicalType('APARTAMENTO'));
assert.equal(BrokerNetwork.canonicalType('Lote / Terreno'), BrokerNetwork.canonicalType('TERRENO_LOTE'));
assert.equal(BrokerNetwork.canonicalPattern('Popular'), BrokerNetwork.canonicalPattern('popular_mcmv'));
assert.equal(BrokerNetwork.canonicalPattern('Alto padrão'), BrokerNetwork.canonicalPattern('alto'));
assert.equal(BrokerNetwork.patternLabel('popular_mcmv'), 'Popular/MCMV');

async function run() {
  clearBrokerDataCache();
  const base = await getBrokerAnalytics({ top: 10 });
  const analytical = opportunities.filter(BrokerNetwork.isAnalyticalRecord);
  assert.equal(base.meta.analyticalOpportunities, analytical.length);
  assert.equal(base.scope.filteredRecords, analytical.length);
  assert.equal(base.bubbles.length, new Set(analytical.map((item) => item.bairro_normalizado).filter(Boolean)).size);
  const territorialAnchors = new Map([
    ['cruzeiro', [-7.253028, -35.903015]], ['dinamerica', [-7.235427, -35.915591]], ['estacao velha', [-7.230782, -35.88669]],
    ['cinza', [-7.253149, -35.925807]], ['itarare', [-7.253413, -35.881575]], ['jardim paulistano', [-7.247969, -35.893768]], ['jardim quarenta', [-7.236972, -35.899276]],
    ['mirante', [-7.233851, -35.865613]], ['monte castelo', [-7.22749, -35.864288]], ['monte santo', [-7.213173, -35.898985]],
    ['portal sudoeste', [-7.257833, -35.935544]], ['presidente medici', [-7.253576, -35.912251]], ['rocha cavalcante', [-7.240065, -35.880103]], ['sandra cavalcante', [-7.246263, -35.875284]],
    ['santa cruz', [-7.245754, -35.909499]], ['tambor', [-7.254588, -35.890941]], ['velame', [-7.275915, -35.89987]]
  ]);
  for (const [neighborhood, coordinates] of territorialAnchors) {
    const bubble = base.bubbles.find((item) => item.bairroKey === neighborhood);
    assert.ok(bubble, `a bolha de ${neighborhood} deve estar disponível`);
    assert.deepEqual([bubble.latitude, bubble.longitude], coordinates, `${neighborhood} deve usar a referência territorial canônica, não a coordenada histórica da mensagem`);
  }
  assert.ok(base.bubbles.every((item) => item.radius >= 7 && item.radius <= 21), 'bolhas devem preservar o mínimo de 7px e limitar o teto a três vezes esse valor');
  assert.ok(base.bubbles.every((item) => item.brokerSides.supply <= (item.operations.venda_ofertada || 0) + (item.operations.locacao_ofertada || 0) + (item.operations.repasse || 0) + (item.operations.permuta || 0)));
  assert.ok(base.bubbles.every((item) => item.brokerSides.demand <= (item.operations.compra_procurada || 0) + (item.operations.locacao_procurada || 0)));
  assert.equal(base.topBrokers.length, 10);
  assert.deepEqual(base.economicPatterns.map((item) => item.key), ['indefinido', 'popular_mcmv', 'alto', 'medio', 'nao_aplicavel', 'luxo']);
  assert.equal(base.economicPatterns.reduce((sum, item) => sum + item.value, 0), analytical.length);
  for (const key of ['saleSupplyTicket', 'saleDemandTicket', 'rentSupplyTicket', 'rentDemandTicket']) assert.ok(Number(base.marketSummary[key]) > 0, `ticket médio ${key} deve estar disponível`);

  const withPeriod = await getBrokerAnalytics({ top: 10, de: '2026-01', ate: '2026-02', data_inicio: '2026-01-01' });
  assert.deepEqual(withPeriod, base, 'período deve ser completamente neutro para a Rede de Corretores');
  const withEnterprise = await getBrokerAnalytics({ top: 10, empreendimento: 'EMP-000001', busca: 'LETS BELA VISTA' });
  assert.deepEqual(withEnterprise, base, 'busca e seleção de empreendimento não podem alterar corretores');

  for (const top of [10, 20, 30, 50]) {
    const response = await getBrokerAnalytics({ top });
    assert.equal(response.topBrokers.length, top);
    assert.ok(response.topBrokers.every((item, index, rows) => !index || rows[index - 1].total >= item.total));
  }
  const reviewPage = await getBrokerReviewSamples({ limit:50, page:1 });
  const reviewNextPage = await getBrokerReviewSamples({ limit:50, page:2 });
  assert.equal(reviewPage.samples.length, 50, 'revisão deve paginar em 50 conversas');
  assert.equal(reviewNextPage.samples.length, 50, 'segunda página deve manter o tamanho configurado');
  assert.ok(new Date(reviewPage.samples[0].occurredAt) >= new Date(reviewPage.samples.at(-1).occurredAt), 'revisão deve ordenar da conversa mais recente para a mais antiga');

  const reviewTranscripts = JSON.parse(fs.readFileSync(FILES.reviewTranscripts, 'utf8')).records;
  const transcript = reviewTranscripts.find((item) => String(item.sourceMessageMasked || '').trim().length > 18);
  assert.ok(transcript, 'fixture deve conter uma mensagem mascarada para revisão');
  const messageTerm = transcript.sourceMessageMasked.trim().split(/\s+/).slice(0, 3).join(' ');
  const reviewByMessage = await getBrokerReviewSamples({ limit:50, reviewSearch:messageTerm });
  assert.ok(reviewByMessage.samples.some((item) => item.opportunityId === transcript.opportunityId), 'busca da revisão deve localizar trecho da mensagem');
  const reviewByGlobalSearch = await getBrokerReviewSamples({ limit:50, search:messageTerm });
  assert.ok(reviewByGlobalSearch.samples.some((item) => item.opportunityId === transcript.opportunityId), 'busca global deve localizar trecho da mensagem na revisão');

  const reviewNeighborhood = await getBrokerReviewSamples({ limit:50, bairro:'Cruzeiro' });
  assert.ok(reviewNeighborhood.total < reviewPage.total, 'filtros globais devem afetar a revisão');

  const popular = await getBrokerAnalytics({ padrao: 'Popular' });
  assert.ok(popular.scope.filteredRecords > 0);
  assert.ok(popular.economicPatterns.find((item) => item.key === 'popular_mcmv').value === popular.scope.analyticalRecords);
  const apartment = await getBrokerAnalytics({ tipo: 'Apartamento' });
  assert.ok(apartment.scope.filteredRecords > 0);
  assert.ok(apartment.propertyTypes.every((item) => item.key === 'apartamento' || item.value === 0));

  const sale = await getBrokerAnalytics({ operacoes: 'venda_ofertada' });
  assert.ok(sale.scope.filteredRecords > 0);
  assert.ok(sale.scope.filteredRecords < base.scope.filteredRecords);
  assert.equal(sale.filterOptions.operations.length, 7, 'o filtro operacional deve preservar as categorias reais do Investlar');
  assert.equal(sale.filterOptions.operations.find((item) => item.key === 'venda_ofertada').label, 'Venda ofertada');

  const radius = await getBrokerAnalytics({ raioLat: -7.2306, raioLng: -35.8811, raioKm: 2, zoom: 13 });
  assert.equal(radius.bubbles.length, base.bubbles.length, 'bolhas fora do raio devem permanecer no payload visual');
  assert.ok(radius.bubbles.some((item) => item.inRadius));
  assert.ok(radius.bubbles.some((item) => !item.inRadius));
  assert.ok(radius.scope.territorialRecords < radius.scope.filteredRecords);
  assert.equal(Object.values(radius.operationCounts).reduce((sum, value) => sum + value, 0), radius.scope.territorialRecords, 'legendas devem usar somente registros dentro do raio');
  assert.notDeepEqual(radius.marketSummary, base.marketSummary, 'tickets médios devem responder ao recorte territorial');

  const html = fs.readFileSync(path.join(__dirname, '..', 'mapa.html'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  assert.match(html, /id="broker-network-toggle"/);
  assert.match(html, /brokerPane/);
  assert.match(html, /enterprisePane/);
  assert.match(html, /Top corretores/);
  assert.match(html, /Padrão econômico/);
  assert.match(html, /mapPortfolio\.filter\(hasCoordinates\)/, 'pins precisam obedecer à seleção de empreendimentos');
  assert.match(html, /brokerTooltipPane/, 'tooltip de corretores deve ficar acima dos pins');
  assert.match(html, /broker-tooltip-primary/, 'tooltip das bolhas deve destacar corretores e menções');
  assert.match(html, /broker-tooltip-pressure/, 'tooltip das bolhas deve comparar IPD e IPO no estilo analítico');
  assert.match(html, /Filtros aplicados/);
  assert.match(html, /territory-map-frame"><div id="map"[^]+id="active-map-filters"/, 'tags dos filtros devem ficar na área visível do mapa');
  assert.match(html, /broker-operation-trigger/);
  assert.match(html, /network\.insertBefore\(mapControls, reference \|\| null\); mapControls\.after\(operationPanel\)/, 'métrica, recorte e operações devem ficar abaixo dos controles de pins e Rede');
  assert.match(html, /broker-operation-trigger[^>]+disabled/, 'filtro de operações inicia desativado');
  assert.match(html, /enterprise-pins-toggle/, 'o mapa principal deve permitir ocultar pins de empreendimentos');
  assert.match(html, /network-reference-search/, 'a Rede deve oferecer busca de empreendimento, construtora ou bairro');
  assert.match(html, /network-reference-radius/, 'a referência da Rede deve aplicar raio territorial');
  assert.match(html, /'period','de','ate','data_inicio','data_fim'/, 'IPD e IPO no mapa devem ignorar filtros de data e usar a leitura mais recente');
  assert.match(html, /function thermometer\(label, value, className\)/, 'termômetros IPD/IPO devem ser gerados como SVG escalável');
  assert.match(html, /<svg viewBox="0 0 132 218"[^>]+aria-label="\$\{label\}: \$\{text\}"/, 'o SVG dos termômetros deve preservar rótulo acessível e proporção');
  assert.match(html, /marketSideTotal/, 'o mapa deve separar oferta e demanda em bolhas próprias');
  assert.match(html, /Quantidade e Menções/, 'o modo padrão deve deixar claro que considera quantidade e menções');
  assert.match(html, /IPD \(Índice de Pressão de Demanda\)/, 'o título do modo IPD deve ser explícito');
  assert.match(html, /IPO \(Índice de Pressão de Oferta\)/, 'o título do modo IPO deve ser explícito');
  assert.match(html, /function resetPressureMode\(\)/, 'o IPD/IPO deve voltar ao modo padrão sem limpar filtros');
  assert.match(html, /map-pressure-legend/, 'os modos IPD/IPO devem apresentar legenda de tendência no mapa');
  assert.match(html, /function positionMapFilterTags\(\)/, 'as tags de filtro devem alinhar ao lado do título do modo');
  assert.match(html, /brokerNetworkEnabled = false; enterprisePinsEnabled = true; pressureKind = 'qtd'/, 'limpar filtros deve desativar a Rede e restaurar os pins');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'nexo.css'), 'utf8'), /\.map-pressure-legend\[hidden\]\{display:none!important\}/, 'a legenda deve ficar invisível no modo Quantidade e Menções');
  assert.match(html, /pressureBubbleTone/, 'a cor das bolhas IPD/IPO deve refletir a direção do indicador');
  assert.match(html, /BUBBLE_RADIUS = Object\.freeze\(\{ min:7, max:21 \}\)/, 'o teto visual das bolhas deve chegar a três vezes o menor tamanho');
  assert.match(html, /zoomBubbleRadius/, 'as bolhas precisam manter escala visual controlada durante o zoom');
  assert.match(html, /separation=Math\.max\(9,\(circle\.radius\+other\.radius\)\*\.93\)/, 'bolhas da mesma coordenada devem ter sobreposição limitada');
  assert.match(html, /fillOpacity:\.2/, 'o preenchimento deve manter 80% de transparência');
  assert.match(html, /visualOpacity=inTerritory\?\.95:\.3/, 'bolhas fora do raio devem permanecer visíveis a 30%');
  assert.match(auth, /Limpar todos os filtros/, 'o mapa deve oferecer limpeza global em um botão flutuante');
  assert.match(auth, /nexumClearGlobalFilterControls/, 'a limpeza global deve zerar também os controles da gaveta');
  assert.match(html, /numeric>0\?'#e44747':numeric<0\?'#087cff':'#e89b16'/, 'rótulos dos termômetros devem usar vermelho, azul e laranja conforme a direção');
  assert.match(html, /requestAnimationFrame\(\(\)=>requestAnimationFrame\(layoutOpenTooltips\)\)/, 'tooltips devem recalcular o confinamento após o posicionamento final do Leaflet');
  assert.match(html, /\{direction:'right'.+\{direction:'left'.+\{direction:'top'.+\{direction:'bottom'/, 'tooltips devem testar direções alternativas para permanecer dentro do mapa');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'nexo.css'), 'utf8'), /max-height:calc\(100% - 16px\)/, 'tooltip não pode usar a altura zero do pane do Leaflet');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'logo', 'termometro-ipd.svg')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'logo', 'termometro-ipo.svg')));
  assert.doesNotMatch(html, /data_inicio.*brokerQuery/);
  assert.match(auth, /mountNexumGlobalFilters/);
  assert.doesNotMatch(auth, /filters\.href\s*=\s*.*mapa\.html/, 'filtro global não pode navegar para o mapa');

  console.log(`Rede de Corretores validada com ${base.meta.analyticalOpportunities.toLocaleString('pt-BR')} registros analíticos e ${base.bubbles.length} bolhas reais.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
