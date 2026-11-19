/** Localhost TLS helper shared by web-card build and browser tests. */

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Create a short-lived localhost certificate trusted by the Hugo process. @param {string} directory - Managed fixture directory. @returns {Promise<{key: string, cert: string, certFile: string}>} PEM contents and CA file path. */
export async function createLocalCertificate(directory) {
  await mkdir(directory, { recursive: true });
  const keyFile = path.join(directory, 'localhost-key.pem');
  const certFile = path.join(directory, 'localhost.pem');
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyFile,
    '-out',
    certFile,
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost',
  ]);
  return {
    key: await readFile(keyFile, 'utf8'),
    cert: await readFile(certFile, 'utf8'),
    certFile,
  };
}
