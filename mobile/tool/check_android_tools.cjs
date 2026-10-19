'use strict';
// Read-only archive verification. Does not run SDK tools or accept any license.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const directory = path.resolve(__dirname, '..', '..', 'mobile-sdk', 'android');
const name = 'commandlinetools-win-15859902_latest.zip';
const expected = {
  bytes: 155655386,
  sha256: '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
  sha1: 'b9862337a13e2809a5159dc3a08d058091bd59f6',
};
async function main() {
  const archive = path.join(directory, name);
  const stat = fs.statSync(archive);
  assert.equal(stat.size, expected.bytes, 'Download is incomplete or archive size differs from official Google package metadata.');
  const sha256 = crypto.createHash('sha256'), sha1 = crypto.createHash('sha1');
  for await (const data of fs.createReadStream(archive)) { sha256.update(data); sha1.update(data); }
  const digests = { sha256: sha256.digest('hex'), sha1: sha1.digest('hex') };
  assert.equal(digests.sha256, expected.sha256, 'Archive differs from official Android download-page SHA-256.');
  assert.equal(digests.sha1, expected.sha1, 'Archive differs from Google repository2-1.xml SHA-1.');
  const xml = fs.readFileSync(path.join(directory, 'repository2-1.xml'), 'utf8');
  const entry = xml.match(/<remotePackage\b[^>]*path="cmdline-tools;22\.0"[^>]*>[\s\S]*?<\/remotePackage>/)?.[0];
  assert(entry && entry.includes(name) && entry.includes(String(expected.bytes)) && entry.includes(expected.sha1), 'Local official metadata does not confirm the selected Windows archive.');
  console.log(JSON.stringify({ verified: true, source: 'Official developer.android.com/studio and dl.google.com/android/repository/repository2-1.xml', name, bytes: stat.size, ...digests, sdkToolsExecuted: false, licensesAcceptedByThisCheck: false }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
