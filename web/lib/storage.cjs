'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DATABASES = Object.freeze(['isp-desk.sqlite', ...['fiber-users', 'fiber-resellers', 'iptv', 'printer', 'studio', 'mobile-ogero'].map(id => `sections/${id}.sqlite`)]);

function assertCompleteDataDirectory(directory) {
  if (!directory || !path.isAbsolute(directory)) throw Error('DATA_DIRECTORY must be an explicit absolute private directory.');
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('The private data directory must be an existing regular directory.');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('The private data directory must have owner-only permissions.');
  const section = fs.lstatSync(path.join(directory, 'sections'));
  if (!section.isDirectory() || section.isSymbolicLink()) throw Error('All seven existing business databases are required. No empty database was created.');
  for (const name of DATABASES) {
    let file;
    try { file = fs.lstatSync(path.join(directory, name)); } catch { throw Error('All seven existing business databases are required. No empty database was created.'); }
    if (!file.isFile() || file.isSymbolicLink() || file.size < 100) throw Error('All seven existing business databases must be regular, nonempty files.');
    if (process.platform !== 'win32' && (file.mode & 0o077)) throw Error('Business database files must have owner-only permissions.');
  }
  return path.resolve(directory);
}

// createBackend owns the exclusive .fibernetlb-web.lock for every entry point.
module.exports = {DATABASES, assertCompleteDataDirectory};
