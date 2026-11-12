/**
 * Expo config plugin: sign release builds with the company release key, never with the template debug key (BUG-003).
 *
 * The Expo SDK 58 template signs `release` with `signingConfigs.debug` (the public React Native debug.keystore,
 * SHA-1 5E:8F:16:06:...:F6:25). Google Maps rejects that certificate for our API key, and anyone holding the public
 * debug key could ship an "update" over our app. This plugin rewrites android/app/build.gradle after prebuild:
 *
 *   - adds `signingConfigs.release`, filled at Gradle time from Gradle properties or environment variables:
 *       TEZFIKS_RELEASE_STORE_FILE      path to the release keystore (kept outside the repo)
 *       TEZFIKS_RELEASE_STORE_PASSWORD  keystore password
 *       TEZFIKS_RELEASE_KEY_ALIAS       key alias
 *       TEZFIKS_RELEASE_KEY_PASSWORD    key password
 *     (a Gradle property, e.g. in ~/.gradle/gradle.properties, wins over the environment variable);
 *   - points `buildTypes.release` at it;
 *   - fails any release task (assemble/bundle/package/install ...Release) when the four values are missing or the
 *     keystore file does not exist, instead of silently producing a debug-signed or unsigned APK.
 *
 * Debug builds keep the template debug key, so local development and `expo run:android` are unchanged.
 * No secret is ever written into the generated files: build.gradle only contains the names of the variables.
 */
const SIGNING_VARS = [
  'TEZFIKS_RELEASE_STORE_FILE',
  'TEZFIKS_RELEASE_STORE_PASSWORD',
  'TEZFIKS_RELEASE_KEY_ALIAS',
  'TEZFIKS_RELEASE_KEY_PASSWORD',
];

const MARKER = '// @tezfiks/release-signing';

const HELPER_BLOCK = [
  `${MARKER}: release signing values come from Gradle properties or environment variables, never from this file.`,
  'def tezfiksSigningValue = { String name -> (findProperty(name) ?: System.getenv(name))?.toString()?.trim() ?: null }',
  `def tezfiksSigningVars = [${SIGNING_VARS.map((v) => `'${v}'`).join(', ')}]`,
  'def tezfiksMissingSigning = tezfiksSigningVars.findAll { tezfiksSigningValue(it) == null }',
  "def tezfiksStoreFile = tezfiksSigningValue('TEZFIKS_RELEASE_STORE_FILE')",
  'if (tezfiksMissingSigning.isEmpty() && !file(tezfiksStoreFile).isFile()) {',
  "    tezfiksMissingSigning = ['TEZFIKS_RELEASE_STORE_FILE (file not found)']",
  '}',
  'def tezfiksReleaseSigningReady = tezfiksMissingSigning.isEmpty()',
  '',
].join('\n');

const RELEASE_SIGNING_CONFIG = [
  '        release {',
  `            ${MARKER}`,
  '            if (tezfiksReleaseSigningReady) {',
  "                storeFile file(tezfiksSigningValue('TEZFIKS_RELEASE_STORE_FILE'))",
  "                storePassword tezfiksSigningValue('TEZFIKS_RELEASE_STORE_PASSWORD')",
  "                keyAlias tezfiksSigningValue('TEZFIKS_RELEASE_KEY_ALIAS')",
  "                keyPassword tezfiksSigningValue('TEZFIKS_RELEASE_KEY_PASSWORD')",
  '            }',
  '        }',
].join('\n');

const RELEASE_GUARD = [
  '',
  `${MARKER}: a release artifact must never be signed with the debug key or left unsigned.`,
  'gradle.taskGraph.whenReady { graph ->',
  '    def releaseTasks = graph.allTasks.findAll { it.project == project && it.name ==~ /(?i)(assemble|bundle|package|install|sign)\\w*Release\\w*/ }',
  '    if (!releaseTasks.isEmpty() && !tezfiksReleaseSigningReady) {',
  '        throw new GradleException("Release signing is not configured. Missing: ${tezfiksMissingSigning.join(\', \')}. " +',
  '            "Set them as environment variables or in ~/.gradle/gradle.properties (see docs/android-release-signing.md).")',
  '    }',
  '}',
  '',
].join('\n');

/**
 * Returns build.gradle text with release signing applied. Idempotent. Throws when the template no longer has the
 * expected shape, so a template change cannot silently bring back debug-signed releases.
 */
function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  let out = gradle;

  // 1. Helpers before the `android {` block.
  const androidIdx = out.search(/^android\s*\{/m);
  if (androidIdx < 0) throw new Error('[with-release-signing] android { } block not found in app/build.gradle');
  out = `${out.slice(0, androidIdx)}${HELPER_BLOCK}\n${out.slice(androidIdx)}`;

  // 2. signingConfigs.release next to signingConfigs.debug.
  const debugConfig = /(signingConfigs\s*\{\s*\n\s*debug\s*\{[^}]*\}\n)/;
  if (!debugConfig.test(out)) throw new Error('[with-release-signing] signingConfigs { debug { } } not found in app/build.gradle');
  out = out.replace(debugConfig, `$1${RELEASE_SIGNING_CONFIG}\n`);

  // 3. buildTypes.release uses it (only the release block; debug keeps signingConfigs.debug).
  const releaseType = /(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
  if (!releaseType.test(out)) {
    throw new Error('[with-release-signing] buildTypes.release { signingConfig signingConfigs.debug } not found in app/build.gradle');
  }
  out = out.replace(releaseType, '$1signingConfig signingConfigs.release');

  // 4. Fail release tasks when the signing values are missing.
  return `${out.replace(/\s*$/, '\n')}${RELEASE_GUARD}`;
}

function withReleaseSigning(config) {
  // Lazy require: the helpers above stay testable without Expo's config-plugins on the path.
  const { withAppBuildGradle } = require('expo/config-plugins');
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('[with-release-signing] only Groovy app/build.gradle is supported');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.SIGNING_VARS = SIGNING_VARS;
module.exports.MARKER = MARKER;
