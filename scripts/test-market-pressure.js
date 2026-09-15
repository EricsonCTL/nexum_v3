const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateMarketPressure, pressureHistory } = require('../market-pressure');

const base = { status_extracao:'VALIDO', fora_campina_grande_flag:false, tipo_imovel:'APARTAMENTO', padrao_economico:'medio', bairro_normalizado:'Centro' };
const record = (id, operation, month, sender=id, extra={}) => ({ ...base, id, sender_id:sender, operacao_mercado:operation, data_inicio:`${month}-08T12:00:00-03:00`, latitude:-7.23, longitude:-35.88, ...extra });
const neighborhoods = [{ id:'BAI-centro', nome:'Centro', latitude:-7.23, longitude:-35.88, geographic_precision:'centroid' }];
const query = { bairro:'Centro', bairroNome:'Centro' };
const many = (prefix, operation, month, count, senderPrefix=prefix) => Array.from({length:count},(_,index)=>record(`${prefix}-${index}`,operation,month,`${senderPrefix}-${index}`));

const fresh = calculateMarketPressure({ records:many('fresh','compra_procurada','2026-08',10), query, neighborhoods, geoMode:'EXACT' });
assert.equal(fresh.has_pressure,true); assert.equal(fresh.demand_pressure > 0,true); assert.equal(fresh.ipd,null); assert.equal(fresh.ipd_indicator.is_new_pressure,true);

const stableRows = [...many('stable-a','compra_procurada','2026-07',10,'stable'),...many('stable-b','compra_procurada','2026-08',10,'stable')];
const stable = calculateMarketPressure({ records:stableRows, query, neighborhoods, geoMode:'EXACT' });
assert.equal(stable.ipd,0); assert.equal(stable.demand_pressure > 0,true); assert.equal(stable.ipd_indicator.direction,'stable');

const up = calculateMarketPressure({ records:[...many('up-old','compra_procurada','2026-07',10,'up-old'),...many('up-new','compra_procurada','2026-08',20,'up-new')], query, neighborhoods, geoMode:'EXACT' });
assert.equal(up.ipd > 0,true); assert.equal(up.ipd_indicator.direction,'up');
const down = calculateMarketPressure({ records:[...many('down-old','compra_procurada','2026-07',20,'down-old'),...many('down-new','compra_procurada','2026-08',10,'down-new')], query, neighborhoods, geoMode:'EXACT' });
assert.equal(down.ipd < 0,true); assert.equal(down.ipd_indicator.direction,'down');

const disappeared = calculateMarketPressure({ records:[...many('gone','compra_procurada','2026-07',7),...many('offer','venda_ofertada','2026-08',1)], query, neighborhoods, geoMode:'EXACT' });
assert.equal(disappeared.ipd,-100); assert.equal(disappeared.demand_pressure,0); assert.equal(disappeared.has_pressure,true);
const none = calculateMarketPressure({ records:[], query, neighborhoods, geoMode:'EXACT' });
assert.equal(none.calculation_status,'insufficient_data');

const persistedAndExpanded = calculateMarketPressure({ records:[...many('base','compra_procurada','2026-07',5,'shared'),...many('same','compra_procurada','2026-08',5,'shared'),...many('new','compra_procurada','2026-08',5,'new')], query, neighborhoods, geoMode:'EXACT' });
assert.equal(persistedAndExpanded.demand_components.persistent_brokers,5); assert.equal(persistedAndExpanded.demand_components.new_brokers,5); assert.equal(Number.isFinite(persistedAndExpanded.ipd),true);

const gap = calculateMarketPressure({ records:[...many('gap-old','compra_procurada','2026-06',5),...many('gap-new','compra_procurada','2026-08',5)], query, neighborhoods, geoMode:'EXACT' });
assert.equal(gap.comparison_month,'2026-06'); assert.equal(gap.comparison_months,2); assert.equal(gap.ipd,0);
const history = pressureHistory({ records:stableRows, query, neighborhoods, geoMode:'EXACT' });
assert.equal(history.at(-1).ipd,0); assert.equal(history.at(-1).demand_pressure > 0,true);

const radarHtml = fs.readFileSync(path.join(__dirname, '..', 'analytics.html'), 'utf8');
assert.match(radarHtml, /pressure-point-label absolute/, 'gráfico deve rotular a pressão absoluta mensal');
assert.match(radarHtml, /pressure-point-label variation/, 'gráfico deve rotular a variação mensal de IPD\/IPO');

console.log('market pressure temporal: ok');
