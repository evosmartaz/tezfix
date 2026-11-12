# Android release signing and Google Maps (BUG-003)

Applies to both apps: TezFiks (`apps/customer`, `az.tezfiks.app`) and TezFiks Usta (`apps/pro`, `az.tezfiks.usta`).

## Why this exists

Up to 0.1.0 the release APKs were signed with the React Native template `debug.keystore`, because the Expo template sets
`buildTypes.release.signingConfig signingConfigs.debug`. That certificate is public:

| | Value |
|---|---|
| Debug certificate SHA-1 | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |
| Debug certificate SHA-256 | `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` |

Two consequences:

1. Google Maps answered "Authorization failure" (black map). The Maps key's Android restriction did not list
   `<this SHA-1>;az.tezfiks.app` / `;az.tezfiks.usta` (or the Maps SDK for Android was not enabled on the key's project).
2. Anyone holding the public debug key could build an APK with our package name that Android accepts as an "update".

From 0.1.1 on, the config plugin `packages/mobile/plugins/with-release-signing.js` (used by both `app.config.ts`) makes
`expo prebuild` generate a `signingConfigs.release` that reads its values at build time, and **fails every release task**
when they are missing. A release APK can no longer be signed with the debug key by accident. Debug builds are unchanged.

## 1. The release key (once, release owner only)

**If the company already has a release keystore, use it and skip to step 2. Never create a second identity.** Changing the
signing key later means every installed app must be uninstalled, and on Google Play the key cannot be changed casually.

```bash
scripts/android-release-keystore.sh
```

- Creates `~/.tezfiks-signing/tezfiks-release.jks` (PKCS12, RSA 4096, mode 600; override the folder with
  `TEZFIKS_SIGNING_DIR`). It refuses to write inside the repository and never overwrites an existing keystore.
- keytool asks for the passwords on hidden prompts. They are not echoed or stored by the script.
- It prints only public data: alias (`tezfiks-release`), owner, validity, **SHA-1 and SHA-256**. Record those in the
  release notes and in Google Cloud (step 3).

One key for both apps is the default (one owner, one backup). Separate keys per app also work: set different
`TEZFIKS_RELEASE_*` values when building each app, and register each pair in Google Cloud.

**Backup (mandatory):** copy the keystore and its passwords to two separate places the company controls (for example a
password manager entry with the file attached, plus an encrypted offline copy). Losing the key means no further updates to
installed apps. Do not commit it (`*.jks`, `*.keystore` are in `.gitignore`), do not send it to QA, do not put it on the
server.

Print the fingerprints of an existing keystore at any time:

```bash
scripts/android-release-keystore.sh --print ~/.tezfiks-signing/tezfiks-release.jks
```

## 2. Building a signed release

The four values come from environment variables or from Gradle properties (`~/.gradle/gradle.properties`, outside the repo):

| Name | Value |
|---|---|
| `TEZFIKS_RELEASE_STORE_FILE` | absolute path of the keystore |
| `TEZFIKS_RELEASE_STORE_PASSWORD` | keystore password |
| `TEZFIKS_RELEASE_KEY_ALIAS` | `tezfiks-release` |
| `TEZFIKS_RELEASE_KEY_PASSWORD` | key password (same as the store password for a PKCS12 keystore) |

```bash
cd apps/customer                                   # then the same for apps/pro
export EXPO_PUBLIC_API_URL=https://evosmart.az/tezfix/api
export GOOGLE_MAPS_ANDROID_KEY=...                 # the Android Maps key (see step 3)
export TEZFIKS_RELEASE_STORE_FILE=~/.tezfiks-signing/tezfiks-release.jks TEZFIKS_RELEASE_KEY_ALIAS=tezfiks-release
read -rs TEZFIKS_RELEASE_STORE_PASSWORD && export TEZFIKS_RELEASE_STORE_PASSWORD TEZFIKS_RELEASE_KEY_PASSWORD=$TEZFIKS_RELEASE_STORE_PASSWORD
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease            # android/app/build/outputs/apk/release/app-release.apk
```

Without the values the build stops with `Release signing is not configured. Missing: ...`.

Verify every APK before publishing it (Android SDK build-tools):

```bash
apksigner verify --print-certs app-release.apk     # the SHA-1/SHA-256 must be the release key's, never 5E:8F:16:06:...
aapt2 dump badging app-release.apk | head -1       # package name, versionCode, versionName
```

## 3. Google Cloud (Maps key owner)

In the Google Cloud project that owns the key used as `GOOGLE_MAPS_ANDROID_KEY` (the 0.1.0 APKs carried `AIzaSyC7…vrjEg`):

1. **APIs & Services → Library → Maps SDK for Android → Enable.** Billing must be active on the project.
2. **APIs & Services → Credentials →** the Android key → **Application restrictions: Android apps**. Add:
   - package `az.tezfiks.app`, SHA-1 of the release key;
   - package `az.tezfiks.usta`, SHA-1 of the release key (or of the Usta key, if the apps use separate keys).
   Do **not** add the public debug SHA-1 `5E:8F:16:06:…` (remove it if it was added as a stopgap).
   For local debug builds, prefer a separate key restricted to each developer's own debug keystore.
3. **API restrictions: Restrict key → Maps SDK for Android** only. The server key (`GOOGLE_MAPS_SERVER_KEY`) and the
   panel key are separate keys.
4. Changes can take a few minutes to apply. Then install the new APK and check `adb logcat | grep -i "maps"`: no
   `Authorization failure`.

## 4. Updating installed apps (testers)

The 0.1.1 APKs are signed with a different certificate from 0.1.0 (debug key). Android refuses to install them over
0.1.0 (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / "App not installed"). Testers must **uninstall** TezFiks and TezFiks Usta
first, then install 0.1.1. Uninstalling deletes the app's local data (login session, language, cached data), so they
have to log in again. Server data is not affected. From 0.1.1 on, updates install in place again as long as the
same release key is used.
