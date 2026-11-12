/**
 * Expo config plugin: Android 11+ package visibility for turn-by-turn navigation links (spec §12).
 * Without a <queries> entry, Linking.canOpenURL('google.navigation:q=...') is always false on targetSdk 30+.
 * Adds VIEW intents for the schemes in NAVIGATION_SCHEMES (idempotent).
 */
const NAVIGATION_SCHEMES = ['google.navigation', 'geo', 'waze'];

function hasSchemeQuery(queries, scheme) {
  return (queries || []).some((q) =>
    (q.intent || []).some((i) => (i.data || []).some((d) => d && d.$ && d.$['android:scheme'] === scheme)),
  );
}

/** Mutates an Expo AndroidManifest JSON, adding one <queries> block with the missing navigation intents. */
function addNavigationQueries(manifest, schemes = NAVIGATION_SCHEMES) {
  const root = manifest.manifest;
  const missing = schemes.filter((s) => !hasSchemeQuery(root.queries, s));
  if (!missing.length) return manifest;
  root.queries = root.queries || [];
  root.queries.push({
    intent: missing.map((scheme) => ({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': scheme } }],
    })),
  });
  return manifest;
}

function withNavigationQueries(config) {
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (cfg) => {
    addNavigationQueries(cfg.modResults);
    return cfg;
  });
}

module.exports = withNavigationQueries;
module.exports.addNavigationQueries = addNavigationQueries;
module.exports.NAVIGATION_SCHEMES = NAVIGATION_SCHEMES;
