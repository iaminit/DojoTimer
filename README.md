# Dojo Timer — Judo & BJJ Tatami Interval Timer

High-contrast tatami interval timer designed for **Judo** and **Brazilian Jiu-Jitsu (BJJ)** training, available as a Progressive Web App (PWA) and native Android app via Capacitor.

## Features

- **Discipline-Specific Profiles**:
  - **Judo**: Voice announcements (*Hajime*, *Matte*, *Soremade*, Japanese countdown) + bronze gong, with selectable `KENGURO` (male) / `ARALE` (female) voice profiles or `Gong Only`. Default preset: **Randori Judo** (`6 × 3:00`, `1:00` rest).
  - **BJJ**: Acoustic bells and bronze gong cues (`No Voice` option enforced cleanly). Default preset: **Sparring BJJ** (`6 × 4:00`, `1:00` rest).
- **Two Display Modes** (switchable in Options / Display Settings):
  - **Modalità 1 — Cerchio Classico**: Portrait circular gauge with dynamic rising water fill, SVG progress ring, and wide landscape scoreboard display.
  - **Modalità 2 — Scoreboard Pro**: High-distance editorial layout using bundled `Space Grotesk` offline fonts, axially centered hollow minutes (`M`) & bold outlined seconds (`S`), negative-black seconds progress bar, side ruler scale ticks, altimeter background fill, round segment dock, and `<= 9s` final-countdown accent shift.
- **Customizable Visual Colors & Background Opacity**:
  - Switch between **Automatico** proportional phase progression (**Verde → Arancio → Rosso** in work, **Blu → Azzurro** in rest) or **Colori Pieni** (**Rosso**, **Verde**, **Arancio**, **Azzurro**) across both modes.
  - Adjustable **Background Opacity (`0%–100%`, default `20%`)** with live interactive side-by-side previews for both Classic and Scoreboard Pro.
- **Gong Wave Ripple**: 3 concentric GPU-composited background shockwaves synced cleanly to the exact acoustic impact of the Hajime starting gong.
- **Reliability**: Wake Lock protection, Service Worker update guard during active rounds, session state recovery across reloads, native Android hardware back button handling, and full responsive landscape scrolling.

## Development

```bash
npm install
npm run dev
```

Run checks and unit tests:

```bash
npm run typecheck
npm test
```

## Web / PWA Build

```bash
npm run build
# Or for deployment under a /timer/ subpath:
VITE_BASE_PATH=/timer/ npm run build
```

## Android Build (Capacitor)

1. Copy `android/keystore.properties.example` to `~/.android/dojo-timer/keystore.properties` (or `android/keystore.properties`, both ignored by Git) and fill in your release keystore path/passwords, or set `DOJO_UPLOAD_STORE_FILE`, `DOJO_UPLOAD_STORE_PASSWORD`, `DOJO_UPLOAD_KEY_ALIAS`, `DOJO_UPLOAD_KEY_PASSWORD`.
2. Build APK or AAB (defaults `ANDROID_HOME` to `$HOME/Library/Android/sdk` if unset):

```bash
npm run build:apk
npm run build:aab
```
