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
