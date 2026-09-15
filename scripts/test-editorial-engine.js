'use strict';

const assert = require('node:assert/strict');
const { buildEditorialReading } = require('../editorial-engine');

const reading = buildEditorialReading([
  { id:'restricted', kind:'absence_of_sales', family:'attention', score:100, enterprise:'Projeto A' },
  { id:'sale', kind:'sale_validated', family:'performance', sales:2, enterprise:'Projeto B' },
  { id:'price', kind:'price_update', family:'price', enterprise:'Projeto C' },
  { id:'offer', kind:'offer_update', family:'offer', enterprise:'Projeto D' }
], { hasPortfolio:true });

assert.equal(reading.audience, 'public_safe');
assert.equal(reading.modules[0].id, 'sale');
assert.equal(reading.modules.some((item) => item.id === 'restricted'), false);
assert.equal(reading.suppressed[0].reason, 'sinal_restrito_para_publicacao');
assert.match(reading.paragraphs.join(' '), /vendas validadas/);
assert.doesNotMatch(reading.paragraphs.join(' '), /sem vendas|lidera|redução/i);
console.log('OK: motor editorial mantém fatos seguros e suprime sinais constrangedores.');
