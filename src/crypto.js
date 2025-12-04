/* Local argon2 embedded */
// crypto.js — browser-only, uses argon2 from CDN and WebCrypto AES-GCM
import argon2 from './lib/argon2/argon2-bundled.min.js';
// NOTE: To embed argon2 locally, place argon2-bundled.min.js in ./lib/argon2/ and uncomment the local import below.
// import argon2 from './lib/argon2/argon2-bundled.min.js';


/*
Strategy:
- Use Argon2id to hash the password and produce raw bytes.
- Use HKDF (SHA-256) with the argon2 output as IKM to derive a 256-bit AES-GCM key.
- Encrypt/decrypt with subtle.crypto using AES-GCM with 12-byte random IVs.
- All outputs are base64-encoded strings (IV + ciphertext).
*/

const enc = new TextEncoder();
const dec = new TextDecoder();

async function argon2Hash(pass, saltBytes) {
  // argon2-browser's hash returns encoded and rawHash depending on options
  const res = await argon2.hash({
    pass: typeof pass === 'string' ? enc.encode(pass) : pass,
    salt: saltBytes,
    time: 2,
    mem: 65536,
    hashLen: 32,
    parallelism: 1,
    type: argon2.ArgonType.Argon2id
  });
  // res.hash is base64 string; res.hashRaw should be Uint8Array if available
  if (res.hashRaw) return res.hashRaw;
  // fallback: decode res.hash (base64)
  return Uint8Array.from(atob(res.hash).split('').map(c=>c.charCodeAt(0)));
}

async function hkdfExtractAndExpand(ikm, info = new Uint8Array([]), length = 32) {
  // HKDF-SHA256: import ikm as raw key, then deriveKey with HKDF
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  const derived = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', info: info, salt: new Uint8Array([]) },
    key,
    { name: 'AES-GCM', length: 256},
    true,
    ['encrypt','decrypt']
  );
  return derived;
}

export async function deriveAesKeyFromPassword(password, saltStr = null) {
  // salt: if not provided, use random 16 bytes
  const salt = saltStr ? enc.encode(saltStr) : crypto.getRandomValues(new Uint8Array(16));
  const argon = await argon2Hash(password, salt);
  const aesKey = await hkdfExtractAndExpand(argon, enc.encode('CipherNexus HKDF v1'), 32);
  // return { key: CryptoKey, salt: base64 }
  return { key: aesKey, salt: btoa(String.fromCharCode(...salt)) };
}

export async function encryptString(aesKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV recommended
  const pt = enc.encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pt);
  // pack iv + cipher as base64
  const tmp = new Uint8Array(iv.byteLength + cipher.byteLength);
  tmp.set(iv, 0);
  tmp.set(new Uint8Array(cipher), iv.byteLength);
  return btoa(String.fromCharCode(...tmp));
}

export async function decryptString(aesKey, b64payload) {
  const raw = Uint8Array.from(atob(b64payload), c => c.charCodeAt(0));
  const iv = raw.slice(0,12);
  const cipher = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher);
  return dec.decode(plain);
}

// helper to import a previously derived key from jwk / raw for portability
export async function exportKeyToRaw(aesKey) {
  const raw = await crypto.subtle.exportKey('raw', aesKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function importRawKey(b64raw) {
  const raw = Uint8Array.from(atob(b64raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt','decrypt']);
}
export async function verifyHMAC(key, msg, sigB64){
  const enc = new TextEncoder().encode(msg);
  const sig = Uint8Array.from(atob(sigB64),c=>c.charCodeAt(0));
  const mac = await crypto.subtle.sign("HMAC", key, enc);
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === sigB64;
}


export async function deriveDHKey(privateKey, peerPubB64){
  try{
    const peerRaw = Uint8Array.from(atob(peerPubB64),c=>c.charCodeAt(0));
    const peerKey = await crypto.subtle.importKey(
      "raw", peerRaw, {name:"ECDH", namedCurve:"P-256"}, true, []
    );
    const shared = await crypto.subtle.deriveBits(
      {name:"ECDH", public:peerKey},
      privateKey,
      256
    );
    return new Uint8Array(shared);
  }catch(e){ console.error("DH error",e); return null; }
}
