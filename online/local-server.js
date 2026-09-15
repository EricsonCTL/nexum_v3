const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { route } = require('./public-api');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3001);
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp',
  '.pdf':'application/pdf', '.csv':'text/csv; charset=utf-8'
};

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      const result = await route({ method:request.method, pathname:url.pathname, search:url.search, root:ROOT });
      response.writeHead(result.status, { 'Content-Type':MIME['.json'], 'Cache-Control':'no-store' });
      response.end(JSON.stringify(result.payload));
    } catch (_) {
      response.writeHead(503, { 'Content-Type':MIME['.json'] });
      response.end(JSON.stringify({ error:'Fotografia pública ainda não foi gerada.' }));
    }
    return;
  }
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep) || requested.includes('..') || path.basename(file).startsWith('.')) {
    response.writeHead(403); response.end('Acesso negado.'); return;
  }
  try {
    const content = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type':MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(content);
  } catch (_) {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' });
    response.end('Arquivo não encontrado.');
  }
}).listen(PORT, () => console.log(`Nexum online disponível em http://localhost:${PORT}`));
