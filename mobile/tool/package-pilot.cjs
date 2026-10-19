'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.source-pilot-0.1.0');
const output = path.resolve(root, '../../outputs/mobile-0.1.0');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'No symlinks in public source');
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (/(?:^|\/)(?:build|\.gradle|\.dart_tool|Pods|\.symlinks|ephemeral|xcuserdata|qa-results)(?:\/|$)/.test(relative)) return [];
    if (/(?:^|\/)(?:local\.properties|Generated\.xcconfig|flutter_export_environment\.sh|\.flutter-plugins[^/]*|.*\.(?:jks|keystore|p12|pfx|pem|db|sqlite|sqlite3|log)|key\.properties|\.env(?:\..*)?)(?:\/|$)/i.test(relative)) return [];
    const location = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(location, relative) : [relative];
  });
}
const names = [
  '.gitattributes','.gitignore','.metadata','README.md','analysis_options.yaml','pubspec.yaml','pubspec.lock',
  ...['lib','test','tool','android','ios','web','.github'].flatMap(directory => walk(path.join(root,directory),directory)),
].sort();
assert.equal(new Set(names).size, names.length);
for (const name of names) {
  const source = path.join(root,name), target = path.join(stage,name);
  assert(fs.statSync(source).isFile());
  assert(!fs.lstatSync(source).isSymbolicLink());
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(source,target);
  assert.equal(hash(source),hash(target));
}
function rawStageFiles(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    assert(!entry.isSymbolicLink(), 'No symlinks in delivery stage');
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    return entry.isDirectory() ? rawStageFiles(path.join(dir,entry.name),relative) : [relative];
  });
}
assert.deepEqual(rawStageFiles(stage).sort(),names);
fs.mkdirSync(output,{recursive:true});
console.log(`Public source stage verified: ${names.length} files. SDKs, caches, local configuration, databases and private signing files excluded.`);
if (process.argv.includes('--stage-only')) process.exit(0);
const apkSource = path.join(root,'build/app/outputs/flutter-apk/app-debug.apk');
assert(fs.statSync(apkSource).size > 10000000);
const apkTarget = path.join(output,'FIBER-net-lb-Mobile-0.1.0-Android-arm64-test.apk');
fs.copyFileSync(apkSource,apkTarget);assert.equal(hash(apkSource),hash(apkTarget));
const captures = path.join(output,'screenshots');fs.mkdirSync(captures,{recursive:true});
for(const name of ['sign-in-390.png','admin-390.png','cashier-390.png','support-390.png','renewal-review-390.png','renewal-success-390.png','renewal-incomplete-390.png']) {
  const source = path.join(root,'qa-results/app',name);
  assert(fs.statSync(source).size > 1000, 'Missing actual Flutter capture: ' + name);
  const target=path.join(captures,name);fs.copyFileSync(source,target);assert.equal(hash(source),hash(target));
}
const temporaryCapture=path.join(root,'qa-results/ui/temporary-http-consent-390.png');
assert(fs.statSync(temporaryCapture).size > 1000, 'Missing synthetic temporary-connection consent capture');
const temporaryTarget=path.join(captures,'temporary-http-consent-390.png');
fs.copyFileSync(temporaryCapture,temporaryTarget);assert.equal(hash(temporaryCapture),hash(temporaryTarget));
console.log(`Android test APK delivery copy verified: ${fs.statSync(apkTarget).size} bytes, SHA256 ${hash(apkTarget)}. No store upload or installation performed.`);
