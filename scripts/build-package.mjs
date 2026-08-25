#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ROOT = path.join(ROOT, 'release');
const target = process.argv[2] || 'all';
const validTargets = new Set(['web', 'apk', 'exe', 'all']);

if (!validTargets.has(target)) {
  console.error(`Unknown target "${target}". Use web, apk, exe, or all.`);
  process.exit(2);
}

const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const artifactBase = `Othello3D-${packageJson.version}`;

function run(label, command, args, options = {}) {
  console.log(`\n[package] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
      shell: options.shell || false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function buildWeb() {
  await run(
    'Building offline web bundle',
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    { env: { DSH_DEPLOY: 'package' } }
  );
}

function androidSdkRoot() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function androidJavaHome() {
  const candidates = [process.env.DSH_JAVA_HOME, process.env.JAVA_HOME].filter(Boolean);
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    const microsoftRoot = path.join(process.env.ProgramFiles, 'Microsoft');
    if (existsSync(microsoftRoot)) {
      const entries = await readdir(microsoftRoot, { withFileTypes: true });
      candidates.unshift(
        ...entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('jdk-21'))
          .map((entry) => path.join(microsoftRoot, entry.name))
          .sort()
          .reverse()
      );
    }
  }
  for (const candidate of candidates) {
    const releaseFile = path.join(candidate, 'release');
    const javaExecutable = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (!existsSync(releaseFile) || !existsSync(javaExecutable)) continue;
    const release = await readFile(releaseFile, 'utf8');
    const major = Number(release.match(/JAVA_VERSION="(\d+)/)?.[1] || 0);
    if (major >= 21) return candidate;
  }
  throw new Error('JDK 21 is required. Install Microsoft.OpenJDK.21 or set DSH_JAVA_HOME.');
}

async function cachedGradleForWindows(androidRoot) {
  if (process.platform !== 'win32' || !process.env.USERPROFILE) return null;
  const properties = await readFile(
    path.join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    'utf8'
  );
  const version = properties.match(/gradle-([\d.]+)-(?:bin|all)\.zip/)?.[1];
  if (!version) return null;
  const distRoot = path.join(
    process.env.GRADLE_USER_HOME || path.join(process.env.USERPROFILE, '.gradle'),
    'wrapper',
    'dists',
    `gradle-${version}-bin`
  );
  if (!existsSync(distRoot)) return null;
  for (const entry of await readdir(distRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const installRoot = path.join(distRoot, entry.name);
    const executable = path.join(installRoot, `gradle-${version}`, 'bin', 'gradle.bat');
    const verifiedMarker = path.join(installRoot, `gradle-${version}-bin.zip.ok`);
    if (existsSync(executable) && existsSync(verifiedMarker)) return executable;
  }
  return null;
}

async function buildApk() {
  const sdkRoot = androidSdkRoot();
  if (!sdkRoot) {
    throw new Error('Android SDK not found. Run "npm run setup:android" first.');
  }
  const javaHome = await androidJavaHome();

  const androidRoot = path.join(ROOT, 'android');
  const gradleWrapper = path.join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(gradleWrapper)) {
    throw new Error('Android project is missing. Run "npx cap add android" once.');
  }

  await writeFile(
    path.join(androidRoot, 'local.properties'),
    `sdk.dir=${sdkRoot.replaceAll('\\', '/')}\n`,
    'utf8'
  );
  await run(
    'Syncing Capacitor Android project',
    process.execPath,
    [path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'],
    { env: { ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot } }
  );
  const cachedGradle = await cachedGradleForWindows(androidRoot);
  const gradleCommand = cachedGradle
    ? (process.env.ComSpec || 'cmd.exe')
    : process.platform === 'win32'
      ? path.join(javaHome, 'bin', 'java.exe')
      : gradleWrapper;
  const gradleArgs = cachedGradle
    ? ['/d', '/c', 'call', cachedGradle, 'assembleDebug', '--no-daemon']
    : process.platform === 'win32'
      ? [
        '-classpath',
        path.join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
        'org.gradle.wrapper.GradleWrapperMain',
        'assembleDebug',
        '--no-daemon',
      ]
      : ['assembleDebug', '--no-daemon'];
  await run('Building installable Android APK', gradleCommand, gradleArgs, {
    cwd: androidRoot,
    env: {
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
      JAVA_HOME: javaHome,
      PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
      DSH_APP_VERSION: packageJson.version,
    },
  });

  const source = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const outputDir = path.join(RELEASE_ROOT, 'android');
  const output = path.join(outputDir, `${artifactBase}-android-debug.apk`);
  await mkdir(outputDir, { recursive: true });
  await copyFile(source, output);
  console.log(`[package] APK: ${output}`);
}

async function buildExe() {
  const electronExecutable = path.join(
    ROOT,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
  );
  const mirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  if (!existsSync(electronExecutable)) {
    await run(
      'Downloading Electron runtime',
      process.execPath,
      [path.join(ROOT, 'node_modules', 'electron', 'install.js')],
      { env: { ELECTRON_MIRROR: mirror } }
    );
  }
  await run(
    'Building portable Windows executable',
    process.execPath,
    [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'portable', '--x64'],
    {
      env: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        ELECTRON_MIRROR: mirror,
        ELECTRON_BUILDER_BINARIES_MIRROR:
          process.env.ELECTRON_BUILDER_BINARIES_MIRROR
          || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
      },
    }
  );
}

async function artifactFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== 'win-unpacked') {
      result.push(...(await artifactFiles(fullPath)));
    } else if (/\.(apk|exe)$/i.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

async function writeChecksums() {
  const files = await artifactFiles(RELEASE_ROOT);
  if (!files.length) return;
  const lines = [];
  for (const file of files.sort()) {
    const hash = createHash('sha256').update(await readFile(file)).digest('hex');
    lines.push(`${hash}  ${path.relative(RELEASE_ROOT, file).replaceAll('\\', '/')}`);
  }
  await writeFile(path.join(RELEASE_ROOT, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`[package] Checksums: ${path.join(RELEASE_ROOT, 'SHA256SUMS.txt')}`);
}

try {
  await buildWeb();
  if (target === 'apk' || target === 'all') await buildApk();
  if (target === 'exe' || target === 'all') await buildExe();
  if (target !== 'web') await writeChecksums();
} catch (error) {
  console.error(`\n[package] ${error.message}`);
  process.exit(1);
}
