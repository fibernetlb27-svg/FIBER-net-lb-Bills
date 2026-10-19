'use strict';
// Read-only source checks plus the actual PowerShell endpoint validator tested
// against synthetic TEST-NET addresses. Optional --apk inspection uses aapt;
// neither mode starts an app, contacts a server, builds or accepts SDK licenses.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const child = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
function readXmlSource() {
  const main = read('android/app/src/main/AndroidManifest.xml');
  const debug = read('android/app/src/debug/AndroidManifest.xml');
  const profile = read('android/app/src/profile/AndroidManifest.xml');
  const gradle = read('android/app/build.gradle.kts');
  const build = read('tool/build-android.ps1');
  check(/android:usesCleartextTraffic="false"/.test(main), 'Main/release must forbid global cleartext.');
  check(/android:allowBackup="false"/.test(main), 'Main must disable Android backups of application data.');
  check(!main.includes('networkSecurityConfig'), 'Main/release must not reference the temporary debug policy.');
  check(!profile.includes('networkSecurityConfig') && !/usesCleartextTraffic="true"/.test(profile), 'Profile must not inherit the debug HTTP exception.');
  check(/android:networkSecurityConfig="@xml\/mobile_test_network_security"/.test(debug), 'Debug manifest must name the generated policy.');
  check(!/usesCleartextTraffic="true"/.test(debug), 'Debug must not broadly opt every host into HTTP.');
  check(/layout\.buildDirectory\.dir\("generated\/mobile-network-security\/res"\)/.test(gradle), 'Network policy must be generated under build, not checked into source.');
  check(/sourceSets\.getByName\("debug"\)\.res\.srcDir\(temporaryNetworkRes\.get\(\)\.asFile\)/.test(gradle), 'Generated policy must be added only to debug resources through an AGP-9 compatible directory.');
  check(!/sourceSets\.getByName\("(?:main|release|profile)"\).*temporaryNetworkRes/.test(gradle), 'Release/profile must never consume the debug resources.');
  check(/it\.name == "preDebugBuild"[\s\S]*?dependsOn\(generateTemporaryNetworkPolicy\)/.test(gradle), 'Debug resource generation must be an explicit build prerequisite.');
  check(/inputs\.property\("temporaryHttpHost", temporaryHttpHost\)/.test(gradle), 'Host changes/clearing must invalidate the generated policy task.');
  check(/hostRule = if \(temporaryHttpHost\.isEmpty\(\)\) "" else/.test(gradle), 'An unconfigured debug build must have no host exception.');
  check(gradle.includes('<base-config cleartextTrafficPermitted="false"/>'), 'Generated policy must deny every other native destination.');
  check(gradle.includes('<domain-config cleartextTrafficPermitted=\\"true\\">') && gradle.includes('includeSubdomains=\\"false\\"'), 'The only exception must be a single exact domain, with no subdomains.');
  check(gradle.includes('it.toInt() in 0..255') && gradle.includes('it.toInt().toString() == it'), 'Native build host must be a canonical dotted IPv4 address.');
  check(!/trust-anchors|debug-overrides|certificates\s+src=/.test(gradle), 'Do not add trust anchors or certificate-validation exceptions.');
  check(build.includes("'--debug'") && build.includes("'android-arm64'"), 'Pilot build script must explicitly build debug ARM64 only.');
  check(build.includes('$env:ORG_GRADLE_PROJECT_temporaryHttpHost = $temporaryServer.Host'), 'Native policy must use only the locally validated host.');
  check(build.includes('--dart-define=TEMPORARY_HTTP_ENDPOINT='), 'Dart must receive the same exact approved endpoint.');
  check(build.includes('--android-project-arg=temporaryHttpHost=$($temporaryServer.Host)') && build.includes("'--android-project-arg=temporaryHttpHost='"), 'Each build must pass an explicit current host or empty override, independent of daemon environment caching.');
  check(build.includes('Remove-Item Env:ORG_GRADLE_PROJECT_temporaryHttpHost'), 'A build without a temporary endpoint must clear an inherited host override.');
  for (const name of ['lib/core/api_client.dart', 'lib/main.dart']) {
    const source = read(name);
    check(!/badCertificateCallback|HttpOverrides\.global|allowBadCertificates/.test(source), 'No certificate bypass may be introduced in ' + name + '.');
  }
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);
  for (const file of walk(path.join(root, 'android/app/src'))) {
    if (!file.endsWith('.xml')) continue;
    check(!fs.readFileSync(file, 'utf8').includes('<network-security-config>'), 'No generated host policy may be committed to Android source.');
  }
  return { gradle, build };
}

function checkActualBuildValidator(build) {
  const start = build.indexOf('  $temporaryEndpointMatch =');
  const end = build.indexOf('  $env:ORG_GRADLE_PROJECT_temporaryHttpHost', start);
  check(start >= 0 && end > start, 'Could not isolate the build script endpoint validator.');
  const validation = build.slice(start, end);
  // Fail closed if unrelated commands are added to this extracted read-only block.
  check(!/\$env:|Invoke-|Start-Process|Set-Content|Out-File|Remove-Item|&\s/.test(validation), 'Endpoint validation block must not perform external actions.');
  const cases = [
    ['http://192.0.2.44:3210', true],
    ['http://198.51.100.27:8080/', true],
    ['http://203.0.113.45:65535', true],
    ['https://203.0.113.45:3210', false],
    ['http://203.0.113.45', false],
    ['http://203.0.113.45:80', false],
    ['http://203.0.113.45:0', false],
    ['http://203.0.113.45:65536', false],
    ['http://203.0.113.45:03210', false],
    ['http://203.000.113.45:3210', false],
    ['http://256.0.113.45:3210', false],
    ['http://203.0.113:3210', false],
    ['http://0xcb00712d:3210', false],
    ['http://203.0.113.45:3210/api', false],
    ['http://203.0.113.45:3210/?key=synthetic', false],
    ['http://203.0.113.45:3210/#synthetic', false],
    ['http://synthetic:password@203.0.113.45:3210', false],
    ['http://example.invalid:3210', false],
    ['http://*.example.invalid:3210', false],
    ['http://[2001:db8::1]:3210', false],
    ['http://203.0.113.45:3210/path/..', false],
    ['http://203.0.113.45:3210/%2f', false],
    [' http://203.0.113.45:3210', false],
    ['http://203.0.113.45:3210 ', false],
  ];
  const encoded = Buffer.from(JSON.stringify(cases), 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'\nfunction Test-LocalEndpoint([string]$TemporaryHttpEndpoint){\ntry{\n${validation}\nreturn $true\n}catch{return $false}\n}\n$cases=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json\n$actual=@(foreach($case in $cases){Test-LocalEndpoint ([string]$case[0])})\nConvertTo-Json -Compress -InputObject $actual\n`;
  const result = child.execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  const actual = JSON.parse(result.trim());
  check(Array.isArray(actual) && actual.length === cases.length, 'Validator did not return every synthetic test result.');
  for (let i = 0; i < cases.length; i++) check(actual[i] === cases[i][1], 'Build script endpoint boundary case ' + (i + 1) + ' failed.');
  return cases.length;
}

function archiveEntries(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  check(eocd >= 0, 'APK is not a valid ZIP archive.');
  const count = buffer.readUInt16LE(eocd + 10), names = [];
  check(count < 65535, 'ZIP64 APK inspection is not supported by this small verifier.');
  let position = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    check(position + 46 <= buffer.length && buffer.readUInt32LE(position) === 0x02014b50, 'APK central directory is malformed.');
    const length = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + length).toString('utf8');
    check(!name.includes('\0') && !name.includes('\\') && !name.startsWith('/') && !name.split('/').includes('..'), 'APK contains an unsafe path.');
    names.push(name); position += 46 + length + extra + comment;
  }
  check(new Set(names).size === names.length, 'APK contains duplicate entries.');
  return names;
}
function inspectApk(apk, expectedHost = '') {
  if (expectedHost) check(/^(?:(?:0|[1-9][0-9]{0,2})\.){3}(?:0|[1-9][0-9]{0,2})$/.test(expectedHost) && expectedHost.split('.').every(p => Number(p) <= 255), 'Expected APK exception must be a canonical IPv4 host.');
  const names = archiveEntries(fs.readFileSync(apk));
  const native = names.filter(name => /^lib\/[^/]+\/[^/]+\.so$/.test(name));
  check(native.length > 0 && native.every(name => name.startsWith('lib/arm64-v8a/')), 'Pilot APK must contain only ARM64 native libraries.');
  check(!names.some(name => /\.(sqlite|sqlite3|db|fnbak|jks|keystore|p12|pem|env)$/i.test(name)), 'APK must contain no databases, backups or private key files.');
  const aapt = path.resolve(root, '../mobile-sdk/android/build-tools/36.0.0/aapt.exe');
  const dump = (...args) => child.execFileSync(aapt, ['dump', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const badging = dump('badging', apk), manifest = dump('xmltree', apk, 'AndroidManifest.xml');
  check(badging.includes("package: name='net.fibernetlb.bills.mobile'"), 'Unexpected Android application identifier.');
  check(/sdkVersion:'24'/.test(badging) && /targetSdkVersion:'36'/.test(badging), 'Unexpected Android minimum/target API.');
  check(/android:usesCleartextTraffic[^\n]*0x0\b/.test(manifest), 'APK manifest must not globally allow cleartext.');
  check(/android:allowBackup[^\n]*0x0\b/.test(manifest), 'APK must disable application backups.');
  check(/android:debuggable[^\n]*0xffffffff\b/.test(manifest), 'This inspection expects an honestly debug-marked pilot APK.');
  check(manifest.includes('android:networkSecurityConfig'), 'Debug APK must reference its generated network policy.');
  const policies = names.filter(name => /(?:^|\/)mobile_test_network_security\.xml$/.test(name));
  check(policies.length === 1, 'Expected exactly one generated pilot network policy.');
  const policy = dump('xmltree', apk, policies[0]);
  const blocks = policy.split(/\n(?=\s*E: )/).filter(block => /E: (?:base-config|domain-config)\b/.test(block));
  check(blocks.some(block => /E: base-config\b/.test(block) && /cleartextTrafficPermitted[^\n]*0x0\b/.test(block)), 'APK policy must deny other native destinations.');
  const domainBlocks = blocks.filter(block => /E: domain-config\b/.test(block));
  check(domainBlocks.length === (expectedHost ? 1 : 0), 'APK has an unexpected number of native HTTP exceptions.');
  if (expectedHost) {
    check(/cleartextTrafficPermitted[^\n]*0xffffffff\b/.test(domainBlocks[0]), 'Configured domain exception is not active in the APK.');
    check(/includeSubdomains[^\n]*0x0\b/.test(policy), 'APK domain exception must not include subdomains.');
    const text = [...policy.matchAll(/\bC:\s+"([^"]+)"/g)].map(match => match[1]);
    check(text.length === 1 && text[0] === expectedHost, 'APK domain exception does not match the approved exact host.');
  }
  check(!/trust-anchors|debug-overrides|certificates\b/.test(policy), 'APK policy must not weaken certificate trust.');
  return { nativeAbi: 'arm64-v8a', nativeLibraryCount: native.length, temporaryHostExceptions: domainBlocks.length, exactHostMatched: Boolean(expectedHost), minSdk: 24, targetSdk: 36, debugPilot: true, privateFilesFound: false };
}

try {
  const source = readXmlSource();
  const syntheticEndpointCases = checkActualBuildValidator(source.build);
  const apk = process.argv.find(arg => arg.startsWith('--apk='))?.slice(6);
  const expectedHost = process.argv.find(arg => arg.startsWith('--allow-host='))?.slice(13) || '';
  const binary = apk ? inspectApk(path.resolve(apk), expectedHost) : null;
  console.log(JSON.stringify({ passed: true, checks, syntheticEndpointCases, nativePolicy: 'Debug only; exact host; other native hosts denied. Core exact origin/port checks remain mandatory for Dart sockets.', apk: binary }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
