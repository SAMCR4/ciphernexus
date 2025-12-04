
/* --- QR: Full session payload with signing + compression --- */
async function makeSessionQRPayload(room, saltB64u, pubKeyBytes){
  return {
    v:1,
    room,
    salt:saltB64u,
    pub: pubKeyBytes ? base64UrlEncode(pubKeyBytes) : "",
    ts: Math.floor(Date.now()/1000)
  };
}
async function signQRPayload(payload){
  if(!window.__CIPHERNEXUS_AES_KEY) return "";
  const enc=new TextEncoder();
  const data=enc.encode(JSON.stringify(payload));
  const sig=await crypto.subtle.sign({name:"HMAC", hash:"SHA-256"}, window.__CIPHERNEXUS_AES_KEY, data);
  return base64UrlEncode(new Uint8Array(sig));
}
function compressQRString(s){
  // trivial compression placeholder; real LZ could be added
  return btoa(unescape(encodeURIComponent(s)));
}
function renderRealQR(qrStr){
  const el=document.createElement("div");
  el.style.display="none";
  document.body.appendChild(el);
  new QRCode(el,{text:qrStr, width:160, height:160, correctLevel:QRCode.CorrectLevel.M});
  const img=el.querySelector("img");
  if(img){
    const canvas=document.getElementById("qrCanvas");
    const ctx=canvas.getContext("2d");
    const tmp=new Image();
    tmp.onload=()=>{ ctx.drawImage(tmp,0,0,160,160); document.body.removeChild(el); };
    tmp.src=img.src;
  } else document.body.removeChild(el);
}
/* --- END QR --- */


// --- AES Key Export/Import ---


// --- END AES Key Export/Import ---

import * as cryptoMod from './crypto.js';

const $ = (id)=>document.getElementById(id);
const roomInput = $('roomCode');
const deriveBtn = $('deriveBtn');
const encryptBtn = $('encryptBtn');
const decryptBtn = $('decryptBtn');
const plaintext = $('plaintext');
const result = $('result');

let session = { key: null, salt: null };

deriveBtn.addEventListener('click', async ()=>{
  const pass = roomInput.value || prompt('Enter a room code / password:');
  if(!pass) return alert('Password required');
  result.textContent = 'Deriving key (Argon2 + HKDF) — this may take a moment...';
  try{
    const r = await cryptoMod.deriveAesKeyFromPassword(pass);
    session.key = r.key;
    session.salt = r.salt;
    // expose raw AES key for file encryption (export to raw then import as AES-GCM key if needed)
    try{
      window.__CIPHERNEXUS_AES_KEY = session.key;
    }catch(e){console.warn('Could not set global AES key',e)}
    result.textContent = 'Key derived. Salt (base64): ' + session.salt;
  }catch(e){
    console.error(e);
    result.textContent = 'Derivation failed: ' + e.message;
  }
});

encryptBtn.addEventListener('click', async ()=>{
  if(!session.key) return alert('Derive a key first (click Derive & Test)');
  try{
    const ct = await cryptoMod.encryptString(session.key, plaintext.value || '');
    result.textContent = 'Ciphertext (base64):\\n' + ct;
  }catch(e){
    console.error(e);
    result.textContent = 'Encrypt failed: ' + e.message;
  }
});

decryptBtn.addEventListener('click', async ()=>{
  if(!session.key) return alert('Derive a key first (click Derive & Test)');
  const payload = prompt('Paste base64 payload to decrypt (iv+cipher)');
  if(!payload) return;
  try{
    const pt = await cryptoMod.decryptString(session.key, payload.trim());
    result.textContent = 'Plaintext:\\n' + pt;
  }catch(e){
    console.error(e);
    result.textContent = 'Decrypt failed: ' + e.message;
  }
});

// Small runtime tip: store session.salt and exported key if you want to persist across reloads.
// You can export via cryptoMod.exportKeyToRaw and re-import later.


// --- UI integration: export/import keys, drag-drop, session export, QR render ---
 const raw = await crypto.subtle.exportKey('raw', window.__CIPHERNEXUS_AES_KEY); const b64 = btoa(String.fromCharCode(...new Uint8Array(raw))); const blob = new Blob([b64],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='ciphernexus-key.txt'; a.click(); URL.revokeObjectURL(url); }catch(e){console.error(e)} }
 window.__CIPHERNEXUS_AES_KEY = key; alert('Key imported'); }catch(e){console.error(e); alert('Import failed') } }

function base64UrlEncode(bytes){ const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes))); return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function base64UrlDecode(b64u){ b64u = b64u.replace(/-/g,'+').replace(/_/g,'/'); while(b64u.length%4) b64u += '='; const str = atob(b64u); return Uint8Array.from(str, c=>c.charCodeAt(0)); }

function makeSessionLink(roomCode, saltB64u){ const p = encodeURIComponent(roomCode + ':' + saltB64u); return location.origin + location.pathname + '#session=' + p; }

function renderSessionQR(text){ try{ const canvas = document.getElementById('qrCanvas'); if(!canvas) return; const ctx = canvas.getContext('2d'); ctx.fillStyle='#021022'; ctx.fillRect(0,0,canvas.width, canvas.height); ctx.fillStyle='#a6d0f0'; ctx.font='10px monospace'; ctx.textAlign='center'; ctx.fillText('Session:', canvas.width/2, 20); const lines = text.match(/.{1,20}/g)||[text]; for(let i=0;i<lines.length;i++) ctx.fillText(lines[i], canvas.width/2, 40 + i*12); }catch(e){console.warn('qr render',e)} }

document.addEventListener('DOMContentLoaded', ()=>{
  const exportBtn = document.getElementById('exportKeyBtn');
  const importBtn = document.getElementById('importKeyBtn');
  const importFile = document.getElementById('importKeyFile');
  const drop = document.getElementById('dropZone');
  const copyBtn = document.getElementById('copySessionBtn');
  const sessionInput = document.getElementById('sessionLink');
  const progressWrap = document.getElementById('fileProgressWrap');
  const progressBar = document.getElementById('fileProgressBar');
  const progressLabel = document.getElementById('fileProgressLabel');

  exportBtn && (exportBtn.onclick = exportAESKey);
  importBtn && (importBtn.onclick = ()=> importFile.click());
  importFile && (importFile.onchange = (ev)=> { if(ev.target.files && ev.target.files[0]) importAESKeyFromFile(ev.target.files[0]); });

  // drag-drop handlers
  if(drop){
    drop.addEventListener('click', ()=>{ const ip = document.createElement('input'); ip.type='file'; ip.onchange = async (e)=>{ if(e.target.files[0]) await handleFileSend(e.target.files[0]); }; ip.click(); });
    drop.addEventListener('dragover', (e)=>{ e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', (e)=>{ e.preventDefault(); drop.classList.remove('dragover'); });
    drop.addEventListener('drop', async (e)=>{ e.preventDefault(); drop.classList.remove('dragover'); if(e.dataTransfer.files && e.dataTransfer.files[0]) await handleFileSend(e.dataTransfer.files[0]); });
  }

  async function handleFileSend(file){
    try{
      progressWrap.style.display='block';
      progressLabel.textContent = 'Encrypting...';
      progressBar.style.width = '10%';
      // use global helper if available
      if(window.__CIPHERNEXUS_AES_KEY && typeof window.sendEncryptedFile === 'function'){
        progressLabel.textContent = 'Sending encrypted (single message)...';
        progressBar.style.width = '60%';
        // sendEncryptedFile should call underlying data channel send; expose via global in fileTransfer
        await window.sendEncryptedFile(file, window.__CIPHERNEXUS_SENDFUNC || (payload=>{ console.warn('No send function'); }));
        progressBar.style.width = '100%';
        progressLabel.textContent = 'Sent';
        setTimeout(()=>{ progressWrap.style.display='none'; progressBar.style.width='0%'; }, 800);
      } else {
        // fallback: read as arraybuffer and call fileTransfer API if available
        progressLabel.textContent = 'Fallback upload (chunked)';
        progressBar.style.width='30%';
        if(window.sendFileChunkFallback) await window.sendFileChunkFallback(file, (p)=>{ progressBar.style.width = p + '%'; });
        progressBar.style.width='100%';
        progressLabel.textContent = 'Uploaded';
        setTimeout(()=>{ progressWrap.style.display='none'; progressBar.style.width='0%'; }, 800);
      }
    }catch(e){ console.error(e); alert('Send failed'); progressWrap.style.display='none'; }
  }

  // session link generation: pack room code + salt (if present)
  const roomInput = document.getElementById('roomCode');
  const deriveBtn = document.getElementById('deriveBtn');
  if(deriveBtn && roomInput){
    deriveBtn.addEventListener('click', async ()=>{
      const pass = roomInput.value || prompt('Enter room code / password:');
      if(!pass) return;
      const r = await window.cryptoMod?.deriveAesKeyFromPassword?.(pass) || (await (async ()=>{ const o = await window.cryptoMod.deriveAesKeyFromPassword(pass); return o; })());
      // if deriveAesKeyFromPassword returns salt in base64, convert to base64url
      const saltB64 = r && r.salt ? r.salt : '';
      const saltB64u = saltB64 ? saltB64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') : '';
      const link = makeSessionLink(pass, saltB64u);
      sessionInput.value = link;
      renderSessionQR(link);
    });
  }

  copyBtn && (copyBtn.onclick = ()=>{ if(sessionInput.value){ navigator.clipboard?.writeText(sessionInput.value).then(()=>alert('Copied')); } });
});
// --- end UI integration ---


// --- QR Scanner Logic ---
async function startQRScanner(){
  const modal=document.getElementById("qrScanModal");
  modal.style.display="flex";
  const video=document.getElementById("qrVideo");
  const status=document.getElementById("qrScanStatus");
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    video.srcObject=stream;
    const canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d");
    const scanLoop=()=>{
      if(video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth;
        canvas.height=video.videoHeight;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
        const code=window.jsQR(imgData.data, canvas.width, canvas.height);
        if(code){
          status.textContent="QR detected!";
          stopQRScanner();
          processQRString(code.data);
          return;
        }
      }
      requestAnimationFrame(scanLoop);
    };
    requestAnimationFrame(scanLoop);
  }catch(e){ status.textContent="Camera error"; }
}
function stopQRScanner(){
  const modal=document.getElementById("qrScanModal");
  modal.style.display="none";
  const video=document.getElementById("qrVideo");
  if(video.srcObject){
    video.srcObject.getTracks().forEach(t=>t.stop());
    video.srcObject=null;
  }
}
document.getElementById("qrScanStop").onclick=stopQRScanner;
document.getElementById("qrScanImage").onclick=()=>document.getElementById("qrImageFile").click();
document.getElementById("qrImageFile").onchange=async(e)=>{
  if(!e.target.files[0])return;
  const img=new Image();
  img.onload=()=>{
    const canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d");
    canvas.width=img.width; canvas.height=img.height;
    ctx.drawImage(img,0,0);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const code=window.jsQR(data.data, canvas.width, canvas.height);
    if(code) processQRString(code.data);
    else alert("No QR found");
  };
  img.src=URL.createObjectURL(e.target.files[0]);
};

async function processQRString(qr){
  try{
    const payloadStr=decodeURIComponent(atob(qr));
    const obj=JSON.parse(payloadStr);
    alert("QR loaded: Room="+obj.room+" Salt="+obj.salt);
  }catch(e){ console.error(e); alert("Invalid QR"); }
}
// --- END QR Scanner Logic ---

import LZString from "./lib/compression/lz-string.js";
import { verifyHMAC } from "./crypto.js";

app.handleScannedQR = async function(raw){
  try{
    let dec = LZString.decompressFromUTF16(raw) || raw;
    const obj = JSON.parse(dec);

    // build message for HMAC
    const core = JSON.stringify({
      v:obj.v, room:obj.room, salt:obj.salt,
      pub:obj.pub, ts:obj.ts
    });

    if(obj.sig){
      const ok = await verifyHMAC(app.hmacKey, core, obj.sig);
      if(!ok){ alert("Invalid QR signature"); return; }
    }

    document.getElementById("roomInput").value = obj.room;

    // Auto WebRTC pairing stub
    if(obj.pub){
      app.remotePub = obj.pub;
    }
    app.joinRoom(obj.room);

  }catch(e){ console.error(e); }
};


import LZString from "./lib/compression/lz-string.js";
import { verifyHMAC } from "./crypto.js";

app.generateSessionQR = async function(){
  const room = document.getElementById("roomInput").value.trim();
  const pub = app.localPub || "";
  const salt = app.salt || "";
  const ts = Date.now();

  const payloadCore = { v:1, room, salt, pub, ts };
  const coreStr = JSON.stringify(payloadCore);

  // Sign with HMAC
  let sigB64 = "";
  if(app.hmacKey){
    const sigBuf = await crypto.subtle.sign("HMAC", app.hmacKey, new TextEncoder().encode(coreStr));
    sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  }

  const full = JSON.stringify({...payloadCore, sig: sigB64 });

  // Compress
  const compressed = LZString.compressToUTF16(full);

  // Expose for UI display
  app.lastQRPayload = compressed;

  return compressed;
};



if(!window.app) window.app = {};
window.app.joinRoom = async function(room){
  console.log('Joining room', room);
  if(window.__LOCAL_STREAM && window.__PC){
    window.__LOCAL_STREAM.getTracks().forEach(t=>{ try{ window.__PC.addTrack(t, window.__LOCAL_STREAM); }catch(e){} });
  }
  const vg = document.getElementById('videoGrid');
  if(vg){
    const box=document.createElement('div'); box.className='video-box';
    const v=document.createElement('video'); v.autoplay=true; v.playsInline=true; box.appendChild(v);
    vg.appendChild(box);
  }
};
window.app.leaveRoom = function(){
  console.log('Leaving room');
  if(window.__PC){
    try{ window.__PC.getSenders().forEach(s=>{ if(s.track) s.track.stop(); }); window.__PC.close(); }catch(e){} window.__PC=null;
  }
  if(window.__LOCAL_STREAM){ window.__LOCAL_STREAM.getTracks().forEach(t=>t.stop()); window.__LOCAL_STREAM=null; }
};



// === Multi-peer remote stream handling and media controls ===

window.cnAddRemoteStream = function(stream, id){
  const vg = document.getElementById('videoGrid');
  if(!vg) return;
  const box = document.createElement('div'); box.className='video-box cn-fade-in'; box.dataset.peer=id;
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.srcObject = stream;
  v.style.width='100%'; v.style.height='100%'; v.muted=false;
  const overlay = document.createElement('div'); overlay.style.position='absolute'; overlay.style.left='8px'; overlay.style.top='8px';
  const mute = document.createElement('button'); mute.textContent='Mute'; mute.className='button'; mute.onclick=()=>{ v.muted = !v.muted; mute.textContent = v.muted ? 'Unmute':'Mute'; };
  overlay.appendChild(mute);
  box.appendChild(v); box.appendChild(overlay);
  vg.appendChild(box);
};

  const vg = document.getElementById('videoGrid');
  if(!vg) return;
  const box = document.createElement('div'); box.className='video-box'; box.dataset.peer=id;
  const v = document.createElement('video'); v.autoplay=true; v.playsInline=true; v.srcObject = stream;
  box.appendChild(v);
  // controls overlay
  const ctrl = document.createElement('div'); ctrl.style.position='absolute'; ctrl.style.right='8px'; ctrl.style.top='8px';
  const mute = document.createElement('button'); mute.textContent='Mute'; mute.onclick=()=>{ if(v.muted){ v.muted=false; mute.textContent='Mute'; } else { v.muted=true; mute.textContent='Unmute'; } };
  ctrl.appendChild(mute);
  box.appendChild(ctrl);
  vg.appendChild(box);
};
// hook: when remote track arrives, call cnAddRemoteStream(peerStream, peerId)
if(!window.app) window.app = {};



// C1.2 hook: initialize video controls after auth
if(window.app){ window.app.onAuth = window.app.onAuth || function(info){ try{ setTimeout(()=>{ if(window.CN_UI_InitVideoControls) window.CN_UI_InitVideoControls(); }, 200); }catch(e){} }; }


// === C1.5: Auto-retry ICE on connection failure ===
(function(){
  if(!window.__PC) return;
  const pc = window.__PC;
  pc.addEventListener('connectionstatechange', ()=>{
    try{
      if(pc.connectionState === 'failed' || pc.iceConnectionState === 'failed'){
        console.warn('PC failed — restarting ICE');
        if(pc.restartIce){ try{ pc.restartIce(); }catch(e){ console.warn('restartIce failed', e); } }
      }
    }catch(e){}
  });
})();


// --- AES Key Export/Import (CLEAN SINGLE DEFINITIONS) ---
async function exportAESKey() {
  try {
    if (!window.__CIPHERNEXUS_AES_KEY) {
      alert("No AES key.");
      return;
    }
    const raw = await crypto.subtle.exportKey("raw", window.__CIPHERNEXUS_AES_KEY);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
    const blob = new Blob([b64], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ciphernexus-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
  }
}

async function importAESKeyFromFile(file) {
  try {
    const text = await file.text();
    const bytes = Uint8Array.from(atob(text.trim()), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
    window.__CIPHERNEXUS_AES_KEY = key;
    alert("Key imported");
  } catch (e) {
    console.error(e);
    alert("Import failed");
  }
}
// --- END AES Key Export/Import ---
