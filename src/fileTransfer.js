
// --- UI Progress Helpers ---
function updateProgress(label, value){
    console.log("PROGRESS:", label, value);
}
function hideProgress(){
    console.log("Progress hidden");
}
// --- END UI Progress Helpers ---
// --- Automatic file encryption helpers (injected) ---
/*
This module now encrypts files before sending over WebRTC using AES-GCM.
It expects a CryptoKey (AES-GCM) available as `window.__CIPHERNEXUS_AES_KEY`.
If not present, files will be sent unencrypted.
Functions added:
  - encryptBlobForTransfer(blob) -> Promise<string>  (base64 payload)
  - decryptBlobFromTransfer(b64payload) -> Promise<Blob>
*/
const _b64FromBytes = (bytes)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const _bytesFromB64 = (b64)=>Uint8Array.from(atob(b64), c=>c.charCodeAt(0));

async function encryptBlobForTransfer(blob) {
  if(!window.__CIPHERNEXUS_AES_KEY) {
    // no key, send raw file as base64
    const buf = await blob.arrayBuffer();
    return 'RAW:' + _b64FromBytes(new Uint8Array(buf));
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await blob.arrayBuffer());
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, window.__CIPHERNEXUS_AES_KEY, data);
  const wrapped = new Uint8Array(iv.byteLength + cipher.byteLength);
  wrapped.set(iv,0); wrapped.set(new Uint8Array(cipher), iv.byteLength);
  return 'ENC:' + _b64FromBytes(wrapped);
}

async function decryptBlobFromTransfer(payload) {
  if(payload.startsWith('RAW:')) {
    const b = _bytesFromB64(payload.slice(4));
    return new Blob([b]);
  }
  if(!payload.startsWith('ENC:')) throw new Error('Invalid payload');
  const b = _bytesFromB64(payload.slice(4));
  const iv = b.slice(0,12);
  const cipher = b.slice(12);
  if(!window.__CIPHERNEXUS_AES_KEY) throw new Error('No AES key available to decrypt file');
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, window.__CIPHERNEXUS_AES_KEY, cipher);
  return new Blob([new Uint8Array(plain)]);
}
// --- end injection ---

import * as crypto from './crypto.js';
import { uploadFileChunk } from './storage.js';

export async function sendFileOverDC(dc, file, keys, roomStorageId){
  const chunkSize = 64 * 1024;
  const fileId = 'f_' + Math.random().toString(36).slice(2,9);
  const total = Math.ceil(file.size / chunkSize);

  // If a global AES key is present and the datachannel is open, send the whole file encrypted as a single payload.
  if(window.__CIPHERNEXUS_AES_KEY && dc && dc.readyState === 'open'){
    try{
      const payload = await encryptBlobForTransfer(file); // returns 'ENC:...' or 'RAW:...'
      // send a simple marker so receiver path handles it (we send the raw payload string)
      dc.send(payload);
      return fileId;
    }catch(e){
      console.warn('send full file failed, falling back to chunked send', e);
    }
  }

  for(let i=0;i<total;i++){
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const blob = file.slice(start,end);
    const arr = new Uint8Array(await blob.arrayBuffer());
    const enc = await crypto.aesEncryptRaw(keys.file, { seq:i, data: Array.from(arr), fileId, final: i===total-1 });
    try {
      if(dc && dc.readyState === 'open'){
        dc.send(JSON.stringify({ type:'file-chunk', fileId, seq:i, enc }));
      } else {
        await uploadFileChunk(roomStorageId, fileId, i, enc);
      }
    } catch(e){
      await uploadFileChunk(roomStorageId, fileId, i, enc);
    }
  }
  return fileId;
}


// Helper wrapper: call this to send a File/Blob through existing send function
export async function sendEncryptedFile(blob, sendFunc) {
  const payload = await encryptBlobForTransfer(blob);
  // sendFunc should accept a string or an ArrayBuffer; we'll send string
  return sendFunc(payload);
}

// Helper to receive payload string and obtain Blob
export async function receiveAndDecryptFile(payload) {
  return decryptBlobFromTransfer(payload);
}

// expose global helper for UI to call
window.sendEncryptedFile = async function(blob, sendFunc){ return await typeof exports !== 'undefined' && exports.sendEncryptedFile ? exports.sendEncryptedFile ? (await exports.sendEncryptedFile(blob, sendFunc)) : (await sendEncryptedFile(blob, sendFunc)); };

window.__CIPHERNEXUS_SENDFUNC = window.__CIPHERNEXUS_SENDFUNC || function(payload){ console.warn('No send function set for CipherNexus'); };
