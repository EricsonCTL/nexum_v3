const { handleRequest } = require('../app-server');

module.exports = async function handler(req, res) {
  return handleRequest(req, res);
};
