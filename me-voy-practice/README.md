# me-voy-practice

Single-page rehearsal tool for "Me Voy" (Julieta Venegas), for Emi's 9 Dec presentation. Spanish UI, no build, no dependencies.

## What it does

- **Practice mode**: load the song MP3 (stays on the device). Live bar/eighth counter, countdown before every vocal entry, click track, entry chime, slow-down, loop one entry.
- **Karaoke + scoring**: load the karaoke pack (stereo MP3: instrumental left, isolated guide vocal right). Plays the instrumental with an adjustable guide vocal after a 4-beep count-in.
- **Scoring**: record with the mic in the page, or upload a recording made on another device. In the browser it syncs (beeps, else envelope correlation), removes the instrumental by spectral subtraction, then scores:
  - entries on time (±0.13 s, attack vs. guide vocal attack)
  - pitch (pitch class vs. guide vocal, octave-agnostic, ±50 cents)
  - presence (singing where the vocal is)

## Data

- Beat grid and the 38-entry map are embedded in `index.html`, measured from Emi's MP3 (demucs vocal split, librosa beat tracking, manual check).
- No audio and no lyrics in the repo. The MP3 and the karaoke pack stay local.

## Run

- Open `index.html` from any static host. The mic needs HTTPS or `localhost`.

## Deploy

- GitHub Pages via [`.github/workflows/pages.yml`](../.github/workflows/pages.yml), on every push to `main` that touches this folder.
- URL: `https://cardonacarlos9a.github.io/toolbox/me-voy-practice/`
- One-time setup: repo Settings → Pages → Source: **GitHub Actions**.
