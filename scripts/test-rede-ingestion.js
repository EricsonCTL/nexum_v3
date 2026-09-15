const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexum-rede-'));
  process.env.NEXUM_BROKER_DATA_DIR = testDir;
  await fs.writeFile(path.join(testDir, 'sender_directory.json'), '[]\n', 'utf8');
  const ingestion = require('../rede-ingestion');
  await ingestion.ensureIngestionStorage();
  const initial = await ingestion.getIngestionStatus();
  assert.equal(initial.source.checkpoint.date, '2026-05-03');
  assert.equal(initial.source.checkpoint.time, '12:26');

  const text = [
    '03/05/2026 12:26 - +55 83 8862-5551: Preciso de casa para locação no Catolé ',
    '4 mil',
    '03/05/2026 12:30 - Maria Corretora: Vendo casa no bairro Jardim Aurora por 250 mil'
  ].join('\n');
  const actor = { codigo:'teste', nome:'Teste', perfil:'ADMINISTRADOR' };
  const preview = await ingestion.prepareImport({ filename:'conversa.txt', buffer:Buffer.from(text), actor });
  assert.equal(preview.newMessageCount, 1);
  const imported = await ingestion.processImport({ token:preview.token, actor, neighborhoods:[] });
  assert.equal(imported.messagesImported, 1);
  assert.equal(imported.opportunitiesGenerated, 1);
  assert.equal(imported.reviewsGenerated, 1);
  const committed = await ingestion.loadCommittedData();
  assert.equal(committed.opportunities.length, 1);
  assert.equal(committed.catalog.batches.length, 1);
  const brokerData = require('../broker-data');
  brokerData.clearBrokerDataCache();
  assert.equal((await brokerData.getBrokerAnalytics({ top:10 })).meta.totalOpportunities, 21663);

  const [firstReview] = await ingestion.listReviews();
  assert.equal(firstReview.candidateName, 'Jardim Aurora');
  const neighborhood = { id:'bairro-jardim-aurora', nome:'Jardim Aurora', cidade:'Campina Grande', uf:'PB', latitude:-7.22, longitude:-35.88 };
  const approved = await ingestion.resolveReview(firstReview.id, { action:'aprovar', neighborhood }, actor);
  assert.equal(approved.status, 'resolvido');
  assert.equal((await ingestion.loadCommittedData()).overrides[firstReview.opportunityId].bairro_id, neighborhood.id);
  await assert.rejects(ingestion.resolveReview(firstReview.id, { action:'rejeitar' }, actor), /já foi resolvido/);

  const repeatedPreview = await ingestion.prepareImport({ filename:'conversa.txt', buffer:Buffer.from(text), actor });
  assert.equal(repeatedPreview.newMessageCount, 0);
  const repeated = await ingestion.processImport({ token:repeatedPreview.token, actor, neighborhoods:[] });
  assert.equal(repeated.status, 'sem_alteracoes');
  assert.equal((await ingestion.loadCommittedData()).catalog.batches.length, 1);

  const beforeFailure = (await ingestion.getIngestionStatus()).source.checkpoint.fingerprint;
  await assert.rejects(
    ingestion.prepareImport({ filename:'invalido.txt', buffer:Buffer.from('arquivo inválido'), actor }),
    /formato WhatsApp/
  );
  await assert.rejects(
    ingestion.prepareImport({ filename:'latin1.txt', buffer:Buffer.from('03/05/2026 12:26 - João: imóvel', 'latin1'), actor }),
    /codificado em UTF-8/
  );
  assert.equal((await ingestion.getIngestionStatus()).source.checkpoint.fingerprint, beforeFailure);

  const textWithNextMessage = `${text}\n03/05/2026 12:35 - João Corretor: Alugo apartamento no bairro Vila Nova por 2 mil`;
  const changedPreview = await ingestion.prepareImport({ filename:'alterado.txt', buffer:Buffer.from(textWithNextMessage), actor });
  await fs.appendFile(path.join(testDir, 'ingestion', '.uploads', `${changedPreview.token}.txt`), '\n03/05/2026 12:36 - Outro: Procuro casa no Centro');
  await assert.rejects(
    ingestion.processImport({ token:changedPreview.token, actor, neighborhoods:[] }),
    /alterado depois da prévia/
  );
  assert.equal((await ingestion.getIngestionStatus()).source.checkpoint.fingerprint, beforeFailure);

  const pythonFailurePreview = await ingestion.prepareImport({ filename:'falha-python.txt', buffer:Buffer.from(textWithNextMessage), actor });
  const previousPython = process.env.NEXUM_PYTHON;
  process.env.NEXUM_PYTHON = path.join(testDir, 'python-inexistente.exe');
  await assert.rejects(
    ingestion.processImport({ token:pythonFailurePreview.token, actor, neighborhoods:[] }),
    /python-inexistente|ENOENT|não conseguiu/i
  );
  if (previousPython === undefined) delete process.env.NEXUM_PYTHON; else process.env.NEXUM_PYTHON = previousPython;
  assert.equal((await ingestion.getIngestionStatus()).source.checkpoint.fingerprint, beforeFailure);

  const concurrentA = await ingestion.prepareImport({ filename:'concorrente-a.txt', buffer:Buffer.from(textWithNextMessage), actor });
  const concurrentB = await ingestion.prepareImport({ filename:'concorrente-b.txt', buffer:Buffer.from(textWithNextMessage), actor });
  const firstProcess = ingestion.processImport({ token:concurrentA.token, actor, neighborhoods:[] });
  await assert.rejects(
    ingestion.processImport({ token:concurrentB.token, actor, neighborhoods:[] }),
    /Já existe uma importação/
  );
  const concurrentResult = await firstProcess;
  assert.equal(concurrentResult.messagesImported, 1);
  assert.equal((await ingestion.loadCommittedData()).catalog.batches.length, 2);
  brokerData.clearBrokerDataCache();
  assert.equal((await brokerData.getBrokerAnalytics({ top:10 })).meta.totalOpportunities, 21664);

  const pendingReview = (await ingestion.listReviews()).find((item) => item.status === 'pendente');
  assert.equal(pendingReview.candidateName, 'Vila Nova');
  const rejected = await ingestion.resolveReview(pendingReview.id, { action:'rejeitar', reason:'Não pertence ao cadastro territorial.' }, actor);
  assert.equal(rejected.status, 'rejeitado');
  assert.equal((await ingestion.loadCommittedData()).overrides[pendingReview.opportunityId], undefined);

  const audit = (await ingestion.getIngestionStatus()).imports;
  assert.ok(audit.some((item) => item.status === 'falha' && /alterado depois da prévia/.test(item.error)));
  assert.ok(audit.some((item) => item.status === 'falha' && /python-inexistente|ENOENT|não conseguiu/i.test(item.error)));
  await fs.rm(testDir, { recursive:true, force:true });
  console.log('rede ingestion incremental: ok');
})().catch((error) => { console.error(error); process.exit(1); });
