const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'PDF Entrada');
const port = 3130;
const base = `http://127.0.0.1:${port}`;

function request(pathname, options = {}) {
  return fetch(`${base}${pathname}`, options).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Falha HTTP ${response.status}`);
    return data;
  });
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Servidor não iniciou a tempo.')), 10000);
    child.stdout.on('data', (buffer) => {
      if (buffer.toString().includes('Nexo Radar disponível')) { clearTimeout(timeout); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Servidor encerrou (código ${code}).`)); });
  });
}

async function main() {
  const files = (await fs.readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith('.pdf'));
  if (files.length !== 1) throw new Error(`Esperado 1 PDF em "PDF Entrada"; encontrados ${files.length}.`);
  const pdfName = files[0];
  const pdfPath = path.join(sourceDir, pdfName);
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.on('data', (buffer) => process.stderr.write(buffer));
  try {
    await waitForServer(child);
    const all = await request('/api/empreendimentos');
    let empreendimento = all.find((item) => item.nome.trim().toUpperCase() === 'LETS BELA VISTA - INC');
    if (!empreendimento) {
      empreendimento = await request('/api/empreendimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        nome: 'LETS BELA VISTA - INC', endereco: 'Rua Cônego Pequeno', numero: '900', bairro: 'Bela Vista', cidade: 'Campina Grande', estado: 'PB', cep: '58400-802', tipo: 'Apartamento', padrao: 'Outro',
        observacoes: 'Cadastro inicial criado a partir da tabela comercial recebida.'
      }) });
    }
    const bytes = await fs.readFile(pdfPath);
    const form = new FormData();
    form.set('nome', 'Tabela Bela Vista - Abril 2026');
    // O PDF informa "Abril 2026" e foi gerado em 24/04/2026. A data de validade
    // precisa de confirmação humana; ela não é inferida como fato definitivo.
    form.set('dataValidade', '2026-04-24');
    form.set('observacoes', 'Data de validade a confirmar. O PDF identifica "BELA VISTA - ABRIL 2026" e informa geração em 24/04/2026.');
    form.set('pdf', new Blob([bytes], { type: 'application/pdf' }), pdfName);
    const table = await request(`/api/empreendimentos/${empreendimento.id}/tabelas`, { method: 'POST', body: form });
    console.log(JSON.stringify({ empreendimentoId: empreendimento.id, tabelaId: table.id, status: table.status, unidadesIdentificadas: table.unidades.length, avisos: table.extracao.warnings }, null, 2));
  } finally {
    child.kill();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
