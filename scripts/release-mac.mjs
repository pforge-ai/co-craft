#!/usr/bin/env node
/**
 * Production macOS release pipeline for CoCraft:
 * 1. Auto-detects valid "Developer ID Application" identity in Keychain (or COCRAFT_SIGN_IDENTITY / CSC_NAME).
 * 2. Builds an unsigned CoCraft.app via electron-builder (~10s), then signs ONLY real Mach-O binaries
 *    and nested bundles (.dylib/.node -> helper executables -> .framework -> helper .app -> CoCraft.app)
 *    in strict inside-out order with Hardened Runtime, entitlements, secure timestamps, and automatic
 *    Apple TSA retry (~20s total instead of signing hundreds of non-Mach-O locale .pak files).
 * 3. Packages the verified CoCraft.app into CoCraft-<version>-arm64.dmg and signs the DMG.
 * 4. Submits the DMG to Apple Notarization via `xcrun notarytool` using the local Keychain profile
 *    (default: "cocraft-notary", override with COCRAFT_NOTARY_PROFILE) — zero secrets in repo.
 * 5. Staples the notarization ticket to both the DMG and .app and verifies via `spctl`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outDir = resolve(root, pkg.build?.directories?.output || 'release/0.6');
const appPath = join(outDir, 'mac-arm64', 'CoCraft.app');
const dmgPath = join(outDir, `CoCraft-${version}-arm64.dmg`);
const entitlements = resolve(root, 'build/entitlements.mac.plist');
const notaryProfile = process.env.COCRAFT_NOTARY_PROFILE || 'cocraft-notary';
const keychainPath = process.env.COCRAFT_KEYCHAIN_PATH || '';
const skipNotarize = process.env.COCRAFT_SKIP_NOTARIZE === '1';
const skipBuild = process.env.COCRAFT_SKIP_BUILD === '1';

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}`);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function codesignWithRetry(args, label) {
  const fullArgs = keychainPath ? ['--keychain', keychainPath, ...args] : args;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = spawnSync('codesign', fullArgs, { encoding: 'utf8', cwd: root });
    if (res.status === 0) return;
    const errText = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    const isTransient = /timestamp service is not available|timed out|connection|network/i.test(errText);
    if (isTransient && attempt < maxAttempts) {
      const waitMs = attempt * 2500;
      console.warn(`  [retry ${attempt}/${maxAttempts}] TSA transient error on ${label}, retrying in ${waitMs}ms...`);
      sleepSync(waitMs);
      continue;
    }
    throw new Error(`codesign failed for ${label}:\n${errText}`);
  }
}

function detectIdentity() {
  if (process.env.COCRAFT_SIGN_IDENTITY) return process.env.COCRAFT_SIGN_IDENTITY;
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  const securityArgs = ['find-identity', '-v', '-p', 'codesigning'];
  if (keychainPath) securityArgs.push(keychainPath);
  const out = execFileSync('security', securityArgs, { encoding: 'utf8' });
  const match = out.match(/"(Developer ID Application:[^"]+)"/);
  if (!match) {
    throw new Error(
      '未在钥匙串中找到有效的 "Developer ID Application" 签名证书。请先导入证书后重试。',
    );
  }
  return match[1];
}

function getFileType(filePath) {
  try {
    return execFileSync('file', ['-b', filePath], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function walkTree(dir, onFile, onDir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      onDir?.(full);
      walkTree(full, onFile, onDir);
    } else if (st.isFile()) {
      onFile?.(full);
    }
  }
}

const identity = detectIdentity();
console.log(`Using signing identity: ${identity}`);
console.log(`Notarization keychain profile: ${notaryProfile}${skipNotarize ? ' (SKIPPED)' : ''}`);

// 1. Build app bundles + unsigned CoCraft.app (fast ~10s; we do precise inside-out signing next)
const noAutoSignEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
if (!skipBuild) {
  run('npm', ['run', 'build']);
  run(
    'npx',
    ['electron-builder', '--mac', 'dir', '--arm64', '-c.mac.identity=null'],
    { env: noAutoSignEnv },
  );
}

// 2. Discover every real Mach-O binary and nested .framework / .app bundle inside CoCraft.app
const nestedFrameworks = [];
const nestedApps = [];
const machOs = [];

walkTree(
  appPath,
  (file) => {
    const kind = getFileType(file);
    if (/Mach-O/.test(kind)) {
      machOs.push({ file, kind, rel: relative(appPath, file) });
    }
  },
  (dir) => {
    if (dir.endsWith('.framework')) nestedFrameworks.push(dir);
    else if (dir.endsWith('.app')) nestedApps.push(dir);
  },
);

// Exclude main binaries of .framework / .app bundles from standalone file pass because signing
// the enclosing bundle signs its main binary AND seals its CodeResources.
const bundleMainBinaries = new Set([
  join(appPath, 'Contents/MacOS/CoCraft'),
  ...nestedApps.map((a) => {
    const name = a.split('/').pop().replace(/\.app$/, '');
    return join(a, 'Contents/MacOS', name);
  }),
  ...nestedFrameworks.map((f) => {
    const name = f.split('/').pop().replace(/\.framework$/, '');
    return join(f, 'Versions/A', name);
  }),
]);

const standaloneMachOs = machOs.filter((m) => !bundleMainBinaries.has(m.file));
// Sign shared libraries / .node bundles first, then standalone executables (deepest path first)
standaloneMachOs.sort((a, b) => {
  const isExecA = /executable/i.test(a.kind) ? 1 : 0;
  const isExecB = /executable/i.test(b.kind) ? 1 : 0;
  if (isExecA !== isExecB) return isExecA - isExecB;
  return b.rel.split('/').length - a.rel.split('/').length;
});

console.log(
  `\nSigning ${standaloneMachOs.length} Mach-O binaries + ${nestedFrameworks.length} frameworks + ${nestedApps.length} helper apps + CoCraft.app (inside-out)...`,
);

// 2a. Standalone Mach-O libraries & executables (media-tools, app.asar.unpacked, framework helpers/dylibs)
for (const { file, kind, rel } of standaloneMachOs) {
  const isExec = /executable/i.test(kind);
  const args = isExec
    ? ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', entitlements, file]
    : ['--force', '--sign', identity, '--timestamp', file];
  console.log(`  sign ${isExec ? 'exec ' : 'lib  '} ${rel}`);
  codesignWithRetry(args, rel);
}

// 2b. Nested frameworks (deepest first)
nestedFrameworks.sort((a, b) => b.length - a.length);
for (const fw of nestedFrameworks) {
  const rel = relative(appPath, fw);
  console.log(`  sign fw    ${rel}`);
  codesignWithRetry(['--force', '--sign', identity, '--timestamp', fw], rel);
}

// 2c. Nested helper .app bundles (deepest first)
nestedApps.sort((a, b) => b.length - a.length);
for (const helper of nestedApps) {
  const rel = relative(appPath, helper);
  console.log(`  sign app   ${rel}`);
  codesignWithRetry(
    ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', entitlements, helper],
    rel,
  );
}

// 2d. Outer CoCraft.app bundle
console.log('  sign app   CoCraft.app');
codesignWithRetry(
  ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', entitlements, appPath],
  'CoCraft.app',
);

// Verify strict deep seal before packaging DMG
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

// 3. Build DMG from the signed & verified CoCraft.app (without re-signing .app) and sign the DMG itself
// Retry once on transient macOS hdiutil "Resource busy" locks common on CI runners.
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    run(
      'npx',
      ['electron-builder', '--mac', 'dmg', '--arm64', '--prepackaged', appPath, '-c.mac.identity=null'],
      { env: noAutoSignEnv },
    );
    break;
  } catch (err) {
    if (attempt === 2) throw err;
    console.warn('DMG creation failed on attempt 1 (possibly hdiutil busy), retrying in 5s...');
    sleepSync(5000);
  }
}
console.log('\nSigning DMG...');
codesignWithRetry(['--force', '--sign', identity, '--timestamp', dmgPath], dmgPath);
run('codesign', ['--verify', '--verbose=2', dmgPath]);

// 4. Submit DMG to Apple Notarization Service & wait for result
if (!skipNotarize) {
  console.log('\nSubmitting DMG to Apple Notarization Service (typically 1–4 minutes)...');
  const submitArgs = [
    'notarytool',
    'submit',
    dmgPath,
    '--keychain-profile',
    notaryProfile,
    ...(keychainPath ? ['--keychain', keychainPath] : []),
    '--wait',
    '--output-format',
    'json',
  ];
  const notaryRes = spawnSync('xcrun', submitArgs, { encoding: 'utf8', cwd: root });
  console.log(notaryRes.stdout || '');
  if (notaryRes.stderr) console.error(notaryRes.stderr);

  let parsed = null;
  try {
    parsed = JSON.parse((notaryRes.stdout || '').trim());
  } catch {}

  if (notaryRes.status !== 0 || parsed?.status !== 'Accepted') {
    if (parsed?.id) {
      console.error(`\nNotarization failed (id=${parsed.id}). Fetching detailed Apple log...`);
      const logArgs = [
        'notarytool',
        'log',
        parsed.id,
        '--keychain-profile',
        notaryProfile,
        ...(keychainPath ? ['--keychain', keychainPath] : []),
      ];
      spawnSync('xcrun', logArgs, { stdio: 'inherit' });
    }
    throw new Error(`Apple Notarization did not succeed (status=${parsed?.status || notaryRes.status})`);
  }

  // 5. Staple notarization ticket to BOTH DMG and .app
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
  run('xcrun', ['stapler', 'staple', appPath]);
  run('xcrun', ['stapler', 'validate', appPath]);

  // 6. Verify real macOS Gatekeeper acceptance!
  run('spctl', ['-a', '-t', 'exec', '-vvv', appPath]);
  run('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vvv', dmgPath]);
}

console.log(
  `\n✅ ${skipNotarize ? 'Signed release ready (notarization skipped)' : 'Signed & Notarized release ready'}: ${dmgPath}`,
);
