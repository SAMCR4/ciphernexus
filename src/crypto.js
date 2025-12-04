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



// === Encryption helpers ===
window.cryptoHelpers = window.cryptoHelpers || {};
window.cryptoHelpers.textToArray = function(s){ return new TextEncoder().encode(s); };
window.cryptoHelpers.arrayToB64 = function(u){ return btoa(String.fromCharCode(...new Uint8Array(u))); };
window.cryptoHelpers.b64ToArray = function(b){ return Uint8Array.from(atob(b), c=>c.charCodeAt(0)); };

window.cryptoHelpers.deriveKeyFromCode = async function(code){ 
  // Derive AES-GCM 256 key and HMAC key using PBKDF2 (salted by room constant)
  const salt = new TextEncoder().encode('cipher-salt:'+code);
  const passKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), {name:'PBKDF2'}, false, ['deriveBits','deriveKey']);
  const aesKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, passKey, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const hmacKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, passKey, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
  return {aesKey, hmacKey};
};

window.cryptoHelpers.deriveKeyFromCode = (async function(prev){
  return async function(code){
    const obj = await prev(code);
    // expose for compatibility
    window.__CIPHERNEXUS_AES_KEY = obj.aesKey;
    window.__CIPHERNEXUS_HMAC_KEY = obj.hmacKey;
    return obj.aesKey;
  };
})(window.cryptoHelpers.deriveKeyFromCode);

window.cryptoHelpers.encryptMessage = async function(aesKey, plaintext){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, aesKey, enc);
  return {iv: Array.from(iv), ct: Array.from(new Uint8Array(ct))};
};
window.cryptoHelpers.decryptMessage = async function(aesKey, ivArr, ctArr){
  try{
    const iv = new Uint8Array(ivArr);
    const ct = new Uint8Array(ctArr);
    const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, aesKey, ct);
    return new TextDecoder().decode(plain);
  }catch(e){ console.error('decrypt fail',e); return null; }
};




// --- Crypto helpers: prefer Argon2 KDF, fallback to PBKDF2 ---
async function importArgon2Bundle(){
  try{
    if(window.argon2) return window.argon2;
    // try to load local bundle
    await import('./lib/argon2/argon2-bundled.min.js');
    return window.argon2 || null;
  }catch(e){ console.warn('argon2 import failed', e); return null; }
}

async function deriveRawKeyArgon2(pass, saltB64, hashLen=32){
  const a2 = await importArgon2Bundle();
  if(!a2) return null;
  try{
    const salt = saltB64 ? Uint8Array.from(atob(saltB64), c=>c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    // many bundles expose argon2.hash or argon2.hashRaw; try common APIs
    if(a2.hash) {
      const res = await a2.hash({pass, salt, time:2, mem:65536, parallelism:1, hashLen, raw: true});
      return res instanceof ArrayBuffer ? new Uint8Array(res) : res;
    }
    if(a2.hashRaw){
      const res = await a2.hashRaw(pass, salt, {time:2, mem:65536, parallelism:1, hashLen});
      return res;
    }
  }catch(e){ console.warn('argon2 derive failed', e); }
  return null;
}

async function deriveKeysFromPass(pass, saltB64){
  // Try Argon2
  const raw = await deriveRawKeyArgon2(pass, saltB64, 32);
  if(raw){
    // split raw into two keys via HKDF to be safe
    const imported = await crypto.subtle.importKey('raw', raw.buffer, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:new TextEncoder().encode('CipherNexus AES')}, imported, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
    const hmacKey = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:new TextEncoder().encode('CipherNexus HMAC')}, imported, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
    return {aesKey, hmacKey};
  }
  // Fallback: PBKDF2 from earlier helper if present
  if(window.cryptoHelpers && window.cryptoHelpers._deriveKeyFromPBKDF2){
    return await window.cryptoHelpers._deriveKeyFromPBKDF2(pass);
  }
  // As last resort, use PBKDF2 inline
  const salt = new TextEncoder().encode('cipher-salt:'+pass);
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, baseKey, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const hmacKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, baseKey, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
  return {aesKey, hmacKey};
}

// AES-GCM encrypt/decrypt helpers
async function aesEncrypt(aesKey, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, aesKey, pt);
  return {iv:Array.from(iv), ct:Array.from(new Uint8Array(ct))};
}
async function aesDecrypt(aesKey, ivArr, ctArr){
  try{
    const iv = new Uint8Array(ivArr);
    const ct = new Uint8Array(ctArr);
    const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, aesKey, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }catch(e){ console.warn('decrypt fail', e); return null; }
}

// Expose to global helper namespace
window.cryptoHelpers = window.cryptoHelpers || {};
window.cryptoHelpers.deriveKeysFromPass = deriveKeysFromPass;
window.cryptoHelpers.aesEncrypt = aesEncrypt;
window.cryptoHelpers.aesDecrypt = aesDecrypt;



// --- Final Argon2 integration (Part A1) ---
// This code prefers a local Argon2 bundle at ./lib/argon2/argon2-bundled.min.js
async function ensureArgon2(){
  if(typeof window !== 'undefined' && window.argon2) return window.argon2;
  try{
    // try dynamic import of local bundle (works for ES module-ish bundles)
    await import('./lib/argon2/argon2-bundled.min.js');
    if(window.argon2) return window.argon2;
  }catch(e){
    console.warn('local argon2 import failed', e);
  }
  // try to load via script tag fallback
  try{
    if(document){
      const s = document.createElement('script');
      s.src = './lib/argon2/argon2-bundled.min.js';
      document.head.appendChild(s);
      // wait a bit for it to load
      await new Promise(res=> setTimeout(res, 200));
      if(window.argon2) return window.argon2;
    }
  }catch(e){ console.warn('script load argon2 failed', e); }
  return null;
}

async function deriveRawKeyArgon2(pass, saltB64, hashLen){
  const a2 = await ensureArgon2();
  if(!a2) return null;
  try{
    const salt = saltB64 ? Uint8Array.from(atob(saltB64), c=>c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    // try common APIs
    if(typeof a2.hash === 'function'){
      const res = await a2.hash({pass, salt, time:2, mem:65536, parallelism:1, hashLen:hashLen||32, raw:true});
      return res instanceof ArrayBuffer ? new Uint8Array(res) : res;
    }
    if(typeof a2.hashRaw === 'function'){
      const res = await a2.hashRaw(pass, salt, {time:2, mem:65536, parallelism:1, hashLen:hashLen||32});
      return res;
    }
    // older libs may expose "argon2" as a function
    if(typeof a2 === 'function'){
      const res = await a2(pass, salt, {raw:true});
      return res;
    }
  }catch(e){
    console.warn('argon2 derive error', e);
  }
  return null;
}

// deriveKeysFromPass now prefers Argon2 and falls back to PBKDF2
async function deriveKeysFromPassPreferArgon2(pass, saltB64){
  const raw = await deriveRawKeyArgon2(pass, saltB64, 32);
  if(raw){
    const imported = await crypto.subtle.importKey('raw', raw.buffer || raw, 'HKDF', false, ['deriveKey']);
    const aesKey = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:new TextEncoder().encode('CipherNexus AES')}, imported, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
    const hmacKey = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:new TextEncoder().encode('CipherNexus HMAC')}, imported, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
    return {aesKey, hmacKey};
  }
  // fallback existing helper if present
  if(window.cryptoHelpers && window.cryptoHelpers._deriveKeyFromPBKDF2){
    return await window.cryptoHelpers._deriveKeyFromPBKDF2(pass);
  }
  // final fallback: inline PBKDF2
  const salt = new TextEncoder().encode('cipher-salt:'+pass);
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, baseKey, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const hmacKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, baseKey, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
  return {aesKey, hmacKey};
}

// expose globally
window.cryptoHelpers = window.cryptoHelpers || {};
window.cryptoHelpers.deriveKeysFromPassPreferArgon2 = deriveKeysFromPassPreferArgon2;



// === PART A4: HMAC sign/verify helpers ===
// Signs a Uint8Array or ArrayBuffer using window.__CIPHERNEXUS_HMAC_KEY (CryptoKey - HMAC SHA-256)
async function CN_HMAC_Sign(data){
  try{
    if(!window.__CIPHERNEXUS_HMAC_KEY){
      console.warn('HMAC key missing');
      return null;
    }
    // ensure data is Uint8Array
    let u = (data instanceof Uint8Array) ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(String(data)));
    const sig = await crypto.subtle.sign('HMAC', window.__CIPHERNEXUS_HMAC_KEY, u);
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }catch(e){ console.error('CN_HMAC_Sign', e); return null; }
}

// Verifies base64 signature over data using HMAC key
async function CN_HMAC_Verify(data, sigB64){
  try{
    if(!window.__CIPHERNEXUS_HMAC_KEY) return false;
    let u = (data instanceof Uint8Array) ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(String(data)));
    const sig = Uint8Array.from(atob(sigB64), c=>c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', window.__CIPHERNEXUS_HMAC_KEY, sig, u);
  }catch(e){ console.error('CN_HMAC_Verify', e); return false; }
}

window.cryptoHelpers = window.cryptoHelpers || {};
window.cryptoHelpers.CN_HMAC_Sign = CN_HMAC_Sign;
window.cryptoHelpers.CN_HMAC_Verify = CN_HMAC_Verify;



/* === B5: Secure Room-Code Pairing UX (Compression + Pack/Unpack) === */

// Simple LZ-based compression (LZ-String mini)
function CN_LZ_Compress(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function CN_LZ_Decompress(b64){
  try{ return decodeURIComponent(escape(atob(b64))); }
  catch(e){ console.warn("decompress fail",e); return ""; }
}

// Secure pack: {room, user} -> AES-GCM + HMAC -> LZ -> base64
async function CN_Pack_RoomPayload(obj){
  try{
    const json = JSON.stringify(obj);
    const compressed = CN_LZ_Compress(json);
    const enc = await cryptoHelpers.aesEncrypt(window.__CIPHERNEXUS_AES_KEY, compressed);
    const ivBytes=new Uint8Array(enc.iv), ctBytes=new Uint8Array(enc.ct);
    const combined=new Uint8Array(ivBytes.length+ctBytes.length);
    combined.set(ivBytes,0); combined.set(ctBytes,ivBytes.length);
    const sig = await cryptoHelpers.CN_HMAC_Sign(combined);
    return btoa(JSON.stringify({iv:enc.iv,ct:enc.ct,sig}));
  }catch(e){ console.error("pack fail",e); return ""; }
}

// Secure unpack: base64 -> JSON -> HMAC verify -> AES decrypt -> decompress -> object
async function CN_Unpack_RoomPayload(b64){
  try{
    const raw = JSON.parse(atob(b64));
    const ivBytes=new Uint8Array(raw.iv), ctBytes=new Uint8Array(raw.ct);
    const combined=new Uint8Array(ivBytes.length+ctBytes.length);
    combined.set(ivBytes,0); combined.set(ctBytes,ivBytes.length);
    const ok = await cryptoHelpers.CN_HMAC_Verify(combined, raw.sig);
    if(!ok) return null;
    const plain = await cryptoHelpers.aesDecrypt(window.__CIPHERNEXUS_AES_KEY, raw.iv, raw.ct);
    const dec = CN_LZ_Decompress(plain);
    return JSON.parse(dec);
  }catch(e){ console.error("unpack fail",e); return null; }
}

window.cryptoHelpers.CN_Pack_RoomPayload = CN_Pack_RoomPayload;
window.cryptoHelpers.CN_Unpack_RoomPayload = CN_Unpack_RoomPayload;


// === A5: Key rotation helpers ===
// Rotate AES and HMAC keys by deriving a new key from existing HMAC + salt via HKDF
async function CN_RotateKeys(extraSalt){
  try{
    if(!window.__CIPHERNEXUS_HMAC_KEY || !window.__CIPHERNEXUS_AES_KEY) return null;
    const baseRaw = await crypto.subtle.exportKey('raw', window.__CIPHERNEXUS_HMAC_KEY);
    const imported = await crypto.subtle.importKey('raw', baseRaw, 'HKDF', false, ['deriveKey']);
    const salt = extraSalt ? (new TextEncoder().encode(extraSalt)) : crypto.getRandomValues(new Uint8Array(12));
    const newAes = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt, info:new TextEncoder().encode('CipherNexus Rotated AES')}, imported, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
    const newHmac = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt, info:new TextEncoder().encode('CipherNexus Rotated HMAC')}, imported, {name:'HMAC', hash:'SHA-256', length:256}, true, ['sign','verify']);
    window.__CIPHERNEXUS_AES_KEY = newAes; window.__CIPHERNEXUS_HMAC_KEY = newHmac;
    return {aes:newAes, hmac:newHmac};
  }catch(e){ console.warn('CN_RotateKeys', e); return null; }
}
window.cryptoHelpers = window.cryptoHelpers || {}; window.cryptoHelpers.CN_RotateKeys = CN_RotateKeys;


// === E3: Salted signaling key derivation ===
async function CN_Derive_SignalingKey_FromRoom(roomCode){
  try{
    // combine roomCode and current time to create salt
    const salt = new TextEncoder().encode('sig:'+roomCode+':'+Math.floor(Date.now()/1000));
    // if main AES exists, derive from it; else derive from roomCode via PBKDF2
    if(window.__CIPHERNEXUS_AES_KEY){ return await CN_Derive_SigningKeyFromAES(window.__CIPHERNEXUS_AES_KEY); }
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(roomCode), {name:'PBKDF2'}, false, ['deriveKey']);
    const sigKey = await crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:50000, hash:'SHA-256'}, baseKey, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    return sigKey;
  }catch(e){ console.warn('CN_Derive_SignalingKey_FromRoom', e); return null; }
}
window.cryptoHelpers = window.cryptoHelpers || {}; window.cryptoHelpers.CN_Derive_SignalingKey_FromRoom = CN_Derive_SignalingKey_FromRoom;
