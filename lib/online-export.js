const fs = require('node:fs/promises');
const path = require('node:path');

// A publicação é uma projeção do estado consolidado. Ela não recebe código de
// importação, extração ou administração e, portanto, nunca é uma segunda
// instalação do motor local.
const PUBLIC_FILES = [
  'reajuste-ui.js', 'reajuste-ui.css',
  'index.html', 'inicio.html', 'empreendimentos.html', 'mapa.html', 'analytics.html',
  'corretor.html', 'auth.js', 'login.js', 'broker-network.js', 'cti-data-loader.js',
  'market-pressure.js', 'territorial-heat.js', 'radar-ui.js', 'radar-ui.css',
  'nexo.css', 'background.png', 'compartilhar.png', 'cti_logo.png', 'pdf.png',
  'vgvprice-logo.png', 'vercel.json'
];
const PUBLIC_DIRECTORIES = ['img', 'img_empreendimentos', 'logo'];
const ONLINE_TEMPLATE_FILES = ['README.md', 'package.json', 'local-server.js', 'public-api.js', 'api/public-data.js', 'api/[...path].js'];
const EXCLUDED_DATA_KEYS = new Set([
  'logs', 'auditoria', 'extracao', 'gestaoImportacoesPdf', 'dicionarioTermosManuais',
  'termosNaoMapeados', 'userFavorites', 'texto', 'raw', 'sourceMessage',
  'sourceMessageMasked', 'documentoHash', 'userNotificationReads'
]);

function clonePublic(value) {
  if (Array.isArray(value)) return value.map(clonePublic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !EXCLUDED_DATA_KEYS.has(key))
    .map(([key, item]) => [key, clonePublic(item)]));
}

function publicData(data) {
  const snapshot = clonePublic(data || {});
  snapshot.empreendimentos = (snapshot.empreendimentos || [])
    .filter((enterprise) => enterprise.status !== 'inactive')
    .map((enterprise) => ({
      ...enterprise,
      tabelas: (enterprise.tabelas || []).filter((table) => ['registered', 'superseded'].includes(table.status))
    }));
  return {
    schema: 'nexum-online-snapshot/v1',
    generatedAt: new Date().toISOString(),
    data: snapshot
  };
}

async function exists(file) {
  try { await fs.access(file); return true; } catch (_) { return false; }
}

async function sameFile(left, right) {
  try {
    const [leftStat, rightStat] = await Promise.all([fs.stat(left), fs.stat(right)]);
    if (leftStat.size !== rightStat.size) return false;
    const [leftBuffer, rightBuffer] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return leftBuffer.equals(rightBuffer);
  } catch (_) { return false; }
}

async function retryLocked(operation, target) {
  const delays = [0, 40, 120, 300, 700];
  let lastError;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try { return await operation(); } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  }
  lastError.message = `${lastError.message} (destino temporariamente bloqueado: ${target})`;
  throw lastError;
}

async function copyFile(source, destination) {
  if (!await exists(source)) return false;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await sameFile(source, destination)) return true;
  await retryLocked(() => fs.copyFile(source, destination), destination);
  return true;
}

async function copyDirectory(source, destination, copied) {
  if (!await exists(source)) return;
  const entries = await fs.readdir(source, { withFileTypes:true });
  for (const entry of entries) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to, copied);
    else if (entry.isFile()) { await copyFile(from, to); copied.push(to); }
  }
}

function safeDocumentName(table) {
  const name = table?.documento?.storedName || table?.documento?.path || '';
  return path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function copyPublishedPdfs(root, destination, data, copied) {
  for (const enterprise of data?.empreendimentos || []) {
    for (const table of enterprise.tabelas || []) {
      if (!['registered', 'superseded'].includes(table.status) || !table.documento?.path) continue;
      const relative = String(table.documento.path).replace(/\\/g, '/');
      const source = path.resolve(root, relative);
      if (!source.startsWith(root + path.sep) || !await exists(source)) continue;
      const filename = `${enterprise.id}_${table.id}_${safeDocumentName(table)}`;
      const target = path.join(destination, 'public', 'pdf', filename);
      if (await copyFile(source, target)) copied.push(target);
    }
  }
}

function rewritePublishedDocumentPaths(snapshot) {
  for (const enterprise of snapshot.data?.empreendimentos || []) {
    for (const table of enterprise.tabelas || []) {
      if (!table.documento?.path) continue;
      table.documento.path = `public/pdf/${enterprise.id}_${table.id}_${safeDocumentName(table)}`;
    }
  }
}

async function copyBrokerSnapshot(root, destination, copied) {
  // A publicação recebe somente a fotografia consolidada da Rede. Staging,
  // uploads e o catálogo operacional de ingestão ficam exclusivamente na raiz.
  const sourceDir = path.join(root, 'dados', 'corretores');
  const targetDir = path.join(destination, 'data', 'corretores');
  try {
    // Reutiliza a leitura consolidada do Hive e materializa as coordenadas de
    // bairro antes de publicar. Não há análise de conversa nem importação aqui.
    const { loadBrokerData, clearBrokerDataCache } = require('../broker-data');
    clearBrokerDataCache();
    const broker = await loadBrokerData();
    const manifest = broker.manifest || {};
    const finalOpportunities = broker.opportunities || [];
    const finalManifest = {
      ...manifest,
      generated_at: manifest.generated_at,
      total_opportunities: finalOpportunities.length,
      source: 'nexum_online_snapshot'
    };
    for (const [filename, value] of [
      ['manifest.json', finalManifest],
      ['opportunities.json', finalOpportunities],
      ['sender_directory.json', broker.directory || []]
    ]) {
      const target = path.join(targetDir, filename);
      await writeJson(target, value); copied.push(target);
    }
  } catch (_) {
    // A fotografia comercial continua publicável se a Rede ainda não tiver
    // sido inicializada; nesse caso, publica apenas a base já existente.
    for (const filename of ['manifest.json', 'opportunities.json', 'sender_directory.json']) {
      const source = path.join(sourceDir, filename);
      const target = path.join(targetDir, filename);
      if (await copyFile(source, target)) copied.push(target);
    }
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive:true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { await retryLocked(() => fs.rename(temporary, file), file); }
  finally { await fs.rm(temporary, { force:true }).catch(() => {}); }
}

async function makePublicClientAdjustments(destination) {
  // O shell é compartilhado com a raiz, mas links de pendências não podem
  // apontar para a área administrativa inexistente no pacote público.
  const authFile = path.join(destination, 'auth.js');
  if (!await exists(authFile)) return;
  const source = await fs.readFile(authFile, 'utf8');
  const publicSource = source.replace(
    'href="/gestao/empreendimento?id=${encodeURIComponent(item.enterpriseId)}&revisarTabela=${encodeURIComponent(item.tableId)}"',
    'href="/empreendimentos.html"'
  );
  if (publicSource !== source) await fs.writeFile(authFile, publicSource, 'utf8');
}

async function removeStaleManagedFiles(destination, copied) {
  const manifestFile = path.join(destination, '.nexum-export.json');
  let previous = [];
  try { previous = JSON.parse(await fs.readFile(manifestFile, 'utf8')).files || []; } catch (_) { return; }
  const current = new Set(copied.map((file) => path.relative(destination, file).replace(/\\/g, '/')));
  for (const relative of previous) {
    if (current.has(relative)) continue;
    const target = path.resolve(destination, relative);
    // Só remove arquivos que foram declarados por uma exportação anterior e
    // cuja resolução continua estritamente dentro do pacote Nexum.
    if (target.startsWith(destination + path.sep)) await fs.rm(target, { force:true });
  }
}

async function exportOnline({ root, data, destination = path.join(root, 'Nexum') }) {
  const copied = [];
  await fs.mkdir(destination, { recursive:true });

  for (const relative of PUBLIC_FILES) {
    const target = path.join(destination, relative);
    if (await copyFile(path.join(root, relative), target)) copied.push(target);
  }
  for (const relative of PUBLIC_DIRECTORIES) await copyDirectory(path.join(root, relative), path.join(destination, relative), copied);
  for (const relative of ONLINE_TEMPLATE_FILES) {
    const target = path.join(destination, relative);
    if (await copyFile(path.join(root, 'online', relative), target)) copied.push(target);
  }
  await makePublicClientAdjustments(destination);

  const snapshot = publicData(data);
  rewritePublishedDocumentPaths(snapshot);
  const dataTarget = path.join(destination, 'data', 'nexum-public.json');
  await writeJson(dataTarget, snapshot);
  copied.push(dataTarget);
  await copyBrokerSnapshot(root, destination, copied);
  await copyPublishedPdfs(root, destination, data, copied);

  await removeStaleManagedFiles(destination, copied);

  const manifest = {
    schema: 'nexum-online-export/v1',
    generatedAt: snapshot.generatedAt,
    files: copied.map((file) => path.relative(destination, file).replace(/\\/g, '/')).sort(),
    exclusions: ['engine/', 'pdf/entrada/', 'pdf/processando/', 'PDF Entrada/', 'gestao/', 'scripts/', 'server.js', 'rede-ingestion.js']
  };
  await writeJson(path.join(destination, '.nexum-export.json'), manifest);
  return { destination, ...manifest };
}

module.exports = { exportOnline, publicData, PUBLIC_FILES, PUBLIC_DIRECTORIES };
