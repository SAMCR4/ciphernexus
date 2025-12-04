
// voicemsg.js — record short voice messages, encrypt and send via datachannel/file transfer
export const CN_VoiceMsg = (function(){
  let mediaRec = null; let chunks=[];
  async function startRecord(){
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRec = new MediaRecorder(s);
    chunks = [];
    mediaRec.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
    mediaRec.start();
  }
  function stopRecord(){
    return new Promise(res=>{
      if(!mediaRec) return res(null);
      mediaRec.onstop = async ()=>{
        const blob = new Blob(chunks, {type:'audio/webm'});
        // encrypt blob (read as arraybuffer)
        const ab = await blob.arrayBuffer();
        if(window.__CIPHERNEXUS_AES_KEY){
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, window.__CIPHERNEXUS_AES_KEY, new Uint8Array(ab));
          // pack and send via datachannel as ENC message
          const payload = {type:'voicemsg', iv:Array.from(iv), ct:Array.from(new Uint8Array(ct)), mime:blob.type};
          // send via existing DC encrypt wrapper
          if(window.CN_DC_Encrypt){ window.CN_DC_Encrypt(window.__DATA_CHANNEL, payload); }
        }
        res(blob);
      };
      mediaRec.stop();
    });
  }
  return { startRecord, stopRecord };
})();
