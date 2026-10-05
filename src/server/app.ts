/**
 * app.ts — Express application factory
 *
 * Exports `createApp()` which wires up all middleware and API routes but does
 * NOT start listening or attach Vite dev middleware. Keeping these concerns
 * separate has two benefits:
 *
 *   1. Tests can call `createApp()` directly and use supertest without a live
 *      port or Vite dev server.
 *   2. server.ts stays focused on the runtime bootstrap (HTTPS certs, Vite HMR,
 *      `nodeServer.listen()`).
 */
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';

import { db } from './db.js';
import { apiLimiter, asyncRoute } from './middleware.js';
import { UPLOADS_DIR, getLocalIP, getTunnelUrl } from './helpers.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { categoriesRouter } from './routes/categories.js';
import { inventoryRouter } from './routes/inventory.js';
import { sessionsRouter } from './routes/sessions.js';
import { logsRouter } from './routes/logs.js';
import { logError, logWarn } from './logger.js';

const MAX_PROXIED_IMAGE_BYTES = 5 * 1024 * 1024;

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

export function parseTrustProxy(value: string | undefined): string | number | boolean {
  const trimmed = value?.trim();
  if (!trimmed) return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  return trimmed;
}

export function createApp() {
  const app = express();

  // Trust X-Forwarded-For only from proxies on loopback or private networks: the local
  // tunnel in dev, a load balancer inside the VPC in production. A fixed hop count (the
  // old `1`) trusted the header from anyone, so a client reaching the app directly could
  // pick its own IP and sidestep every rate limit. TRUST_PROXY overrides this for other
  // proxy chains, e.g. "2" for CloudFront in front of an ALB.
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  // ── Security headers ────────────────────────────────────────────────────────
  const isProd = process.env.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // unsafe-inline removed in production — Vite dev injects inline scripts/styles
          scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            'data:',
            'https:',
            'blob:',
            'https://drive.google.com',
            'https://docs.google.com',
            'https://lh3.googleusercontent.com',
          ],
          // Dev: allow all HTTPS so Vite HMR source-map fetches through the tunnel aren't blocked.
          // Prod: lock down to only the two external APIs we actually call.
          connectSrc: isProd
            ? ["'self'", 'https://world.openfoodfacts.org', 'https://api.upcitemdb.com', 'wss:']
            : ["'self'", 'https:', 'wss:', 'ws:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // Gzip responses: the phone scan page's scripts shrink by roughly two thirds, which is
  // most of its load time on store Wi-Fi or mobile data.
  app.use(compression());

  // Load-balancer health check: unauthenticated, outside the rate limiter, and it fails
  // when the database cannot answer so an unhealthy instance leaves rotation.
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch (error) {
      logError('health', error, 'Database health check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  // Reject excessive API traffic before spending work parsing request bodies.
  app.use('/api', apiLimiter);

  // ── Body parsing + cookies ───────────────────────────────────────────────────
  // Most endpoints take small JSON bodies, so the global cap stays tight to limit
  // DoS exposure. /api/inventory/batch-confirm is the one exception: it echoes back
  // every parsed row from a file that multer accepts at up to 20 MB, and those rows
  // expand once serialised as JSON. It therefore gets its own larger limit, applied
  // first so the global parser never sees the request. Without this, a large import
  // 413s only after the user has finished the column mapping.
  app.use('/api/inventory/batch-confirm', express.json({ limit: '60mb' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    if (
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      req.is('application/json') &&
      (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body))
    ) {
      return res.status(400).json({ error: 'JSON request body must be an object' });
    }
    next();
  });

  // ── Static assets ────────────────────────────────────────────────────────────
  // Uploaded product images (saved to disk by saveBase64Image / multer).
  // dotfiles: 'deny' returns 403 for any dot-prefixed file instead of silently
  // ignoring it. Content-Disposition forces download so stored .svg/.html files
  // can never render in browser context even if one slips past validation.
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      dotfiles: 'deny',
      setHeaders: res => res.setHeader('Content-Disposition', 'attachment'),
    })
  );
  // Category icons bundled in public/icons/
  app.use('/icons', express.static(path.join(process.cwd(), 'public', 'icons')));

  // ── Google Drive image proxy ─────────────────────────────────────────────────
  // Fetches Drive thumbnails server-side so the browser never follows a
  // cross-origin redirect. Only alphanumeric Drive file IDs are accepted to
  // prevent SSRF — any other character causes an immediate 400.
  app.get('/api/drive-image/:fileId', asyncRoute(async (req, res) => {
    const { fileId } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) return res.status(400).end();

    const candidateUrls = [
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
      `https://drive.google.com/uc?export=view&id=${fileId}`,
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      for (const url of candidateUrls) {
        const upstream = await fetch(url, {
          headers: { Accept: 'image/*', 'User-Agent': 'OptiCapture/1.0' },
          signal: controller.signal,
        });
        if (!upstream.ok) continue;
        const contentType = upstream.headers.get('content-type') || '';
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(contentType))
          continue;
        const buffer = await readBodyWithLimit(upstream, MAX_PROXIED_IMAGE_BYTES);
        // 5 MB cap — prevents unexpectedly large Drive files (videos, huge TIFFs)
        // from being fully buffered into memory before the response is sent.
        if (!buffer) return res.status(413).end();
        res.setHeader('Content-Type', contentType);
        res.setHeader(
          'Cache-Control',
          upstream.headers.get('cache-control') || 'public, max-age=3600'
        );
        return res.send(buffer);
      }
      return res.status(404).end();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logWarn('drive-image', 'Upstream image request timed out', { fileId });
      } else {
        logError('drive-image', error, 'Upstream image request failed', { fileId });
      }
      return res.status(502).end();
    } finally {
      clearTimeout(timeout);
    }
  }));

  // ── API routes ───────────────────────────────────────────────────────────────
  // apiLimiter applies to every /api/* request (2000 req / 15 min per IP).
  // Auth routes have their own tighter authLimiter defined inside authRouter.
  app.use('/api/auth', authRouter); // login, logout, register, me, store settings
  app.use('/api/admin', adminRouter); // superadmin store/user management
  app.use('/api', categoriesRouter); // /api/categories, /api/dashboard/stats
  app.use('/api', inventoryRouter); // /api/inventory
  app.use('/api', sessionsRouter); // /api/session(s)
  app.use('/api', logsRouter); // /api/logs

  // ── /api/server-info ─────────────────────────────────────────────────────────
  // Tells the Scan page which URL to put in the QR code. It has to be registered here,
  // before the /api 404 below, which would otherwise shadow it. `protocol` is an app
  // setting written by server.ts once the http/https server exists, and it is read per
  // request so the handler always sees the final value.
  app.get('/api/server-info', (req, res) => {
    const protocol = (req.app.get('protocol') as string | undefined) || 'http';
    const port = Number.parseInt(process.env.PORT ?? '', 10) || 3000;
    const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || null;

    if (publicBaseUrl) {
      // A deployed server's own address is a private one phones cannot reach; never expose it.
      return res.json({
        ip: null,
        port: null,
        protocol: 'https',
        mobileUrl: publicBaseUrl,
        tunnelUrl: null,
      });
    }

    const ip = getLocalIP();
    const tunnelUrl = getTunnelUrl();
    return res.json({
      ip,
      port,
      protocol,
      mobileUrl: tunnelUrl ?? `${protocol}://${ip}:${port}`,
      tunnelUrl: tunnelUrl ?? null,
    });
  });

  // ── Unmatched API routes ─────────────────────────────────────────────────────
  // server.ts mounts the SPA fallback (app.get('*')) after this factory returns, so
  // without this an unknown /api path fell through to it and answered 200 with
  // index.html. Clients saw a successful response and only failed later, on res.json().
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown API endpoint: ${req.method} ${req.originalUrl}` });
  });

  // ── Global error handler ─────────────────────────────────────────────────────
  // Catches any error passed to next(err) or thrown synchronously inside a route.
  // Without this, Express 4 leaks a full HTML stack trace on uncaught errors.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (
        typeof err === 'object' &&
        err !== null &&
        'type' in err &&
        err.type === 'entity.parse.failed'
      ) {
        return res.status(400).json({ error: 'Malformed JSON request body' });
      }
      logError('http', err, 'Unhandled request error', {
        method: _req.method,
        path: _req.path,
      });
      // A response already under way (e.g. a streamed PDF) cannot become a JSON error;
      // Express's default handler closes the connection instead.
      if (res.headersSent) return _next(err);
      res.status(500).json({ error: 'An internal error occurred' });
    }
  );

  return app;
}
