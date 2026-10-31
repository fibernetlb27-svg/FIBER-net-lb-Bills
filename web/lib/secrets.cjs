'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');

const HEADER = Buffer.from('FIBERWEB-SECRET-1\0');

// This is the server equivalent of Electron's safeStorage interface. The key
// belongs in a separate, read-only secret mount, never in the database/export.
function createSecretStorage(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw Error('A 32-byte server encryption key is required.');
  const key = Buffer.from(value);
  let available = true;
  function ready() { if (!available) throw Error('Server credential storage is closed.'); }
  return Object.freeze({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'server_aes_256_gcm',
    encryptString(text) {
      ready();
      if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error('The credential is invalid or too long.');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(HEADER);
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([HEADER, iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      ready();
      if (!Buffer.isBuffer(bytes) || bytes.length < HEADER.length + 28 || bytes.length > 65664 || !bytes.subarray(0, HEADER.length).equals(HEADER)) {
        throw Error('This credential is not a server-encrypted value. Re-enter Windows credentials securely on the server.');
      }
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(HEADER.length, HEADER.length + 12));
        decipher.setAAD(HEADER);
        decipher.setAuthTag(bytes.subarray(HEADER.length + 12, HEADER.length + 28));
        return Buffer.concat([decipher.update(bytes.subarray(HEADER.length + 28)), decipher.final()]).toString('utf8');
      } catch { throw Error('The server credential could not be unlocked. Check the separate encryption key or re-enter the credential.'); }
    },
    destroy() { key.fill(0); available = false; }
  });
}

function loadSecretStorage(file) {
  if (typeof file !== 'string' || !file) throw Error('SECRETS_KEY_FILE must name the separate server encryption key.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32) throw Error('The server encryption key must be a regular 32-byte file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('The server encryption key must have owner-only permissions.');
  const bytes = fs.readFileSync(file);
  try { return createSecretStorage(bytes); } finally { bytes.fill(0); }
}

module.exports = {createSecretStorage, loadSecretStorage};
