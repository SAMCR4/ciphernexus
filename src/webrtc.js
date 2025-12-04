import { insertSignal } from './storage.js';
import * as crypto from './crypto.js';
import { receiveAndDecryptFile } from './fileTransfer.js';

const rtcConfig = { iceServers:[{ urls:'stun:stun.l.google.com:19302' }] };
const peers = {};

export async function ensurePeer(peerId, isInitiator, localStream, roomStorageId, keys, onMessage){
  if(peers[peerId]) return peers[peerId];
  const pc = new RTCPeerConnection(rtcConfig);
  const remote = new MediaStream();
  let dc = null;
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  if(isInitiator){
    dc = pc.createDataChannel('ultra');
    setupDC(peerId, dc, keys, onMessage);
  } else {
    pc.ondatachannel = e => setupDC(peerId, e.channel, keys, onMessage);
  }
  pc.ontrack = e => {
    e.streams[0].getTracks().forEach(t=>remote.addTrack(t));
    const vid = document.createElement('div'); vid.className='vid';
    const title = document.createElement('div'); title.style.padding='6px'; title.style.color='#0f0'; title.innerText = 'Peer:' + peerId;
    const v = document.createElement('video'); v.autoplay=true; v.playsInline=true;
    v.srcObject = remote;
    vid.appendChild(title); vid.appendChild(v);
    document.getElementById('videos').appendChild(vid);
    peers[peerId].videoEl = v;
  };
  pc.onicecandidate = e => {
    if(e.candidate){
      (async ()=>{
        const payload = { type:'ice', from: window._ultra_runtime.localId, to: peerId, candidate: e.candidate };
        const enc = await crypto.aesEncryptRaw(keys.signal, payload);
        await insertSignal(roomStorageId, { type:'enc', from: window._ultra_runtime.localId, to: peerId, body: enc });
      })();
    }
  };
  pc.onconnectionstatechange = ()=>{ if(pc.connectionState==='failed' || pc.connectionState==='disconnected') { try{ pc.close(); }catch(e){} delete peers[peerId]; }};
  peers[peerId] = { pc, dc, remote, videoEl:null };
  if(isInitiator){
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const payload = { type:'sdp-offer', from: window._ultra_runtime.localId, to: peerId, sdp: pc.localDescription };
    const enc = await crypto.aesEncryptRaw(keys.signal, payload);
    await insertSignal(roomStorageId, { type:'enc', from: window._ultra_runtime.localId, to: peerId, body: enc });
  }
  return peers[peerId];
}

function setupDC(peerId, dc, keys, onMessage){
  dc.onopen = ()=>{ console.log('dc open', peerId); window.__CIPHERNEXUS_SENDFUNC = (payload)=>{ try{ dc.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); }catch(e){ console.warn('dc send failed',e); } }; };
  dc.onmessage = async ev => {
    let data = null;
    try { data = JSON.parse(ev.data); } catch(e){
      try { data = await crypto.aesDecryptRaw(keys.auth, ev.data); } catch(e){
        // not JSON and not channel-encrypted; check for our file-transfer payloads
        try{
          if(typeof ev.data === 'string' && (ev.data.startsWith('ENC:') || ev.data.startsWith('RAW:'))){
            const blob = await receiveAndDecryptFile(ev.data);
            onMessage && onMessage({ type: 'file-full', from: peerId, blob });
            return;
          }
        }catch(ee){ console.warn('dc file decrypt', ee); }
        console.warn('dc decrypt', e); return; }
    }
    if(data && data.type==='chat'){ onMessage && onMessage(data); }
    if(data && data.type==='file-chunk'){ onMessage && onMessage(data); }
  };
  peers[peerId].dc = dc;
}

export async function handleSignalRow(row, roomStorageId, keys, localStream, onMessage){
  try {
    const payload = JSON.parse(row.payload);
    if(payload.type==='enc' && payload.body){
      let dec;
      try { dec = await crypto.aesDecryptRaw(keys.signal, payload.body); } catch(e){ return; }
      if(dec.type==='sdp-offer' && dec.to===window._ultra_runtime.localId){
        await ensurePeer(dec.from, false, localStream, roomStorageId, keys, onMessage);
        const pc = peers[dec.from].pc;
        await pc.setRemoteDescription(dec.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        const r = { type:'sdp-answer', from: window._ultra_runtime.localId, to: dec.from, sdp: pc.localDescription };
        const enc = await crypto.aesEncryptRaw(keys.signal, r);
        await insertSignal(roomStorageId, { type:'enc', from: window._ultra_runtime.localId, to: dec.from, body: enc });
      } else if(dec.type==='sdp-answer' && dec.to===window._ultra_runtime.localId){
        if(peers[dec.from]) peers[dec.from].pc.setRemoteDescription(dec.sdp);
      } else if(dec.type==='ice' && dec.to===window._ultra_runtime.localId){
        if(peers[dec.from]) try{ await peers[dec.from].pc.addIceCandidate(dec.candidate); } catch(e){ console.warn(e); }
      }
    }
  } catch(e){ console.warn('handleSignalRow', e); }
}



// === DataChannel encryption wrapper ===
async function cnSendEncrypted(dc, obj){
  try{
    if(!window.__CIPHERNEXUS_AES_KEY){ dc.send(JSON.stringify(obj)); return; }
    const enc = await window.cryptoHelpers.encryptMessage(window.__CIPHERNEXUS_AES_KEY, JSON.stringify(obj));
    dc.send(JSON.stringify({__enc:1, iv:enc.iv, ct:enc.ct}));
  }catch(e){ console.error('cnSendEncrypted',e); dc.send(JSON.stringify(obj)); }
}
async function cnHandleIncoming(raw, onMessage){
  try{
    const o = JSON.parse(raw);
    if(o && o.__enc && window.__CIPHERNEXUS_AES_KEY){
      const pt = await window.cryptoHelpers.decryptMessage(window.__CIPHERNEXUS_AES_KEY, o.iv, o.ct);
      if(pt) onMessage(JSON.parse(pt));
      else console.warn('decryption failed');
    } else {
      onMessage(o);
    }
  }catch(e){ console.error('cnHandleIncoming',e); }
}
// patch existing DC send hooks: look for createDataChannel or dc.send usage - add wrapper



// === CipherNexus signaling & DC encryption wrappers ===
// Wraps sending signaling messages through server with optional AES encryption
async function sendSignaling(serverSendFunc, obj){
  try{
    if(window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.encrypt && window.__CIPHER_SIGNING.key){
      const enc = await window.cryptoHelpers.aesEncrypt(window.__CIPHER_SIGNING.key, obj);
      serverSendFunc({__enc_sign:1, iv:enc.iv, ct:enc.ct});
    } else {
      serverSendFunc(obj);
    }
  }catch(e){ console.error('sendSignaling err', e); serverSendFunc(obj); }
}

// Decrypt incoming signaling if required
async function handleIncomingSignaling(raw, handler){
  try{
    if(raw && raw.__enc_sign && window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.key){
      const pt = await window.cryptoHelpers.aesDecrypt(window.__CIPHER_SIGNING.key, raw.iv, raw.ct);
      if(pt) handler(pt);
      else console.warn('failed to decrypt signaling');
    } else {
      handler(raw);
    }
  }catch(e){ console.error('handleIncomingSignaling', e); handler(raw); }
}

// DataChannel encryption for app-level messages
async function dcSendEncrypted(dc, obj){
  try{
    if(window.__CIPHERNEXUS_AES_KEY){
      const enc = await window.cryptoHelpers.aesEncrypt(window.__CIPHERNEXUS_AES_KEY, obj);
      dc.send(JSON.stringify({__enc:1, iv:enc.iv, ct:enc.ct}));
    } else {
      dc.send(JSON.stringify(obj));
    }
  }catch(e){ console.error('dcSendEncrypted', e); dc.send(JSON.stringify(obj)); }
}
async function dcHandleIncoming(raw, onMessage){
  try{
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if(o && o.__enc && window.__CIPHERNEXUS_AES_KEY){
      const pt = await window.cryptoHelpers.aesDecrypt(window.__CIPHERNEXUS_AES_KEY, o.iv, o.ct);
      if(pt) onMessage(pt); else console.warn('dc decryption failed');
    } else {
      onMessage(o);
    }
  }catch(e){ console.error('dcHandleIncoming', e); }
}



/* === PART A2: Secure Encrypted DataChannel Messaging ===
   These helpers wrap dc.send() and incoming messages with AES-GCM encryption
   using window.__CIPHERNEXUS_AES_KEY, derived from Argon2 during login.
*/

async function CN_DC_Encrypt_WithHMAC(dc, payload){
  try{
    if(!window.__CIPHERNEXUS_AES_KEY){
      dc.send(JSON.stringify(payload));
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, window.__CIPHERNEXUS_AES_KEY, encoded);
    dc.send(JSON.stringify({
        __enc__: true,
        iv: Array.from(iv),
        ct: Array.from(new Uint8Array(ct))
    }));
  }catch(e){
    console.error("CN_DC_Encrypt error:", e);
    dc.send(JSON.stringify(payload));
  }
}

async function CN_DC_Decrypt(raw, onMessage){
  try{
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if(obj.__enc__ && window.__CIPHERNEXUS_AES_KEY){
        const iv = new Uint8Array(obj.iv);
        const ct = new Uint8Array(obj.ct);
        const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv}, window.__CIPHERNEXUS_AES_KEY, ct);
        const msg = JSON.parse(new TextDecoder().decode(pt));
        onMessage(msg);
    } else {
        onMessage(obj);
    }
  }catch(e){
    console.error("CN_DC_Decrypt error:", e);
  }
}

/* Attach encrypted message handler if DC exists */
if (typeof window !== "undefined") {
    window.CN_DC_Encrypt = CN_DC_Encrypt;
    window.CN_DC_Decrypt = CN_DC_Decrypt;
}



// === PART A3: Encrypted signaling helpers (SDP/ICE) ===
// Wrap signaling sends to encrypt SDP/ICE payloads using AES-GCM.
// Caller should set window.__CIPHER_SIGNING.key to the CryptoKey (AES-GCM) derived at login.

async function CN_Signaling_EncryptWithHMAC(serverSendFunc, payload){
  try{
    if(window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.key){
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pt = new TextEncoder().encode(JSON.stringify(payload));
      const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, window.__CIPHER_SIGNING.key, pt);
      serverSendFunc({__enc_sign:1, iv:Array.from(iv), ct:Array.from(new Uint8Array(ct))});
    } else {
      serverSendFunc(payload);
    }
  }catch(e){ console.error('CN_Signaling_EncryptAndSend', e); serverSendFunc(payload); }
}

async function CN_Signaling_HandleIncoming(raw, handler){
  try{
    // raw may be already parsed object
    const o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if(o && o.__enc_sign && window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.key){
      const iv = new Uint8Array(o.iv);
      const ct = new Uint8Array(o.ct);
      const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, window.__CIPHER_SIGNING.key, ct);
      const msg = JSON.parse(new TextDecoder().decode(pt));
      handler(msg);
    } else {
      handler(o);
    }
  }catch(e){ console.error('CN_Signaling_HandleIncoming', e); handler(raw); }
}

// helper to derive a short session key for signaling from the main AES key (HKDF)
async function CN_Derive_SigningKeyFromAES(mainAesKey){
  try{
    // derive 256-bit key via HKDF info "CipherNexus Signaling"
    const raw = await crypto.subtle.exportKey('raw', mainAesKey);
    const hk = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const sigKey = await crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:new Uint8Array(0), info:new TextEncoder().encode('CipherNexus Signaling')}, hk, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    return sigKey;
  }catch(e){ console.warn('derive signing key failed', e); return null; }
}

// expose globally
if(typeof window !== 'undefined'){
  window.CN_Signaling_EncryptAndSend = CN_Signaling_EncryptAndSend;
  window.CN_Signaling_HandleIncoming = CN_Signaling_HandleIncoming;
  window.CN_Derive_SigningKeyFromAES = CN_Derive_SigningKeyFromAES;
}



// === Integrate HMAC signing into DC/Signaling ===
// Wrap payload encryption to include HMAC signature
async function CN_DC_Encrypt_WithHMAC(dc, payload){
  try{
    if(!window.__CIPHERNEXUS_AES_KEY){
      dc.send(JSON.stringify(payload)); return;
    }
    const enc = await window.cryptoHelpers.aesEncrypt(window.__CIPHERNEXUS_AES_KEY, payload);
    // create a verification blob: iv || ct bytes
    const ivBytes = new Uint8Array(enc.iv);
    const ctBytes = new Uint8Array(enc.ct);
    const combined = new Uint8Array(ivBytes.length + ctBytes.length);
    combined.set(ivBytes, 0); combined.set(ctBytes, ivBytes.length);
    const sig = await window.cryptoHelpers.CN_HMAC_Sign(combined);
    dc.send(JSON.stringify({__enc__:1, iv:enc.iv, ct:enc.ct, sig:sig}));
  }catch(e){ console.error('CN_DC_Encrypt_WithHMAC', e); dc.send(JSON.stringify(payload)); }
}

async function CN_DC_Decrypt_WithHMAC(raw, onMessage){
  try{
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if(o && o.__enc__){
      // verify signature first
      const ivBytes = new Uint8Array(o.iv);
      const ctBytes = new Uint8Array(o.ct);
      const combined = new Uint8Array(ivBytes.length + ctBytes.length);
      combined.set(ivBytes, 0); combined.set(ctBytes, ivBytes.length);
      const ok = await window.cryptoHelpers.CN_HMAC_Verify(combined, o.sig || '');
      if(!ok){ console.warn('HMAC verification failed'); return; }
      const pt = await window.cryptoHelpers.aesDecrypt(window.__CIPHERNEXUS_AES_KEY, o.iv, o.ct);
      if(pt) onMessage(pt); else console.warn('decryption returned null');
    } else {
      onMessage(o);
    }
  }catch(e){ console.error('CN_DC_Decrypt_WithHMAC', e); }
}

// similarly for signaling
async function CN_Signaling_EncryptWithHMAC(serverSendFunc, payload){
  try{
    if(window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.key){
      const enc = await window.cryptoHelpers.aesEncrypt(window.__CIPHER_SIGNING.key, payload);
      const ivBytes = new Uint8Array(enc.iv);
      const ctBytes = new Uint8Array(enc.ct);
      const combined = new Uint8Array(ivBytes.length + ctBytes.length);
      combined.set(ivBytes, 0); combined.set(ctBytes, ivBytes.length);
      const sig = await window.cryptoHelpers.CN_HMAC_Sign(combined);
      serverSendFunc({__enc_sign:1, iv:enc.iv, ct:enc.ct, sig:sig});
    } else {
      serverSendFunc(payload);
    }
  }catch(e){ console.error('CN_Signaling_EncryptWithHMAC', e); serverSendFunc(payload); }
}

async function CN_Signaling_HandleIncomingWithHMAC(raw, handler){
  try{
    const o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if(o && o.__enc_sign){
      const ivBytes = new Uint8Array(o.iv);
      const ctBytes = new Uint8Array(o.ct);
      const combined = new Uint8Array(ivBytes.length + ctBytes.length);
      combined.set(ivBytes, 0); combined.set(ctBytes, ivBytes.length);
      const ok = await window.cryptoHelpers.CN_HMAC_Verify(combined, o.sig || '');
      if(!ok){ console.warn('Signaling HMAC verify failed'); return; }
      const pt = await window.cryptoHelpers.aesDecrypt(window.__CIPHER_SIGNING.key, o.iv, o.ct);
      if(pt) handler(pt); else console.warn('Signaling decrypt returned null');
    } else {
      handler(o);
    }
  }catch(e){ console.error('CN_Signaling_HandleIncomingWithHMAC', e); handler(raw); }
}

// expose functions
if(typeof window !== 'undefined'){
  window.CN_DC_Encrypt_WithHMAC = CN_DC_Encrypt_WithHMAC;
  window.CN_DC_Decrypt_WithHMAC = CN_DC_Decrypt_WithHMAC;
  window.CN_Signaling_EncryptWithHMAC = CN_Signaling_EncryptWithHMAC;
  window.CN_Signaling_HandleIncomingWithHMAC = CN_Signaling_HandleIncomingWithHMAC;
}


// === C1.4 hooks: attempt to enable insertable streams on senders/receivers ===
async function CN_AttemptEnableInsertableOnPC(pc){
  try{
    if(!pc) return;
    // enable on existing senders
    (pc.getSenders()||[]).forEach(async (s)=>{
      try{
        if(s.track && s.track.kind === 'video' && window.__CIPHERNEXUS_AES_KEY){
          await window.CN_EnableSenderE2EEncryption(s, window.__CIPHERNEXUS_AES_KEY);
        }
      }catch(e){}
    });
    // enable on existing receivers
    (pc.getReceivers()||[]).forEach(async (r)=>{
      try{
        if(r.track && r.track.kind === 'video' && window.__CIPHERNEXUS_AES_KEY){
          await window.CN_EnableReceiverE2EDecryption(r, window.__CIPHERNEXUS_AES_KEY);
        }
      }catch(e){}
    });

    // monitor future senders/receivers
    pc.addEventListener('track', async (ev)=>{
      try{
        const r = ev.receiver;
        if(r && r.track && r.track.kind==='video' && window.__CIPHERNEXUS_AES_KEY){
          await window.CN_EnableReceiverE2EDecryption(r, window.__CIPHERNEXUS_AES_KEY);
        }
        // attach to UI
        if(ev.streams && ev.streams[0]){
          window.cnAddRemoteStream && window.cnAddRemoteStream(ev.streams[0], 'peer-'+Math.random().toString(36).slice(2,8));
        }
      }catch(e){ console.warn('track handler', e); }
    });
  }catch(e){ console.warn('CN_AttemptEnableInsertableOnPC', e); }
}

// call when PC is created or AES key set
if(typeof window !== 'undefined'){
  window.CN_AttemptEnableInsertableOnPC = CN_AttemptEnableInsertableOnPC;
}


// === C1/C2 polish: enable audio insertable transforms when key present ===
if(typeof window !== 'undefined'){
  const old = window.CN_AttemptEnableInsertableOnPC;
  window.CN_AttemptEnableInsertableOnPC = async function(pc){
    try{ await old(pc); }catch(e){}
    try{
      (pc.getSenders()||[]).forEach(async (s)=>{
        try{ if(s.track && s.track.kind==='audio' && window.__CIPHERNEXUS_AES_KEY){ await window.CN_EnableSenderAudioE2E(s, window.__CIPHERNEXUS_AES_KEY); } }catch(e){}
      });
      (pc.getReceivers()||[]).forEach(async (r)=>{ try{ if(r.track && r.track.kind==='audio' && window.__CIPHERNEXUS_AES_KEY){ await window.CN_EnableReceiverAudioE2E(r, window.__CIPHERNEXUS_AES_KEY); } }catch(e){} });
    }catch(e){}
  };
}


// === SIGNALING WRAPPER: use CN_Signaling_EncryptWithHMAC when sending to server ===
function CN_Signaling_Send(serverSendFunc, payload){
  try{
    if(window.CN_Signaling_EncryptWithHMAC && window.__CIPHER_SIGNING && window.__CIPHER_SIGNING.key){
      CN_Signaling_EncryptWithHMAC(serverSendFunc, payload);
    } else if(window.CN_Signaling_EncryptAndSend){
      CN_Signaling_EncryptAndSend(serverSendFunc, payload);
    } else {
      serverSendFunc(payload);
    }
  }catch(e){ console.warn('CN_Signaling_Send', e); serverSendFunc(payload); }
}
// best-effort replace common signaling function names (no guarantees)
if(typeof window !== 'undefined') window.CN_Signaling_Send = CN_Signaling_Send;



// === E4: Signaling retry queue & resilient reconnect ===
window.CN_SignalingQueue = window.CN_SignalingQueue || (function(){
  const q = []; let sending=false; async function sendWrapped(serverSendFunc, payload){
    q.push({serverSendFunc, payload, attempts:0}); process(); }
  async function process(){ if(sending) return; sending=true; while(q.length){ const item=q[0]; try{ item.attempts++; item.serverSendFunc(item.payload); q.shift(); }catch(e){ console.warn('signal send failed', e); if(item.attempts>5){ q.shift(); } else { await new Promise(r=>setTimeout(r, Math.min(2000*item.attempts, 30000))); } } } sending=false; }
  return {enqueue:sendWrapped, length:()=>q.length};
})();
// expose helper to use queue
function CN_Signaling_Enqueue(serverSendFunc, payload){ try{ window.CN_SignalingQueue.enqueue(serverSendFunc, payload);}catch(e){ serverSendFunc(payload);} }
window.CN_Signaling_Enqueue = CN_Signaling_Enqueue;
