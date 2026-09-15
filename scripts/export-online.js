const path = require('node:path');
const fs = require('node:fs/promises');
const { exportOnline } = require('../lib/online-export');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dataFile = process.env.NEXO_DATA_FILE
    ? path.resolve(process.env.NEXO_DATA_FILE)
    : path.join(root, 'data', 'nexo-radar.json');
  const data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const result = await exportOnline({ root, data });
  console.log(`Nexum online sincronizado: ${result.destination}`);
  console.log(`${result.files.length} arquivos publicados; motor interno excluído.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
