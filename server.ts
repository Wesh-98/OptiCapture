import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

import './src/server/db.js';                        // runs migrations + seeding on import
import { apiLimiter } from './src/server/middleware.js';
import { UPLOADS_DIR, getLocalIP, getTunnelUrl } from './src/server/helpers.js';
import { authRouter }       from './src/server/routes/auth.js';
import { adminRouter }      from './src/server/routes/admin.js';
import { categoriesRouter } from './src/server/routes/categories.js';
import { inventoryRouter }  from './src/server/routes/inventory.js';
import { sessionsRouter }   from './src/server/routes/sessions.js';
import { logsRouter }       from './src/server/routes/logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 3000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const app = express();
// Trust the first proxy only in production (Cloudflare / nginx). In dev, trust proxy
// would let any client spoof X-Forwarded-For and bypass all rate limiting.
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // unsafe-inline removed in production — Vite dev injects inline scripts/styles
      scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      styleSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "blob:", "https://drive.google.com", "https://lh3.googleusercontent.com"],
      // Dev: allow all HTTPS so Vite HMR source-map fetches through the tunnel aren't blocked.
      // Prod: lock down to only the two external APIs we actually call.
      connectSrc: isProd
        ? ["'self'", "https://world.openfoodfacts.org", "https://api.upcitemdb.com", "wss:"]
        : ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/icons', express.static(path.join(process.cwd(), 'public', 'icons')));

// Google Drive image proxy — fetches Drive thumbnails server-side so the browser
// never needs a Google session. Only Drive file IDs are accepted (no open proxy).
app.get('/api/drive-image/:fileId', (req, res) => {
  const { fileId } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) return res.status(400).end();
  res.redirect(302, `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`);
});

app.use('/api', apiLimiter);
app.use('/api/auth',  authRouter);
app.use('/api/admin', adminRouter);
app.use('/api',       categoriesRouter);   // /api/categories + /api/dashboard
app.use('/api',       inventoryRouter);    // /api/inventory
app.use('/api',       sessionsRouter);     // /api/session(s)
app.use('/api',       logsRouter);         // /api/logs

// Server info — stays in bootstrap: needs access to app.protocol and PORT
app.get('/api/server-info', (_req, res) => {
  const ip = getLocalIP();
  const protocol = (app as any).protocol || 'http';
  const lanUrl = `${protocol}://${ip}:${PORT}`;
  const tunnelUrl = getTunnelUrl();
  res.json({
    ip,
    port: PORT,
    protocol,
    mobileUrl: tunnelUrl ?? lanUrl,
    tunnelUrl: tunnelUrl ?? null,
  });
});

// HTTPS certificate helper
function getHttpsOptions() {
  const devKeyPath = path.join(__dirname, 'dev-key.pem');
  const devCertPath = path.join(__dirname, 'dev-cert.pem');

  if (fs.existsSync(devKeyPath) && fs.existsSync(devCertPath)) {
    console.log('✓ Using SSL certificates (dev-key.pem / dev-cert.pem)');
    return {
      key: fs.readFileSync(devKeyPath),
      cert: fs.readFileSync(devCertPath)
    };
  }

  return null;
}

// Create the HTTP(S) server up-front so Vite HMR can share the same server
// instance. WebSocket upgrade events fire on the Node.js http.Server — they
// never reach Express middleware — so Vite must listen on the same server to
// receive upgrades forwarded by the Cloudflare tunnel (or any reverse proxy).
let protocol = 'http';
const httpsOptions = getHttpsOptions();
let nodeServer: http.Server | https.Server;

if (httpsOptions) {
  try {
    nodeServer = https.createServer(httpsOptions, app);
    protocol = 'https';
  } catch (err: any) {
    console.log(`ℹ HTTPS setup failed, using HTTP: ${err.message}`);
    nodeServer = http.createServer(app);
  }
} else {
  nodeServer = http.createServer(app);
}

(app as any).protocol = protocol;

// Vite Middleware + Server Start
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      // Pass the shared server so Vite's WebSocket upgrade handler is attached
      // to the same http.Server instance that receives tunnel traffic.
      hmr: process.env.DISABLE_HMR === 'true' ? false : { server: nodeServer },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static('dist'));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

nodeServer.listen(PORT, '0.0.0.0', () => {
  if (protocol === 'https') {
    console.log(`🔒 HTTPS Server running on https://localhost:${PORT}`);
    console.log(`🔒 HTTPS Server running on https://127.0.0.1:${PORT}`);
    console.log(`✓ Camera scanning enabled via HTTPS`);
  } else {
    console.log(`🔓 HTTP Server running on http://localhost:${PORT}`);
    console.log(`ℹ No SSL cert files found. HTTPS is required for camera scanning.`);
  }
});
