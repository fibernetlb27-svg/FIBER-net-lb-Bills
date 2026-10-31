'use strict';
// Operator-only verification/extraction. This tool never opens a backend,
// contacts a provider, replaces a database or removes an existing directory.
const fs = require('node:fs');
const path = require('node:path');
const {openBackup, sha256} = require('../app/backup-archive.cjs');

async function extractVerifiedBackup({archive, destination, passphrase, wasmPath}) {
  if (!path.isAbsolute(archive || '') || !path.isAbsolute(destination || '')) throw Error('Use explicit absolute archive and new destination paths.');
  const source = fs.lstatSync(archive);
  if (!source.isFile() || source.isSymbolicLink() || source.size > 361 * 1024 * 1024) throw Error('Choose a regular supported encrypted backup file.');
  if (fs.existsSync(destination)) throw Error('The destination already exists. Choose a NEW private extraction directory.');
  const parent = fs.lstatSync(path.dirname(destination));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error('The new destination needs an existing private parent directory.');
  if (process.platform !== 'win32' && (parent.mode & 0o077)) throw Error('The destination parent must have owner-only permissions.');
  const backup = await openBackup(fs.readFileSync(archive), passphrase);
  const SQL = await require('sql.js')({locateFile: () => wasmPath || require.resolve('sql.js/dist/sql-wasm.wasm')});
  for (const entry of backup.entries.filter(entry => entry.name.endsWith('.sqlite'))) {
    let db;
    try { db = new SQL.Database(entry.data); if (db.exec('PRAGMA quick_check')[0]?.values?.[0]?.[0] !== 'ok') throw Error('Database integrity check failed.'); }
    catch { throw Error('A backup database did not pass its integrity check. Nothing was extracted.'); }
    finally { db?.close(); }
  }
  fs.mkdirSync(destination, {mode: 0o700});
  for (const entry of backup.entries) {
    const file = path.join(destination, entry.name);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    fs.writeFileSync(file, entry.data, {flag: 'wx', mode: 0o600});
    if (sha256(fs.readFileSync(file)) !== sha256(entry.data)) throw Error('An extracted file could not be verified. The new folder is incomplete; no live files were replaced.');
  }
  const result = {format: 'FIBERNETLB-EXTRACTION-1', version: backup.version, createdAt: backup.createdAt, verifiedAt: new Date().toISOString(), files: backup.entries.map(entry => ({name: entry.name, size: entry.data.length, sha256: sha256(entry.data)})), warning: 'Extraction only. No active database was replaced. Windows-encrypted provider settings require secure re-entry. Provider transactions are never undone by restoring a local database.'};
  fs.writeFileSync(path.join(destination, 'backup-verification.json'), JSON.stringify(result, null, 2), {flag: 'wx', mode: 0o600});
  return result;
}

async function readPassphrase(fromStdin) {
  if (fromStdin) {
    let value = '';
    for await (const chunk of process.stdin) { value += chunk.toString('utf8'); if (value.length > 1024) throw Error('The backup passphrase is too long.'); }
    return value.replace(/\r?\n$/, '');
  }
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw Error('Run in an interactive terminal, or provide protected input with --passphrase-stdin.');
  process.stderr.write('Backup passphrase (hidden): ');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    function finish(error) { process.stdin.removeListener('data', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n'); error ? reject(error) : resolve(value); }
    function input(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003' || char === '\u0004') return finish(Error('Backup verification cancelled.'));
        if (char === '\b' || char === '\u007f') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
        if (value.length > 256) return finish(Error('The backup passphrase is too long.'));
      }
    }
    process.stdin.on('data', input);
  });
}

async function main(args) {
  process.umask(0o077);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--passphrase-stdin') values.stdin = true;
    else if (['--archive', '--destination'].includes(args[i]) && args[i + 1]) values[args[i].slice(2)] = args[++i];
    else throw Error('Use --archive ABSOLUTE_FILE --destination NEW_ABSOLUTE_DIRECTORY [--passphrase-stdin].');
  }
  if (!values.archive || !values.destination) throw Error('Use --archive ABSOLUTE_FILE --destination NEW_ABSOLUTE_DIRECTORY [--passphrase-stdin].');
  const passphrase = await readPassphrase(values.stdin);
  const result = await extractVerifiedBackup({archive: values.archive, destination: values.destination, passphrase});
  process.stdout.write(`Verified and extracted ${result.files.length} files to a NEW folder. No live files were replaced.\n`);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.code ? 'Backup verification could not access its private input/output files.' : error.message}\n`); process.exitCode = 1; });
module.exports = {extractVerifiedBackup};
