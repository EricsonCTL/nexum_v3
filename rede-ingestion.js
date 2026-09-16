const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const BROKER_DATA_DIR = process.env.NEXUM_BROKER_DATA_DIR ? path.resolve(process.env.NEXUM_BROKER_DATA_DIR) : path.join(ROOT, 'dados', 'corretores');
const INGESTION_DIR = path.join(BROKER_DATA_DIR, 'ingestion');
const CATALOG_FILE = path.join(INGESTION_DIR, 'catalog.json');
const BATCH_DIR = path.join(INGESTION_DIR, 'batches');
const UPLOAD_DIR = path.join(INGESTION_DIR, '.uploads');
const ENGINE_FILE = path.join(ROOT, 'engine', 'investlar', 'incremental.py');
const BASE_DIRECTORY_FILE = path.join(BROKER_DATA_DIR, 'sender_directory.json');
const SOURCE_ID = 'construindo-parceria-cg';
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const BASELINE_CHECKPOINT = Object.freeze({
  sourceId: SOURCE_ID,
  occurredAt: '2026-05-03T12:26',
  date: '2026-05-03',
  time: '12:26',
  sender: '+55 83 8862-5551',
  senderCanonical: '558388625551',
  senderKind: 'telefone',
  contentHash: '9ad90289ca8bfa7b72e533e953851275a8e6b23eb5c52eff0cb2e5e8ecdec5f7',
  occurrence: 1,
  fingerprint: '2d2859422df8fa4ca9751bb93fca726826c9d12b4aa0752f755e757d1cd9ed05',
  lineHint: 154345
});

let processing = false;

function isoNow() { return new Date().toISOString(); }
function safeActor(actor = {}) { return { codigo:String(actor.codigo || 'sistema'), nome:String(actor.nome || 'Sistema'), perfil:String(actor.perfil || '') }; }
function defaultCatalog() {
  return {
    version: 1,
    sources: [{
      id: SOURCE_ID,
      name: 'Construindo Parceria CG',
      active: true,
      baselineHash: '4665749183e3f1545bfe38b1ddfebd8b0e3d58def572e2fdbf698d21265da85e',
      baselineTxtHash: '24eb8d14d06f12f121640e2d61db0f11583f9e45f480053bbd0aa7fe17b6e6a2',
      checkpoint: { ...BASELINE_CHECKPOINT },
      createdAt: isoNow(),
      updatedAt: isoNow()
    }],
    batches: [],
    imports: [],
    reviewDecisions: [],
    overrides: {},
    createdAt: isoNow(),
    updatedAt: isoNow()
  };
}

async function atomicWriteJson(file, value) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { await fs.rename(temporary, file); }
  catch (error) { await fs.rm(temporary, { force:true }).catch(() => {}); throw error; }
}

async function ensureIngestionStorage() {
  await Promise.all([INGESTION_DIR, BATCH_DIR, UPLOAD_DIR].map((dir) => fs.mkdir(dir, { recursive:true })));
  try { await fs.access(CATALOG_FILE); }
  catch (_) { await atomicWriteJson(CATALOG_FILE, defaultCatalog()); }
  await cleanupUploads();
}

async function readCatalog() {
  await ensureIngestionStorage();
  const catalog = JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8'));
  if (!Array.isArray(catalog.sources) || !catalog.sources.length) throw new Error('Catálogo de importação sem fonte ativa.');
  catalog.batches = Array.isArray(catalog.batches) ? catalog.batches : [];
  catalog.imports = Array.isArray(catalog.imports) ? catalog.imports : [];
  catalog.reviewDecisions = Array.isArray(catalog.reviewDecisions) ? catalog.reviewDecisions : [];
  catalog.overrides = catalog.overrides && typeof catalog.overrides === 'object' ? catalog.overrides : {};
  return catalog;
}

async function writeCatalog(catalog) {
  catalog.updatedAt = isoNow();
  await atomicWriteJson(CATALOG_FILE, catalog);
}

function activeSource(catalog) {
  const source = catalog.sources.find((item) => item.active !== false);
  if (!source) throw new Error('Nenhuma fonte de conversa está ativa.');
  return source;
}

async function cleanupUploads() {
  if (!fsSync.existsSync(UPLOAD_DIR)) return;
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes:true });
  await Promise.all(entries.filter((item) => item.isFile()).map(async (item) => {
    const file = path.join(UPLOAD_DIR, item.name);
    const stat = await fs.stat(file);
    if (stat.mtimeMs < cutoff) await fs.rm(file, { force:true });
  }));
}

function pythonExecutable() { return String(process.env.NEXUM_PYTHON || 'python'); }

async function runEngine(args) {
  try {
    const { stdout } = await execFileAsync(pythonExecutable(), [ENGINE_FILE, ...args], {
      cwd: ROOT,
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
      encoding: 'utf8'
    });
    return JSON.parse(stdout.trim());
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    const wrapped = new Error(detail.split(/\r?\n/).at(-1) || 'O motor Python não conseguiu processar o arquivo.');
    wrapped.status = 422;
    throw wrapped;
  }
}

async function appendFailedImport(detail) {
  const catalog = await readCatalog();
  catalog.imports.unshift({ id:`imp_${crypto.randomUUID()}`, uploadedAt:isoNow(), status:'falha', ...detail });
  await writeCatalog(catalog);
}

function validateUpload(filename, buffer) {
  if (path.extname(String(filename || '')).toLowerCase() !== '.txt') throw Object.assign(new Error('Selecione um arquivo com extensão .txt.'), { status:422 });
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('O arquivo está vazio.'), { status:422 });
}

async function prepareImport({ filename, buffer, actor }) {
  await ensureIngestionStorage();
  validateUpload(filename, buffer);
  const catalog = await readCatalog();
  const source = activeSource(catalog);
  const token = crypto.randomUUID();
  const uploadFile = path.join(UPLOAD_DIR, `${token}.txt`);
  const metaFile = path.join(UPLOAD_DIR, `${token}.json`);
  await fs.writeFile(uploadFile, buffer);
  try {
    const preview = await runEngine([
      'preview', '--input', uploadFile, '--source-id', source.id,
      '--checkpoint', JSON.stringify(source.checkpoint || null)
    ]);
    const meta = {
      token,
      sourceId: source.id,
      filename: path.basename(String(filename)),
      fileHash: preview.fileHash,
      checkpointFingerprint: source.checkpoint?.fingerprint || null,
      actor: safeActor(actor),
      createdAt: isoNow(),
      preview
    };
    await atomicWriteJson(metaFile, meta);
    return { token, source:{ id:source.id, name:source.name }, checkpoint:source.checkpoint, ...preview };
  } catch (error) {
    await Promise.all([fs.rm(uploadFile, { force:true }), fs.rm(metaFile, { force:true })]);
    await appendFailedImport({
      fileName:path.basename(String(filename)), actor:safeActor(actor), sourceId:source.id,
      previousCheckpoint:source.checkpoint, error:error.message
    });
    throw error;
  }
}

async function readCommittedBatches(catalog) {
  const rows = [];
  for (const reference of catalog.batches) {
    const file = path.join(BATCH_DIR, path.basename(reference.file || `${reference.id}.json`));
    rows.push(JSON.parse(await fs.readFile(file, 'utf8')));
  }
  return rows;
}

async function effectiveSenderDirectory(catalog) {
  const base = JSON.parse(await fs.readFile(BASE_DIRECTORY_FILE, 'utf8'));
  const byId = new Map(base.map((item) => [String(item.sender_id), item]));
  for (const batch of await readCommittedBatches(catalog)) {
    for (const item of batch.directoryUpdates || []) byId.set(String(item.sender_id), item);
  }
  return [...byId.values()];
}

async function removeStaging(token) {
  await Promise.all([
    fs.rm(path.join(UPLOAD_DIR, `${token}.txt`), { force:true }),
    fs.rm(path.join(UPLOAD_DIR, `${token}.json`), { force:true }),
    fs.rm(path.join(UPLOAD_DIR, `${token}.neighborhoods.json`), { force:true }),
    fs.rm(path.join(UPLOAD_DIR, `${token}.senders.json`), { force:true })
  ]);
}

async function processImport({ token, actor, neighborhoods }) {
  if (processing) throw Object.assign(new Error('Já existe uma importação em processamento.'), { status:409 });
  processing = true;
  let meta = null;
  let catalog = null;
  let source = null;
  try {
    await ensureIngestionStorage();
    const safeToken = path.basename(String(token || ''));
    if (!/^[0-9a-f-]{36}$/i.test(safeToken)) throw Object.assign(new Error('Prévia de importação inválida.'), { status:422 });
    const metaFile = path.join(UPLOAD_DIR, `${safeToken}.json`);
    const uploadFile = path.join(UPLOAD_DIR, `${safeToken}.txt`);
    meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    catalog = await readCatalog();
    source = activeSource(catalog);
    if (meta.sourceId !== source.id || meta.checkpointFingerprint !== (source.checkpoint?.fingerprint || null)) {
      throw Object.assign(new Error('O checkpoint mudou depois da prévia. Faça o upload novamente.'), { status:409 });
    }
    const importingActor = safeActor(actor || meta.actor);
    const importId = `imp_${crypto.randomUUID()}`;
    const neighborhoodsFile = path.join(UPLOAD_DIR, `${safeToken}.neighborhoods.json`);
    const sendersFile = path.join(UPLOAD_DIR, `${safeToken}.senders.json`);
    await atomicWriteJson(neighborhoodsFile, neighborhoods || []);
    await atomicWriteJson(sendersFile, await effectiveSenderDirectory(catalog));
    const result = await runEngine([
      'process', '--input', uploadFile, '--source-id', source.id,
      '--checkpoint', JSON.stringify(source.checkpoint || null), '--import-id', importId,
      '--neighborhoods', neighborhoodsFile, '--sender-directory', sendersFile
    ]);
    if (result.fileHash !== meta.fileHash) throw Object.assign(new Error('O arquivo foi alterado depois da prévia.'), { status:409 });

    const record = {
      id: importId,
      sourceId: source.id,
      fileName: meta.filename,
      fileHash: result.fileHash,
      uploadedAt: meta.createdAt,
      processedAt: isoNow(),
      actor: importingActor,
      previousCheckpoint: source.checkpoint,
      finalCheckpoint: result.checkpointFinal || source.checkpoint,
      messagesImported: Number(result.newMessageCount || 0),
      opportunitiesGenerated: (result.opportunities || []).length,
      reviewsGenerated: (result.reviews || []).length,
      status: Number(result.newMessageCount || 0) ? 'concluida' : 'sem_alteracoes',
      error: null
    };

    if (!record.messagesImported) {
      catalog.imports.unshift(record);
      await writeCatalog(catalog);
      await removeStaging(safeToken);
      return record;
    }

    const committed = await readCommittedBatches(catalog);
    const committedFingerprints = new Set(committed.flatMap((batch) => batch.messageFingerprints || []));
    const duplicateMessage = (result.messageFingerprints || []).find((fingerprint) => committedFingerprints.has(fingerprint));
    if (duplicateMessage) throw Object.assign(new Error('Uma mensagem nova já consta em um lote confirmado. Nenhum dado foi gravado.'), { status:409 });
    const committedOpportunityIds = new Set(committed.flatMap((batch) => (batch.opportunities || []).map((item) => item.id)));
    const duplicateOpportunity = (result.opportunities || []).find((item) => committedOpportunityIds.has(item.id));
    if (duplicateOpportunity) throw Object.assign(new Error(`Oportunidade duplicada detectada: ${duplicateOpportunity.id}.`), { status:409 });

    const batch = {
      id: importId,
      sourceId: source.id,
      committedAt: isoNow(),
      checkpointBefore: source.checkpoint,
      checkpointAfter: result.checkpointFinal,
      fileHash: result.fileHash,
      messageFingerprints: result.messageFingerprints || [],
      opportunities: result.opportunities || [],
      directoryUpdates: result.directoryUpdates || [],
      reviews: result.reviews || [],
      reviewMessages: result.reviewMessages || []
    };
    const batchName = `${importId}.json`;
    await atomicWriteJson(path.join(BATCH_DIR, batchName), batch);
    catalog.batches.push({ id:importId, file:batchName, committedAt:batch.committedAt });
    catalog.imports.unshift(record);
    source.checkpoint = result.checkpointFinal;
    source.updatedAt = isoNow();
    await writeCatalog(catalog);
    await removeStaging(safeToken);
    return record;
  } catch (error) {
    if (meta && catalog && source) {
      catalog.imports.unshift({
        id:`imp_${crypto.randomUUID()}`, sourceId:source.id, fileName:meta.filename,
        uploadedAt:meta.createdAt, processedAt:isoNow(), actor:safeActor(actor || meta.actor),
        previousCheckpoint:source.checkpoint, finalCheckpoint:source.checkpoint,
        messagesImported:0, opportunitiesGenerated:0, reviewsGenerated:0,
        status:'falha', error:error.message
      });
      await writeCatalog(catalog).catch(() => {});
      await removeStaging(meta.token).catch(() => {});
    }
    throw error;
  } finally { processing = false; }
}

async function loadCommittedData() {
  const catalog = await readCatalog();
  const batches = await readCommittedBatches(catalog);
  return {
    catalog,
    batches,
    opportunities:batches.flatMap((batch) => batch.opportunities || []),
    directoryUpdates:batches.flatMap((batch) => batch.directoryUpdates || []),
    reviewMessages:batches.flatMap((batch) => batch.reviewMessages || []),
    overrides:catalog.overrides || {},
    lastImport:catalog.imports.find((item) => item.status === 'concluida') || null
  };
}

async function ingestionVersion() {
  if (process.env.VERCEL) return 'vercel-demo';
  await ensureIngestionStorage();
  const catalog = await readCatalog();
  const files = [CATALOG_FILE, ...catalog.batches.map((item) => path.join(BATCH_DIR, path.basename(item.file)))];
  const stats = await Promise.all(files.map((file) => fs.stat(file)));
  return stats.map((stat) => `${stat.size}:${stat.mtimeMs}`).join('|');
}

async function getIngestionStatus() {
  const catalog = await readCatalog();
  const source = activeSource(catalog);
  const reviews = await listReviews();
  return {
    source:{ id:source.id, name:source.name, checkpoint:source.checkpoint, baselineHash:source.baselineHash },
    processing,
    imports:catalog.imports.slice(0, 50),
    pendingReviews:reviews.filter((item) => item.status === 'pendente').length
  };
}

async function listReviews() {
  const catalog = await readCatalog();
  const batches = await readCommittedBatches(catalog);
  const decisions = new Map(catalog.reviewDecisions.map((item) => [item.reviewId, item]));
  return batches.flatMap((batch) => (batch.reviews || []).map((review) => {
    const decision = decisions.get(review.id);
    return decision ? { ...review, status:decision.status, decision } : review;
  })).sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')));
}

async function resolveReview(reviewId, resolution, actor) {
  const catalog = await readCatalog();
  const reviews = await listReviews();
  const review = reviews.find((item) => item.id === reviewId);
  if (!review) throw Object.assign(new Error('Item de revisão não encontrado.'), { status:404 });
  if (review.status !== 'pendente') throw Object.assign(new Error('Este item já foi resolvido.'), { status:409 });
  const action = String(resolution.action || '');
  if (!['aprovar', 'associar', 'rejeitar', 'resolver'].includes(action)) throw Object.assign(new Error('Ação de revisão inválida.'), { status:422 });
  const decision = {
    id:`dec_${crypto.randomUUID()}`, reviewId, action,
    status:action === 'rejeitar' ? 'rejeitado' : 'resolvido',
    neighborhood:resolution.neighborhood || null,
    reason:String(resolution.reason || ''), actor:safeActor(actor), decidedAt:isoNow()
  };
  catalog.reviewDecisions.push(decision);
  if (decision.neighborhood && review.opportunityId) {
    catalog.overrides[review.opportunityId] = {
      ...(catalog.overrides[review.opportunityId] || {}),
      bairro_original:review.candidateName || decision.neighborhood.nome,
      bairro_normalizado:decision.neighborhood.nome,
      bairro_id:decision.neighborhood.id,
      latitude:decision.neighborhood.latitude ?? null,
      longitude:decision.neighborhood.longitude ?? null,
      cidade_detectada:decision.neighborhood.cidade || 'Campina Grande',
      review_decision_id:decision.id
    };
  }
  await writeCatalog(catalog);
  return { ...review, status:decision.status, decision };
}

module.exports = {
  SOURCE_ID,
  BASELINE_CHECKPOINT,
  ensureIngestionStorage,
  prepareImport,
  processImport,
  loadCommittedData,
  ingestionVersion,
  getIngestionStatus,
  listReviews,
  resolveReview
};
