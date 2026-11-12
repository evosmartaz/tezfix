/**
 * Expo config plugin: on Windows, point the Android build at a CMake whose bundled ninja (>= 1.12) supports long
 * paths. The default CMake 3.22.1 ships ninja 1.10, which fails on React Native codegen object files deeper than
 * 260 characters (react-native-gesture-handler, react-native-screens) inside this monorepo.
 *
 * Writes `cmake.dir` (and `sdk.dir`) into android/local.properties after prebuild. Overrides:
 *   ANDROID_CMAKE_DIR  explicit CMake directory
 *   ANDROID_HOME / ANDROID_SDK_ROOT  SDK location (default %LOCALAPPDATA%\Android\Sdk)
 */
const fs = require('node:fs');
const path = require('node:path');

const MIN = [3, 30, 0];

function parseVersion(name) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(name);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Highest installed CMake 3.x that is at least 3.30 (CMake 4 drops policies older RN libraries still declare). */
function pickCmake(versionNames) {
  const candidates = versionNames
    .map((n) => ({ n, v: parseVersion(n) }))
    .filter((c) => c.v && c.v[0] === 3 && cmp(c.v, MIN) >= 0)
    .sort((a, b) => cmp(b.v, a.v));
  return candidates.length ? candidates[0].n : null;
}

function escapeProperty(value) {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

/** Returns local.properties text with the given keys set (other lines preserved). */
function setProperties(existing, values) {
  const lines = (existing || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const keys = Object.keys(values);
  const kept = lines.filter((l) => !keys.some((k) => l.startsWith(`${k}=`)));
  for (const k of keys) kept.push(`${k}=${escapeProperty(values[k])}`);
  return `${kept.join('\n')}\n`;
}

function sdkDir(env) {
  return env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(env.LOCALAPPDATA || '', 'Android', 'Sdk');
}

function resolveCmakeDir(env) {
  if (env.ANDROID_CMAKE_DIR) return env.ANDROID_CMAKE_DIR;
  const root = path.join(sdkDir(env), 'cmake');
  if (!fs.existsSync(root)) return null;
  const picked = pickCmake(fs.readdirSync(root));
  return picked ? path.join(root, picked) : null;
}

function withWindowsCmake(config) {
  // Lazy require: the helpers above stay testable without Expo's config-plugins on the path.
  const { withDangerousMod } = require('expo/config-plugins');
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      if (process.platform !== 'win32') return cfg;
      const cmake = resolveCmakeDir(process.env);
      if (!cmake) {
        console.warn('[with-windows-cmake] No CMake >= 3.30 found; install one with: sdkmanager "cmake;3.31.6"');
        return cfg;
      }
      const file = path.join(cfg.modRequest.platformProjectRoot, 'local.properties');
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      fs.writeFileSync(file, setProperties(existing, { 'sdk.dir': sdkDir(process.env), 'cmake.dir': cmake }));
      return cfg;
    },
  ]);
}

module.exports = withWindowsCmake;
module.exports.pickCmake = pickCmake;
module.exports.setProperties = setProperties;
module.exports.escapeProperty = escapeProperty;
