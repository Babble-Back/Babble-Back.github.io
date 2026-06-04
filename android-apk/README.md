# BabbleBack Android APK

This folder is an isolated native Android wrapper for the existing Vite app. It
does not change the website source, package dependencies, or Vite config.

## Build

From this folder:

```powershell
.\build-apk.ps1
```

The script:

1. Type-checks the web app with `tsc -p tsconfig.app.json --noEmit`.
2. Builds the Vite app into `android-apk/app/src/main/assets/www`.
3. Stamps the generated Android copy of `sw.js` without modifying `public/sw.js`.
4. Builds the Android debug APK.
5. Copies the APK to `android-apk/outputs/BabbleBack-debug.apk`.

The Android wrapper loads local web assets from:

```text
https://appassets.backtalk.local/
```

That synthetic HTTPS origin keeps browser secure-context checks intact for the
microphone recorder while still packaging the site inside the APK.

## Notes

- Supabase URL and anon key still come from the repo root `.env.local` at build
  time, the same as the website.
- The APK grants the WebView microphone permission only when the page requests
  audio capture.
- Web Push subscriptions are browser/PWA-specific and are not implemented as
  native Android push notifications in this wrapper.
