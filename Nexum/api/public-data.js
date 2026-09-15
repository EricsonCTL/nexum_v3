const fs = require('node:fs/promises');
const path = require('node:path');

// Endpoint deliberadamente estreito: entrega apenas a fotografia consolidada
// exportada pela raiz. Não há escrita, processamento de PDF ou rotina de
// manutenção no pacote online.
module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  try {
    const file = path.join(process.cwd(), 'data', 'nexum-public.json');
    const payload = JSON.parse(await fs.readFile(file, 'utf8'));
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    response.status(200).json(payload);
  } catch (_) {
    response.status(503).json({ error: 'Fotografia pública ainda não foi gerada.' });
  }
};
