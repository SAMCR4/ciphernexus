 import argon2 from './lib/argon2/argon2-bundled.min.js'; const enc = new TextEncoder(); const dec = new TextDecoder(); async function argon2Hash(pass, saltBytes) { const res = await argon2.hash({ pass: typeof pass === 'string' ? enc.encode(pass) : pass, salt: saltBytes, time: 2, mem: 65536, hashLen: 32, parallelism: 1, type: argon2.ArgonType.Argon2id }); if (res.hashRaw) return res.hashRaw; return Uint8Array.from(atob(res.hash).split('').map(c=>c.charCodeAt(0))); } async function hkdfExtractAndExpand(ikm, info = new Uint8Array([]), length = 32) { const _v2350 = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']); const derived = await crypto.subtle.deriveKey( { name: 'HKDF', hash: 'SHA-256', info: info, salt: new Uint8Array([]) }, _v2350, { name: 'AES-GCM', length: 256}, true, ['encrypt','decrypt'] ); return derived; } export async function deriveAesKeyFromPassword(password, saltStr = null) { const salt = saltStr ? enc.encode(saltStr) : crypto.getRandomValues(new Uint8Array(16)); const argon = await argon2Hash(password, salt); const aesKey = await hkdfExtractAndExpand(argon, enc.encode('CipherNexus HKDF v1'), 32); return { _v2350: aesKey, salt: btoa(String.fromCharCode(...salt)) }; } export async function encryptString(aesKey, plaintext) { const iv = crypto.getRandomValues(new Uint8Array(12)); const pt = enc.encode(plaintext); const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pt); const tmp = new Uint8Array(iv.byteLength + cipher.byteLength); tmp.set(iv, 0); tmp.set(new Uint8Array(cipher), iv.byteLength); return btoa(String.fromCharCode(...tmp)); } export async function decryptString(aesKey, b64payload) { const raw = Uint8Array.from(atob(b64payload), c => c.charCodeAt(0)); const iv = raw.slice(0,12); const cipher = raw.slice(12); const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher); return dec.decode(plain); } export async function exportKeyToRaw(aesKey) { const raw = await crypto.subtle.exportKey('raw', aesKey); return btoa(String.fromCharCode(...new Uint8Array(raw))); } export async function importRawKey(b64raw) { const raw = Uint8Array.from(atob(b64raw), c => c.charCodeAt(0)); return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt','decrypt']); } export async function verifyHMAC(_v2350, _v1214, sigB64){ const enc = new TextEncoder().encode(_v1214); const sig = Uint8Array.from(atob(sigB64),c=>c.charCodeAt(0)); const mac = await crypto.subtle.sign("_b64_SE1BQw==", _v2350, enc); return btoa(String.fromCharCode(...new Uint8Array(mac))) === sigB64; } export async function deriveDHKey(privateKey, peerPubB64){ try{ const peerRaw = Uint8Array.from(atob(peerPubB64),c=>c.charCodeAt(0)); const peerKey = await crypto.subtle.importKey( "_b64_cmF3", peerRaw, {name:"_b64_RUNESA==", namedCurve:"_b64_UC0yNTY="}, true, [] ); const shared = await crypto.subtle.deriveBits( {name:"_b64_RUNESA==", public:peerKey}, privateKey, 256 ); return new Uint8Array(shared); }catch(e){ console.error("_b64_REggZXJyb3I=",e); return null; } } 


/* Phase8: ECDH -> HKDF -> AES/HMAC key derivation and keypair helpers */
export async function generateLocalKeyPair(){
  const kp = await crypto.subtle.generateKey({name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits","deriveKey"]);
  // export public raw
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const pubB64 = btoa(String.fromCharCode(...new Uint8Array(pub)));
  // export private raw for persistence (extractable true)
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey).catch(()=>null);
  return {keyPair:kp, publicB64:pubB64, privatePkcs8: priv ? btoa(String.fromCharCode(...new Uint8Array(priv))) : null};
}

export async function importPrivateKeyPkcs8(b64pkcs8){
  const raw = Uint8Array.from(atob(b64pkcs8), c=>c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", raw.buffer, {name:"ECDH", namedCurve:"P-256"}, true, ["deriveBits","deriveKey"]);
}

/*REPLACED_DERIVE*/
  // peerPubB64 is base64 of raw public key (Uint8Array)
  const peerRaw = Uint8Array.from(atob(peerPubB64), c=>c.charCodeAt(0));
  const peerKey = await crypto.subtle.importKey("raw", peerRaw.buffer, {name:"ECDH", namedCurve:"P-256"}, true, []);
  const sharedBits = await crypto.subtle.deriveBits({name:"ECDH", public:peerKey}, privateKey, 256);
  // HKDF to derive AES-GCM key and HMAC key
  const hkKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey","deriveBits"]);
  const aesKey = await crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt:new Uint8Array(0), info:new TextEncoder().encode("CipherNexus AES")}, hkKey, {name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
  const hmacKey = await crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt:new Uint8Array(0), info:new TextEncoder().encode("CipherNexus HMAC")}, hkKey, {name:"HMAC", hash:"SHA-256", length:256}, true, ["sign","verify"]);
  return {aesKey, hmacKey};
}


export async function deriveSharedAESKeys(privateKey, peerPubB64, saltBytes){
  const peerRaw = Uint8Array.from(atob(peerPubB64), c=>c.charCodeAt(0));
  const peerKey = await crypto.subtle.importKey("raw", peerRaw.buffer, {name:"ECDH", namedCurve:"P-256"}, true, []);
  const sharedBits = await crypto.subtle.deriveBits({name:"ECDH", public:peerKey}, privateKey, 256);
  const hkKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey","deriveBits"]);
  const salt = saltBytes || new Uint8Array(0);
  const aesKey = await crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt:salt, info:new TextEncoder().encode("CipherNexus AES")}, hkKey, {name:"AES-GCM", length:256}, true, ["encrypt","decrypt"]);
  const hmacKey = await crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt:salt, info:new TextEncoder().encode("CipherNexus HMAC")}, hkKey, {name:"HMAC", hash:"SHA-256", length:256}, true, ["sign","verify"]);
  return {aesKey, hmacKey};
}
