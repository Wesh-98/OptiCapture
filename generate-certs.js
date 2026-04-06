#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Preferred trusted mkcert files
const mkcertKeyPath = path.join(__dirname, 'localhost+2-key.pem');
const mkcertCertPath = path.join(__dirname, 'localhost+2.pem');

// App default cert filenames
const devKeyPath = path.join(__dirname, 'dev-key.pem');
const devCertPath = path.join(__dirname, 'dev-cert.pem');

function copyFileIfNeeded(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

function applyMkcertCertificates() {
  console.log('✓ Trusted mkcert certificates found');
  copyFileIfNeeded(mkcertKeyPath, devKeyPath);
  copyFileIfNeeded(mkcertCertPath, devCertPath);
  console.log('✓ Copied mkcert certificates to dev-key.pem and dev-cert.pem');
  process.exit(0);
}

function applyExistingDevCertificates() {
  console.log('✓ Existing SSL certificates already found');
  process.exit(0);
}

function generateSelfSignedCertificates() {
  console.log('Generating self-signed SSL certificates with OpenSSL...');

  // openssl command is identical on Windows and Unix — kept explicit for clarity
  const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${devKeyPath}" -out "${devCertPath}" -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Org/CN=localhost"`;

  execSync('openssl version', { stdio: 'ignore' });
  execSync(cmd, { stdio: 'inherit' });

  console.log('✓ Self-signed certificates generated successfully');
  console.log('⚠ These may still show browser warnings unless you use mkcert');
  process.exit(0);
}

try {
  // 1. Prefer trusted mkcert certificates
  if (fs.existsSync(mkcertKeyPath) && fs.existsSync(mkcertCertPath)) {
    applyMkcertCertificates();
  }

  // 2. If app certs already exist, use them
  if (fs.existsSync(devKeyPath) && fs.existsSync(devCertPath)) {
    applyExistingDevCertificates();
  }

  // 3. Otherwise generate self-signed certs
  generateSelfSignedCertificates();
} catch (error) {
  console.warn('⚠ Could not prepare SSL certificates');
  console.warn(error?.message || error);

  console.log('\nTo fix this, do one of these:');
  console.log('1. Preferred: install mkcert and run:');
  console.log('   mkcert -install');
  console.log('   mkcert localhost 127.0.0.1 ::1');
  console.log('');
  console.log('2. Or ensure OpenSSL is installed and available in PATH');
  console.log('');
  console.log('Expected trusted files in this folder:');
  console.log('   localhost-key.pem');
  console.log('   localhost.pem');

  process.exit(0);
}