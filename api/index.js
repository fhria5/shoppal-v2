// Vercel serverless entry point: serve the Express app.
// The app itself lives in ../server.js and only listens when run directly.
const app = require('../server.js');

module.exports = app;
