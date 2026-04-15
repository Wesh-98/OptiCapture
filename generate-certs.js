#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runtime HTTPS files. server.ts only reads these two filenames.
const runtimeKeyPath = path.join(__dirname, 'dev-key.pem');
const runtimeCertPath = path.join(__dirname, 'dev-cert.pem');

function hasFile(filePath) {
  return fs.existsSync(filePath);
}

function hasPair(keyPath, certPath) {
  return hasFile(keyPath) && hasFile(certPath);
}

function hasIncompletePair(keyPath, certPath) {
  return hasFile(keyPath) !== hasFile(certPath);
}

function commandExists(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function useExistingRuntimeCertificates() {
  console.log('Using existing runtime HTTPS certificates: dev-key.pem / dev-cert.pem');
}

function generateTrustedMkcertCertificates() {
  console.log('Generating trusted local HTTPS certificates with mkcert...');
  runCommand('mkcert', [
    '-key-file',
    runtimeKeyPath,
    '-cert-file',
    runtimeCertPath,
    'localhost',
    '127.0.0.1',
    '::1',
  ]);
  console.log('Generated trusted HTTPS certificates: dev-key.pem / dev-cert.pem');
}

function generateSelfSignedCertificates() {
  console.log('Generating self-signed HTTPS certificates with OpenSSL...');

  // Use execFileSync so the same argument list works across shells and platforms.
  runCommand('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    runtimeKeyPath,
    '-out',
    runtimeCertPath,
    '-days',
    '365',
    '-nodes',
    '-subj',
    '/C=US/ST=State/L=City/O=Org/CN=localhost',
  ]);

  console.log('Generated self-signed HTTPS certificates: dev-key.pem / dev-cert.pem');
  console.log(
    'Warning: self-signed certificates may still be rejected by some mobile browsers. Prefer mkcert or npm run dev:scan for camera testing.'
  );
}

try {
  if (hasIncompletePair(runtimeKeyPath, runtimeCertPath)) {
    console.warn(
      'Incomplete runtime HTTPS certificate pair found. Regenerating dev-key.pem / dev-cert.pem.'
    );
  }

  if (hasPair(runtimeKeyPath, runtimeCertPath)) {
    useExistingRuntimeCertificates();
    process.exit(0);
  }

  if (commandExists('mkcert', ['-help'])) {
    generateTrustedMkcertCertificates();
    process.exit(0);
  }

  if (commandExists('openssl', ['version'])) {
    generateSelfSignedCertificates();
    process.exit(0);
  }

  throw new Error('Neither mkcert nor OpenSSL is available.');
} catch (error) {
  console.warn('Could not prepare HTTPS certificates.');
  console.warn(error?.message || error);

  console.log('\nRecommended fix:');
  console.log('1. Install mkcert and trust its local CA:');
  console.log('   mkcert -install');
  console.log('2. Generate runtime certs directly into the filenames the app uses:');
  console.log('   mkcert -key-file dev-key.pem -cert-file dev-cert.pem localhost 127.0.0.1 ::1');
  console.log('');
  console.log('Fallback: install OpenSSL to generate self-signed runtime certs automatically.');
  console.log('The app only reads dev-key.pem / dev-cert.pem at runtime.');

  process.exit(0);
}
