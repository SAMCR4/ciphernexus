
const fs = require('fs');
const crypto = require('crypto');
const bundle = fs.readFileSync('dist/bundle.min.js');
const hash = crypto.createHash('sha256').update(bundle).digest('base64');
let loader = `(async function(){ const expectedHash = "${hash}"; try{ const resp = await fetch('/dist/bundle.min.js'); const txt = await resp.text(); const buf = new TextEncoder().encode(txt); const digest = await crypto.subtle.digest('SHA-256', buf); const b64 = btoa(String.fromCharCode(...new Uint8Array(digest))); if(b64 !== expectedHash){ alert('Bundle integrity check failed. Aborting.'); console.error('expected', expectedHash, 'got', b64); return; } const blob = new Blob([txt], { type: 'text/javascript' }); const url = URL.createObjectURL(blob); await import(url); URL.revokeObjectURL(url);}catch(e){ console.error('loader error', e); alert('Failed to load app bundle'); }})();`;
fs.writeFileSync('dist/loader.js', loader);
console.log('Updated dist/loader.js with hash:', hash);
// Optionally create a signature if PRIVATE_KEY env var present
if(process.env.PRIVATE_KEY_PEM){ const { execSync } = require('child_process'); fs.writeFileSync('dist/bundle.sha256', hash); try{ fs.writeFileSync('dist/bundle.sha256', hash); // write file
// write private key to temp file and sign using openssl if available
const pk = process.env.PRIVATE_KEY_PEM;
require('fs').writeFileSync('.tmp_pk.pem', pk);
execSync('openssl dgst -sha256 -sign .tmp_pk.pem -out dist/bundle.sha256.sig dist/bundle.min.js');
execSync('rm .tmp_pk.pem');
console.log('Signature created at dist/bundle.sha256.sig'); }catch(e){ console.warn('Signing failed',e); } }
