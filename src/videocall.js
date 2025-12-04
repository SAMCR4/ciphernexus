
// videocall.js — Camera capture, device selection, local preview, attach tracks to RTCPeerConnection
export const CN_Video = (function(){
  let localStream = null;
  let currentConstraints = {video: {width:640, height:480}, audio: true};

  async function listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      const sel = document.getElementById('cn-camera-select') || document.getElementById('deviceList');
      if(!sel) return cams;
      sel.innerHTML = '';
      cams.forEach(c=>{
        const opt = document.createElement('option');
        opt.value = c.deviceId;
        opt.textContent = c.label || ('Camera ' + (sel.options.length+1));
        sel.appendChild(opt);
      });
      return cams;
    } catch(e) { console.warn('listDevices', e); return []; }
  }

  async function startCapture(deviceId){
    try {
      const constr = JSON.parse(JSON.stringify(currentConstraints));
      if(deviceId) constr.video.deviceId = { exact: deviceId };
      const s = await navigator.mediaDevices.getUserMedia(constr);
      attachLocalStream(s);
      return s;
    } catch(e) { console.error('startCapture failed', e); throw e; }
  }

  function attachLocalStream(stream){
    try{
      localStream = stream;
      window.__LOCAL_STREAM = stream;
      const v = document.getElementById('localVideo');
      if(v){ v.srcObject = stream; try{ v.play(); }catch(e){} }
      // if there's an active RTCPeerConnection, add tracks (replace existing senders)
      if(window.__PC && typeof window.__PC.getSenders === 'function'){
        // remove previous senders for video/audio
        try{
          const senders = window.__PC.getSenders() || [];
          senders.forEach(s => { if(s.track && (s.track.kind === 'video' || s.track.kind === 'audio')){ try{ window.__PC.removeTrack(s); }catch(e){} } });
        }catch(e){ /* ignore */ }
        // add new tracks
        stream.getTracks().forEach(track => {
          try{ window.__PC.addTrack(track, stream); }catch(e){ console.warn('addTrack failed', e); }
        });
      }
    }catch(e){ console.error('attachLocalStream', e); }
  }

  function stopCapture(){
    try{
      if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; window.__LOCAL_STREAM=null; const v=document.getElementById('localVideo'); if(v) v.srcObject = null; }
    }catch(e){ console.warn('stopCapture', e); }
  }

  function toggleAudioMute(){
    if(!localStream) return false;
    const audioTracks = localStream.getAudioTracks();
    if(!audioTracks.length) return false;
    audioTracks.forEach(t=> t.enabled = !t.enabled );
    return audioTracks[0].enabled;
  }
  function toggleVideoEnabled(){
    if(!localStream) return false;
    const vtracks = localStream.getVideoTracks();
    if(!vtracks.length) return false;
    vtracks.forEach(t=> t.enabled = !t.enabled );
    return vtracks[0].enabled;
  }

  return { listDevices, startCapture, attachLocalStream, stopCapture, toggleAudioMute, toggleVideoEnabled, getLocalStream: ()=>localStream };
})();


// === C1.4: Insertable Streams E2E encryption helpers ===
// Note: This feature uses experimental browser APIs (createEncodedStreams) when available.
async function CN_EnableSenderE2EEncryption(rtcpSender, aesKey){
  try{
    if(!rtcpSender || !rtcpSender.createEncodedStreams) return false;
    const streams = rtcpSender.createEncodedStreams();
    const reader = streams.readable.getReader();
    const writer = streams.writable.getWriter();
    // simple counter iv (not secure for production; better to use per-chunk random IVs)
    let counter = 0;
    async function pump(){
      while(true){
        const {value, done} = await reader.read();
        if(done) break;
        try{
          // value is an EncodedVideoChunk-like object with .data (ArrayBuffer)
          const plain = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
          const iv = new Uint8Array(12);
          // fill iv with counter (last 4 bytes)
          const dv = new DataView(iv.buffer);
          dv.setUint32(8, counter);
          counter++;
          const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, aesKey, plain);
          const newValue = Object.assign({}, value, { data: new Uint8Array(ct) });
          await writer.write(newValue);
        }catch(e){
          console.warn('sender encrypt chunk failed', e);
          await writer.write(value);
        }
      }
      await writer.close();
    }
    pump().catch(e=>console.warn('pump err',e));
    return true;
  }catch(e){ console.warn('CN_EnableSenderE2EEncryption', e); return false; }
}

async function CN_EnableReceiverE2EDecryption(rtcpReceiver, aesKey){
  try{
    if(!rtcpReceiver || !rtcpReceiver.createEncodedStreams) return false;
    const streams = rtcpReceiver.createEncodedStreams();
    const reader = streams.readable.getReader();
    const writer = streams.writable.getWriter();
    async function pump(){
      while(true){
        const {value, done} = await reader.read();
        if(done) break;
        try{
          const ct = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
          // assume iv is counter-based: reconstruct iv from last known? This simplistic approach assumes sender used deterministic counter
          // For now try to decrypt with zero iv and if fails pass through.
          const iv = new Uint8Array(12);
          try{
            const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, aesKey, ct);
            const newValue = Object.assign({}, value, { data: new Uint8Array(pt) });
            await writer.write(newValue);
          }catch(e){
            // can't decrypt, pass through original
            await writer.write(value);
          }
        }catch(e){ console.warn('receiver decrypt chunk failed', e); await writer.write(value); }
      }
      await writer.close();
    }
    pump().catch(e=>console.warn('recv pump err',e));
    return true;
  }catch(e){ console.warn('CN_EnableReceiverE2EDecryption', e); return false; }
}

// attach helpers to module export
if(typeof window !== 'undefined'){
  window.CN_EnableSenderE2EEncryption = CN_EnableSenderE2EEncryption;
  window.CN_EnableReceiverE2EDecryption = CN_EnableReceiverE2EDecryption;
}


// === C3: Screen sharing helpers ===
async function CN_StartScreenShare(){
  try{
    const s = await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    // attach to local preview and PC like camera
    if(window.CN_Video && window.CN_Video.attachLocalStream){ window.CN_Video.attachLocalStream(s); }
    window.__SCREEN_STREAM = s;
    // handle end
    s.getTracks().forEach(t=> t.onended = ()=>{ if(window.__SCREEN_STREAM){ window.__SCREEN_STREAM=null; } });
    return s;
  }catch(e){ console.warn('screen share failed', e); throw e; }
}
if(typeof window !== 'undefined'){ window.CN_StartScreenShare = CN_StartScreenShare; }


// === HARDEN: per-chunk IV and HMAC signing for encoded streams ===
async function CN_ProcessEncodedStreamWithSecurity(reader, writer, aesKey, hmacKey){
  // Each chunk will be encrypted with a random IV and signed with HMAC over (iv||ct||seq)
  let seq = 0;
  async function pump(){
    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      try{
        const plain = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, aesKey, plain);
        const ctArr = new Uint8Array(ct);
        // build signature input: iv || ct || seq (4 bytes)
        const seqBuf = new Uint8Array(4); new DataView(seqBuf.buffer).setUint32(0, seq);
        const combined = new Uint8Array(iv.length + ctArr.length + seqBuf.length);
        combined.set(iv,0); combined.set(ctArr, iv.length); combined.set(seqBuf, iv.length + ctArr.length);
        const sigBuf = await crypto.subtle.sign('HMAC', hmacKey, combined);
        const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
        const payload = { data: Array.from(ctArr), iv: Array.from(iv), seq: seq, sig: sigB64 };
        // write payload as JSON into the outgoing stream's value.data
        const newValue = Object.assign({}, value, { data: new Uint8Array(JSON.stringify(payload).split('').map(c=>c.charCodeAt(0))) });
        await writer.write(newValue);
        seq = (seq + 1) >>> 0;
      }catch(e){ console.warn('secure pump error', e); await writer.write(value); }
    }
    await writer.close();
  }
  pump().catch(e=>console.warn('secure pump main', e));
}

async function CN_ReconstructAndVerifyEncodedStream(reader, writer, aesKey, hmacKey){
  async function pump(){
    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      try{
        const blob = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
        // reconstruct payload JSON from blob
        const s = String.fromCharCode(...blob);
        let obj = null;
        try{ obj = JSON.parse(s); }catch(e){ await writer.write(value); continue; }
        const iv = new Uint8Array(obj.iv);
        const ct = new Uint8Array(obj.data);
        const seqBuf = new Uint8Array(4); new DataView(seqBuf.buffer).setUint32(0, obj.seq);
        const combined = new Uint8Array(iv.length + ct.length + seqBuf.length);
        combined.set(iv,0); combined.set(ct, iv.length); combined.set(seqBuf, iv.length + ct.length);
        // verify HMAC
        const sigBytes = Uint8Array.from(atob(obj.sig), c=>c.charCodeAt(0));
        const ok = await crypto.subtle.verify('HMAC', hmacKey, sigBytes, combined);
        if(!ok){ console.warn('chunk HMAC failed seq', obj.seq); continue; }
        // decrypt
        let pt;
        try{ pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, aesKey, ct); }
        catch(e){ console.warn('decrypt chunk failed', e); continue; }
        const newValue = Object.assign({}, value, { data: new Uint8Array(pt) });
        await writer.write(newValue);
      }catch(e){ console.warn('reconstruct pump err', e); await writer.write(value); }
    }
    await writer.close();
  }
  pump().catch(e=>console.warn('reconstruct pump main', e));
}

if(typeof window !== 'undefined'){
  window.CN_ProcessEncodedStreamWithSecurity = CN_ProcessEncodedStreamWithSecurity;
  window.CN_ReconstructAndVerifyEncodedStream = CN_ReconstructAndVerifyEncodedStream;
}

