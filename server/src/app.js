'use strict';
/* app.js – builds the HTTP request handler: security headers, CORS, rate limiting,
   session lookup, CSRF, routing, static files and a single error funnel. */

const http = require('node:http');
const config = require('./config');
const db = require('./db');
const { Router } = require('./router');
const staticFiles = require('./static');
const { sendJson, HttpError, notFound, clientIp } = require('./http');
const { rateLimit, identify, requireCsrf } = require('./middleware');

const routes = [
  require('./routes/auth'),
  require('./routes/users'),
  require('./routes/items'),
  require('./routes/meta'),
];

function buildRouter() {
  const router = new Router();
  for (const group of routes) group.register(router);
  return router;
}

/* Requests that only read data never need a CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = config.corsOrigins.includes(origin);
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.setHeader('Access-Control-Max-Age', '600');
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function createHandler() {
  const router = buildRouter();

  return async function handle(req, res) {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendJson(res, 400, { error: { code: 'bad_url', message: 'Malformed URL' } });
    }
    const pathname = url.pathname.replace(/\/{2,}/g, '/');
    const isApi = pathname === '/api' || pathname.startsWith('/api/');

    securityHeaders(res);
    applyCors(req, res);

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    try {
      if (!isApi) {
        /* Static frontend. Unknown paths fall back to index.html so the page always opens. */
        if (config.serveStatic) {
          if (staticFiles.serve(req, res, config.staticDir, pathname)) return;
          if (req.method === 'GET' && !pathname.includes('.')) {
            if (staticFiles.serve(req, res, config.staticDir, '/index.html')) return;
          }
        }
        throw notFound('Page not found');
      }

      rateLimit(req);

      const ctx = { query: url.searchParams, params: {} };
      identify(req, ctx);

      const match = router.match(req.method, pathname);
      if (!match) throw notFound(`No such endpoint: ${req.method} ${pathname}`);
      if (!match.handler) {
        res.setHeader('Allow', match.allowed.join(', '));
        throw new HttpError(405, `Use ${match.allowed.join(' or ')} on this endpoint`, 'method_not_allowed');
      }

      if (!SAFE_METHODS.has(req.method)) requireCsrf(req, ctx);

      req.params = match.params;
      ctx.params = match.params;
      await match.handler(req, res, ctx);

      if (!res.writableEnded) sendJson(res, 204, null);
    } catch (err) {
      const status = Number(err && err.status) || 500;
      const payload = {
        error: {
          code: (err && err.code) || (status === 500 ? 'server_error' : 'error'),
          message: status === 500
            ? 'Something went wrong on the server'
            : String((err && err.message) || 'Request failed'),
        },
      };
      if (err && err.retryAfter) {
        res.setHeader('Retry-After', String(err.retryAfter));
        payload.error.retryAfter = err.retryAfter;
      }
      if (status === 500) {
        console.error(`[error] ${req.method} ${pathname}`, err);
      }
      if (!res.writableEnded) sendJson(res, status, payload);
    } finally {
      if (config.logRequests && isApi) {
        const ms = Date.now() - started;
        console.log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${ms}ms ${clientIp(req)}`);
      }
    }
  };
}

/** Create a ready-to-listen HTTP server with the database open. */
function createApp({ initDb = true, log = () => {} } = {}) {
  if (initDb) db.init(config, log);
  const server = http.createServer(createHandler());
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  return server;
}

module.exports = { createApp, createHandler, buildRouter };
