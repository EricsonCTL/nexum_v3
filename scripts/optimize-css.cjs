const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || 'nexo.css');
const write = process.argv.includes('--write');
const source = fs.readFileSync(target, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function normalized(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function matchingBrace(text, open) {
  let depth = 1;
  let quote = '';
  let parens = 0;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') { parens += 1; continue; }
    if (char === ')') { parens = Math.max(0, parens - 1); continue; }
    if (parens) continue;
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index;
  }
  throw new Error('Bloco CSS não terminado.');
}

function declarationParts(body) {
  const parts = [];
  let start = 0;
  let quote = '';
  let parens = 0;
  for (let index = 0; index <= body.length; index += 1) {
    const char = body[index] || ';';
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') { parens += 1; continue; }
    if (char === ')') { parens = Math.max(0, parens - 1); continue; }
    if (char !== ';' || parens) continue;
    const text = body.slice(start, index).trim();
    start = index + 1;
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 1) continue;
    const property = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    parts.push({ property, value, important: /!important\s*$/i.test(value) });
  }
  return parts;
}

function parseContext(css) {
  const nodes = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (/\s/.test(css[cursor] || '')) cursor += 1;
    if (cursor >= css.length) break;
    let quote = '';
    let parens = 0;
    let stop = cursor;
    for (; stop < css.length; stop += 1) {
      const char = css[stop];
      if (quote) {
        if (char === '\\') stop += 1;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '(') { parens += 1; continue; }
      if (char === ')') { parens = Math.max(0, parens - 1); continue; }
      if (!parens && (char === '{' || char === ';')) break;
    }
    const head = normalized(css.slice(cursor, stop));
    if (!head) { cursor = stop + 1; continue; }
    if (css[stop] === ';') {
      nodes.push({ type: 'directive', value: `${head};` });
      cursor = stop + 1;
      continue;
    }
    if (css[stop] !== '{') break;
    const close = matchingBrace(css, stop);
    const body = css.slice(stop + 1, close);
    if (/^@(media|supports|container|layer|document)/i.test(head)) {
      nodes.push({ type: 'context', head, children: parseContext(body) });
    } else if (head.startsWith('@')) {
      nodes.push({ type: 'opaque', head, body });
    } else {
      nodes.push({ type: 'rule', head, declarations: declarationParts(body) });
    }
    cursor = close + 1;
  }
  return nodes;
}

function removeSuperseded(nodes, stats) {
  for (const node of nodes) if (node.type === 'context') removeSuperseded(node.children, stats);
  const later = new Map();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.type !== 'rule') continue;
    const known = later.get(node.head) || new Map();
    const kept = [];
    for (let itemIndex = node.declarations.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const declaration = node.declarations[itemIndex];
      const future = known.get(declaration.property);
      const superseded = future && (future.important || !declaration.important);
      if (superseded) {
        stats.declarations += 1;
        continue;
      }
      kept.unshift(declaration);
      const previous = known.get(declaration.property);
      if (!previous || declaration.important || !previous.important) known.set(declaration.property, declaration);
    }
    node.declarations = kept;
    later.set(node.head, known);
  }
  return nodes.filter((node) => {
    if (node.type === 'rule' && !node.declarations.length) {
      stats.rules += 1;
      return false;
    }
    return true;
  });
}

function render(nodes) {
  return nodes.map((node) => {
    if (node.type === 'directive') return node.value;
    if (node.type === 'opaque') return `${node.head}{${node.body.trim()}}`;
    if (node.type === 'context') return `${node.head}{${render(node.children)}}`;
    return `${node.head}{${node.declarations.map((item) => `${item.property}:${item.value}`).join(';')}}`;
  }).join('\n');
}

const stats = { declarations: 0, rules: 0 };
const nodes = removeSuperseded(parseContext(source), stats);
const result = `/* NEXUM · folha de estilos consolidada. Regras superadas são removidas por scripts/optimize-css.cjs. */\n${render(nodes)}\n`;
if (write) fs.writeFileSync(target, result, 'utf8');
console.log(JSON.stringify({ target: path.basename(target), bytesBefore: Buffer.byteLength(source), bytesAfter: Buffer.byteLength(result), removedDeclarations: stats.declarations, removedRules: stats.rules, write }, null, 2));
