import argon2 from 'argon2-browser'

export async function sha256Hex(s){
  const enc = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function deriveStorageKey(roomCode, pepper=''){
  return await sha256Hex(roomCode + '::' + (pepper||''));
}

export async function deriveMasterKey(roomCode, storageKeyHex, ops=3, memKB=65536){
  const res = await argon2.hash({ pass: roomCode, salt: storageKeyHex, time: ops, mem: memKB, hashLen: 32, parallelism:1, type: argon2.ArgonType.Argon2id });
  const raw = atob(res.hash);
  const arr = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
  return arr;
}

async function hkdf(ikm, info, length=32){
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const salt = new Uint8Array(32);
  const bits = await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt, info: new TextEncoder().encode(info) }, key, length*8);
  return new Uint8Array(bits);
}

export async function deriveSubkeys(masterBytes){
  const chat = await hkdf(masterBytes, 'ultra-chat', 32);
  const signal = await hkdf(masterBytes, 'ultra-signal', 32);
  const meta = await hkdf(masterBytes, 'ultra-meta', 32);
  const auth = await hkdf(masterBytes, 'ultra-auth', 32);
  const file = await hkdf(masterBytes, 'ultra-file', 32);
  return { chat, signal, meta, auth, file };
}

export async function aesEncryptRaw(keyBytes, obj){
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return btoa(JSON.stringify({ iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) }));
}

export async function aesDecryptRaw(keyBytes, envelopeB64){
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const env = JSON.parse(atob(envelopeB64));
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: new Uint8Array(env.iv) }, key, new Uint8Array(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
