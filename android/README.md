# OakCraft CRM — Android app

Ye folder CRM ka Android shell hai: ek chhota WebView app jo `index.html`,
`quotation-builder.html`, `lib/`, `icons/` ko APK ke andar pack karta hai aur
Google Sheet backend (Apps Script) se pehle jaise sync karta hai.

* Package: `in.oakcraft.crm` · minSdk 23 (Android 6.0+) · targetSdk 34
* Kya native hai: file picker + camera (item image / proofs), Excel & PDF download
  seedha *Downloads/OakCraft CRM* me, WhatsApp / GST portal links system app me,
  hardware back button (modal → drawer → dashboard → double-tap exit).
* Gradle / Android Studio ki zaroorat nahi — `build.sh` sirf `aapt`, `javac`, `d8`/`dx`,
  `zipalign`, `apksigner` use karta hai.

## Install (phone par)

1. APK phone me copy karein (WhatsApp / Drive / USB).
2. File kholein → "Install unknown apps" allow karein → Install.
3. Pehli baar login: wahi email/password jo web CRM me use karte hain.

## Build locally

```bash
# Ubuntu / Debian
sudo apt install android-sdk-build-tools android-sdk-platform-23 default-jdk
./android/build.sh                                    # debug-signed APK -> android/build/

# Release-signed (same keystore har baar use karein, warna update install nahi hogi)
KEYSTORE=/path/oakcraft-crm-release.jks KEYSTORE_PASS='...' KEY_ALIAS=oakcraft ./android/build.sh
```

Android Studio / SDK wale machine par `ANDROID_HOME` set ho to script khud latest
build-tools aur platform utha leta hai.

## GitHub Actions

`.github/workflows/android-apk.yml` har push (main) par APK build karke Release
me attach kar deta hai. Release signing ke liye repo secrets add karein:
`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`.

## Files

| Path | Kya hai |
|------|---------|
| `AndroidManifest.xml` | permissions (INTERNET, storage ≤ Android 9), activity, ShareProvider, `<queries>` |
| `src/in/oakcraft/crm/MainActivity.java` | WebView shell — assets ko `https://app.oakcraft.crm/` origin se serve karta hai (secure origin → `crypto.subtle`, localStorage) |
| `src/in/oakcraft/crm/ShareProvider.java` | chhota FileProvider (camera output + exported files share) |
| `res/` | app icon (adaptive + one legacy PNG, Android scales it), theme, strings |
| `build.sh` | poori build pipeline |
