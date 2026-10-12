import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TUNNEL_FILE = path.join(__dirname, '.tunnel-url');
const TUNNEL_REGEX = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/;

function cleanup() {
  try { fs.unlinkSync(TUNNEL_FILE); } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// Dev-only helper: cloudflared is whatever the developer installed, found through their PATH.
const child = spawn('cloudflared', [ // NOSONAR
  'tunnel', '--url', 'https://localhost:3000', '--no-tls-verify'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let urlFound = false;

function handleOutput(data) {
  const text = data.toString();
  process.stdout.write(text);
  if (!urlFound) {
    const match = text.match(TUNNEL_REGEX);
    if (match) {
      urlFound = true;
      fs.writeFileSync(TUNNEL_FILE, match[1], 'utf8');
      console.log(`\n[tunnel] URL ready: ${match[1]}\n`);
    }
  }
}

child.stdout.on('data', handleOutput);
child.stderr.on('data', handleOutput);

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('[tunnel] cloudflared not found in PATH.');
    console.error('[tunnel] Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  } else {
    console.error('[tunnel] Error:', err.message);
  }
  process.exit(1);
});

child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
