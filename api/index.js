const { createApp } = require('../server');

// Create Express app once per cold start
const app = createApp();

// Vercel serverless entry
module.exports = (req, res) => app(req, res);




