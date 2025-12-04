CipherNexus — Static GitHub Pages build (fixed)

What I changed:
- Converted the project to a pure static layout that works on GitHub Pages without a Vite build.
- Replaced the missing local Argon2 bundle with a CDN import (argon2-browser via jsdelivr).
- Added a robust client-side encryption module (Argon2id -> HKDF -> AES-GCM) in src/crypto.js.
- Simplified index.html and main.js to demonstrate encryption usage.
- Removed package.json/vite.config files from this fixed package for clarity.

How to deploy:
1. Upload the contents of this folder to your GitHub repository's main branch (or gh-pages branch).
2. Enable GitHub Pages to serve the root of the repository (or the docs folder if you put files there).
3. Open the site — it will run entirely in the browser, no build required.

Security notes:
- All encryption happens client-side. Server (or GitHub Pages) never sees plaintext unless you send it.
- Argon2 and WebCrypto parameters are tuned for decent security in browsers but can be adjusted up for higher work factors.
- The code uses a CDN for argon2; if you require fully offline packaging, you'll need to include argon2-bundled.min.js and its wasm file into src/lib/argon2/ locally.

# Session QR
The session QR is a visual representation of the session URL. For a scannable QR code, you can copy the session link and use any QR generator, or run the local build scripts to include a QR library.
