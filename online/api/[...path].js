const path = require('node:path');
const { route } = require('../public-api');

module.exports = async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const result = await route({ method:request.method, pathname:url.pathname, search:url.search, root:process.cwd() });
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  response.status(result.status).json(result.payload);
};
