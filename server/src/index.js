'use strict';
/* index.js – start the server. `npm start` from the server folder. */

const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');

function start() {
  const seedLog = msg => console.log(`[setup] ${msg}`);
  const server = createApp({ initDb: true, log: seedLog });

  /* Housekeeping: drop expired sessions every 15 minutes. */
  const sweep = setInterval(() => {
    const removed = db.purgeExpiredSessions();
    if (removed) console.log(`[cleanup] removed ${removed} expired session(s)`);
  }, 15 * 60 * 1000);
  sweep.unref?.();

  server.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    console.log('');
    console.log('  Task and Project Tracker – backend');
    console.log(`  API        http://${shown}:${config.port}/api`);
    if (config.serveStatic) console.log(`  Tracker    http://${shown}:${config.port}/`);
    console.log(`  Database   ${config.dbFile}`);
    console.log(`  Mode       ${config.env}`);
    console.log('');
  });

  const shutdown = signal => {
    console.log(`\n[${signal}] shutting down…`);
    clearInterval(sweep);
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref?.();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

  return server;
}

if (require.main === module) start();

module.exports = { start };
