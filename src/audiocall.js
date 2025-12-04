
// audiocall.js — Microphone capture, mute/unmute, and optional insertable-streams encryption for audio
export const CN_Audio = (function(){
  let localStream = null;
  async function startMic(deviceId){
    try{
      const constraints = { audio: { echoCancellation:true, noiseSuppression:true } };
      if(deviceId) constraints.audio.deviceId = { exact: deviceId };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      localStream = s;
      window.__LOCAL_AUDIO = s;
      const audEl = document.getElementById('localAudioPreview');
      if(audEl){ audEl.srcObject = s; try{ audEl.play(); }catch(e){} }
      // attach tracks to PC if exists
      if(window.__PC && window.__PC.addTrack){
        s.getTracks().forEach(t=>{ try{ window.__PC.addTrack(t, s); }catch(e){} });
      }
      return s;
    }catch(e){ console.error('startMic failed', e); throw e; }
  }
  function stopMic(){
    if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; window.__LOCAL_AUDIO=null; const el=document.getElementById('localAudioPreview'); if(el) el.srcObject=null; }
  }
  function toggleMute(){
    if(!localStream) return false;
    localStream.getAudioTracks().forEach(t=> t.enabled = !t.enabled );
    return localStream.getAudioTracks()[0].enabled;
  }

  // Insertable streams (audio) - similar approach to video; uses createEncodedStreams where available
  async function CN_EnableSenderAudioE2E(sender, aesKey){
    try{
      if(!sender || !sender.createEncodedStreams) return false;
      const streams = sender.createEncodedStreams();
      const reader = streams.readable.getReader();
      const writer = streams.writable.getWriter();
      let counter = 0;
      async function pump(){
        while(true){
          const {value, done} = await reader.read();
          if(done) break;
          try{
            const plain = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
            const iv = new Uint8Array(12);
            const dv = new DataView(iv.buffer);
            dv.setUint32(8, counter++);
            const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, aesKey, plain);
            const newValue = Object.assign({}, value, { data: new Uint8Array(ct) });
            await writer.write(newValue);
          }catch(e){ await writer.write(value); }
        }
        await writer.close();
      }
      pump().catch(e=>console.warn('audio sender pump',e));
      return true;
    }catch(e){ console.warn('CN_EnableSenderAudioE2E', e); return false; }
  }

  async function CN_EnableReceiverAudioE2E(receiver, aesKey){
    try{
      if(!receiver || !receiver.createEncodedStreams) return false;
      const streams = receiver.createEncodedStreams();
      const reader = streams.readable.getReader();
      const writer = streams.writable.getWriter();
      async function pump(){
        while(true){
          const {value, done} = await reader.read();
          if(done) break;
          try{
            const ct = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : new Uint8Array(value.data.buffer || value.data);
            const iv = new Uint8Array(12);
            try{
              const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv}, aesKey, ct);
              const newValue = Object.assign({}, value, { data: new Uint8Array(pt) });
              await writer.write(newValue);
            }catch(e){ await writer.write(value); }
          }catch(e){ await writer.write(value); }
        }
        await writer.close();
      }
      pump().catch(e=>console.warn('audio recv pump',e));
      return true;
    }catch(e){ console.warn('CN_EnableReceiverAudioE2E', e); return false; }
  }

  return { startMic, stopMic, toggleMute, CN_EnableSenderAudioE2E, CN_EnableReceiverAudioE2E, getLocalStream: ()=>localStream };
})();


// integrate secure stream helpers if present
if(typeof window !== 'undefined'){
  window.CN_EnableSenderAudioE2E_Secure = async function(sender, aesKey, hmacKey){
    try{
      if(!sender || !sender.createEncodedStreams) return false;
      const streams = sender.createEncodedStreams();
      await CN_ProcessEncodedStreamWithSecurity(streams.readable.getReader(), streams.writable.getWriter(), aesKey, hmacKey);
      return true;
    }catch(e){ console.warn('EnableSenderAudioE2E_Secure', e); return false; }
  };
  window.CN_EnableReceiverAudioE2E_Secure = async function(receiver, aesKey, hmacKey){
    try{
      if(!receiver || !receiver.createEncodedStreams) return false;
      const streams = receiver.createEncodedStreams();
      await CN_ReconstructAndVerifyEncodedStream(streams.readable.getReader(), streams.writable.getWriter(), aesKey, hmacKey);
      return true;
    }catch(e){ console.warn('EnableReceiverAudioE2E_Secure', e); return false; }
  };
}

