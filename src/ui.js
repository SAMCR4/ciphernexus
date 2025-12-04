import * as crypto from './crypto.js';
import * as storage from './storage.js';
import * as webrtc from './webrtc.js';
import { THEMES, applyTheme } from './themes.js';

/*
  Enhanced UI module:
  - theme engine (admin controlled)
  - dynamic admin panel (D: adaptive)
  - encrypted layout save (metaKey)
  - snapping/drag basics (simple implementation)
  - file receive + resume scaffolding
*/

export async function initUI(runtime){
  const localId = runtime.localId;
  const roomInput = document.getElementById('roomInput');
  const pepperInput = document.getElementById('pepperInput');
  const nameInput = document.getElementById('nameInput');
  const joinBtn = document.getElementById('joinBtn');
  const demoBtn = document.getElementById('demoBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const chatInput = document.getElementById('chatInput');
  const chatLog = document.getElementById('chatLog');
  const userList = document.getElementById('userList');
  const memberCount = document.getElementById('memberCount');
  const adminBadge = document.getElementById('adminBadge');
  const controls = document.getElementById('controls');

  let state = { roomCode:null, roomStorageId:null, master:null, keys:null, isAdmin:false, theme:'neo' };

  function appendChat(s){ const d=document.createElement('div'); d.textContent=s; chatLog.appendChild(d); chatLog.scrollTop=chatLog.scrollHeight; }

  // admin panel dynamic (design D): a floating adaptive admin window created only for admins
  function createAdminPanel(){
    let existing = document.getElementById('adminPanel');
    if(existing) return existing;
    const panel = document.createElement('div');
    panel.id = 'adminPanel';
    panel.className = 'panel resizable';
    panel.style.position='fixed';
    panel.style.right='12px';
    panel.style.top='12px';
    panel.style.zIndex='60';
    panel.style.width='320px';
    panel.style.maxWidth='80vw';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><strong>Admin</strong><button id="closeAdmin" class="btn">✕</button></div>
      <div style="margin-top:8px;">
        <label class="small">Theme</label>
        <select id="themeSelect" style="width:100%;margin-bottom:8px;"></select>
        <label class="small">Select user id (for rename/kick)</label>
        <input id="selectedUserId" style="width:100%;margin-bottom:6px" placeholder="user id"/>
        <input id="renameInput" style="width:100%;margin-bottom:6px" placeholder="new name"/>
        <button id="renameBtn" class="btn" style="width:100%">Rename</button>
        <button id="kickBtn" class="btn" style="width:100%;margin-top:6px">Kick</button>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('closeAdmin').onclick = ()=> panel.remove();
    // populate themes
    const sel = panel.querySelector('#themeSelect');
    Object.values(THEMES).forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o); });
    sel.value = state.theme || 'neo';
    sel.onchange = async ()=> {
      const chosen = sel.value;
      applyTheme(THEMES[chosen]);
      state.theme = chosen;
      // save encrypted layout+theme
      if(state.roomStorageId && state.keys && state.keys.meta){
        const layout = await collectLayout();
        layout.theme = chosen;
        const enc = await crypto.aesEncryptRaw(state.keys.meta, layout);
        await storage.saveLayoutEncrypted(state.roomStorageId, enc);
      }
    };
    document.getElementById('renameBtn').onclick = async ()=> {
      if(!state.isAdmin) return alert('Admin only');
      const target = panel.querySelector('#selectedUserId').value.trim();
      const newName = panel.querySelector('#renameInput').value.trim();
      if(!target || !newName) return alert('need target and name');
      // send admin_action via signals encrypted with metaKey
      const action = { op:'rename', targetId: target, name: newName };
      const enc = await crypto.aesEncryptRaw(state.keys.meta, action);
      await storage.insertSignal(state.roomStorageId, { type:'admin_enc', from: localId, body: enc });
      appendChat('ADMIN renamed '+target+' -> '+newName);
    };
    document.getElementById('kickBtn').onclick = async ()=> {
      if(!state.isAdmin) return alert('Admin only');
      const target = panel.querySelector('#selectedUserId').value.trim();
      if(!target) return alert('choose target');
      const action = { op:'kick', targetId: target };
      const enc = await crypto.aesEncryptRaw(state.keys.meta, action);
      await storage.insertSignal(state.roomStorageId, { type:'admin_enc', from: localId, body: enc });
      appendChat('ADMIN kicked '+target);
    };
    return panel;
  }

  // collectLayout: gather positions/sizes of panels
  async function collectLayout(){
    const vids = document.querySelectorAll('.vid');
    const arr = [];
    vids.forEach(v => {
      const r = v.getBoundingClientRect();
      arr.push({ left: r.left, top: r.top, w: r.width, h: r.height, id: v.dataset.peer || null });
    });
    const chatRect = document.getElementById('chat').getBoundingClientRect();
    const layout = { vids:arr, chat:{ left: chatRect.left, top: chatRect.top, w:chatRect.width, h:chatRect.height }, theme: state.theme, ts: new Date().toISOString() };
    return layout;
  }

  // restore layout from decrypted object
  async function restoreLayout(obj){
    try {
      if(!obj) return;
      if(obj.theme && THEMES[obj.theme]){
        state.theme = obj.theme;
        applyTheme(THEMES[state.theme]);
      }
      if(obj.vids && Array.isArray(obj.vids)){
        // naive restore: set inline styles for existing .vid elements
        const vids = document.querySelectorAll('.vid');
        obj.vids.forEach((vobj, i)=>{
          const v = vids[i];
          if(!v) return;
          v.style.position='fixed';
          v.style.left = (vobj.left||12) + 'px';
          v.style.top = (vobj.top||12) + 'px';
          v.style.width = (vobj.w||320) + 'px';
          v.style.height = (vobj.h||180) + 'px';
        });
      }
    } catch(e){ console.warn('restoreLayout', e); }
  }

  // receive admin action decrypted handler
  async function handleAdminActionEnc(encBody){
    try {
      const action = await crypto.aesDecryptRaw(state.keys.meta, encBody);
      if(!action) return;
      if(action.op==='kick'){
        // apply client-side enforcement: if we are target, leave
        if(action.targetId === localId){
          alert('You were kicked by admin');
          location.reload();
        }
      } else if(action.op==='rename'){
        // if rename targeted at us, update displayed name
        if(action.targetId === localId){
          // update UI
          // (store in local name if needed)
        }
      } else if(action.op==='setTheme'){
        if(action.theme && THEMES[action.theme]){
          applyTheme(THEMES[action.theme]);
          state.theme = action.theme;
        }
      }
    } catch(e){ console.warn('adminAction decrypt failed', e); }
  }

  // join handler (called by main)
  async function doJoin(code, pepper){
    state.roomCode = code;
    state.roomStorageId = await crypto.sha256Hex(code + '::' + (pepper||''));
    state.master = await crypto.deriveMasterKey(code, state.roomStorageId);
    state.keys = await crypto.deriveSubkeys(state.master);

    // upsert user (plaintext row for presence; meta is encrypted)
    await storage.upsertUser(state.roomStorageId, { id: localId, name: nameInput.value || localId, admin:false });

    // try claim owner if absent
    try {
      const { data: roomRow } = await storage.supabase.from('rooms').select('*').eq('id', state.roomStorageId).single();
      if(!roomRow){
        await storage.supabase.from('rooms').insert([{ id: state.roomStorageId, owner_id: localId }]).catch(()=>{});
        state.isAdmin = true; adminBadge.style.display='block'; createAdminPanel();
      } else if(roomRow.owner_id === localId){ state.isAdmin = true; adminBadge.style.display='block'; createAdminPanel(); }
    } catch(e){ /* ignore */ }

    // fetch initial state (messages, signals, users, layouts)
    const lastSeen = localStorage.getItem('ultra.lastSeen.' + state.roomStorageId) || null;
    const initial = await storage.fetchInitial(state.roomStorageId, lastSeen);
    // handle layouts (take latest)
    if(initial.layouts && initial.layouts.length){
      try {
        const latest = initial.layouts[initial.layouts.length-1];
        const p = JSON.parse(latest.payload);
        if(p && p.enc){
          const layoutObj = await crypto.aesDecryptRaw(state.keys.meta, p.enc);
          await restoreLayout(layoutObj);
        }
      } catch(e){ console.warn('layout restore', e); }
    }
    // handle messages
    for(const m of initial.messages){
      try {
        const payload = JSON.parse(m.payload);
        if(payload.enc){
          const outer = await crypto.aesDecryptRaw(state.keys.auth, payload.enc);
          const inner = await crypto.aesDecryptRaw(state.keys.chat, outer.enc);
          appendChat(inner.from + ': ' + inner.text);
        }
      } catch(e){}
    }
    // handle signals: including encrypted admin actions & sdp offers -> delegate to webrtc
    for(const s of initial.signals){
      try {
        const payload = JSON.parse(s.payload);
        if(payload.type==='enc' && payload.body){
          // delegate to webrtc handler
          await webrtc.handleSignalRow(s, state.roomStorageId, state.keys, runtime.localStream, msg=>appendChat(msg.from+': '+msg.text));
        } else if(payload.type==='admin_enc' && payload.body){
          await handleAdminActionEnc(payload.body);
        }
      } catch(e){ console.warn('init signal handling', e); }
    }

    // subscribe realtime
    storage.subscribeRealtime(state.roomStorageId, {
      onSignal: async row => {
        try {
          const payload = JSON.parse(row.payload);
          if(payload.type==='enc') await webrtc.handleSignalRow(row, state.roomStorageId, state.keys, runtime.localStream, msg=>appendChat(msg.from+': '+msg.text));
          else if(payload.type==='admin_enc') await handleAdminActionEnc(payload.body);
        } catch(e){ console.warn(e); }
        localStorage.setItem('ultra.lastSeen.'+state.roomStorageId, new Date().toISOString());
      },
      onMessage: async row => {
        try {
          const payload = JSON.parse(row.payload);
          if(payload.enc){
            try {
              const outer = await crypto.aesDecryptRaw(state.keys.auth, payload.enc);
              const inner = await crypto.aesDecryptRaw(state.keys.chat, outer.enc);
              appendChat(inner.from + ': ' + inner.text);
            } catch(e){ console.warn('msg decrypt failed', e); }
          } else if(payload.type === 'chat'){
            appendChat(payload.from + ': ' + payload.text);
          }
        } catch(e){ console.warn(e); }
        localStorage.setItem('ultra.lastSeen.'+state.roomStorageId, new Date().toISOString());
      },
      onUser: async row => { await refreshUsers(); }
    });

    // announce presence
    const pres = { type:'presence', from: localId, ts:new Date().toISOString() };
    const encP = await crypto.aesEncryptRaw(state.keys.signal, pres);
    await storage.insertSignal(state.roomStorageId, { type:'enc', from: localId, body: encP });

    // UI changes
    document.getElementById('joinBox').style.display='none';
    document.getElementById('controls').style.display='flex';
    document.getElementById('chat').style.display='flex';
    document.getElementById('userList').style.display='block';
    document.getElementById('roomLabel').innerText = 'Room: ' + state.roomCode.slice(0,8) + '…';
    runtime.room = state;
    await refreshUsers();
  }

  async function refreshUsers(){
    try {
      const { data } = await storage.supabase.from('users').select('*').eq('room', state.roomStorageId);
      const users = data || [];
      userList.innerHTML = '';
      users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'userRow';
        row.style.display='flex'; row.style.justifyContent='space-between'; row.style.padding='6px 4px';
        const left = document.createElement('div'); left.innerHTML = `<strong>${u.name||u.id}</strong><div style="font-size:11px;color:#6f6">${u.id}</div>`;
        const right = document.createElement('div');
        if(u.admin) right.innerHTML = '<span class="admin">★</span>';
        row.appendChild(left); row.appendChild(right);
        row.onclick = ()=> { const sel = document.getElementById('selectedUserId'); if(sel) sel.value = u.id; };
        userList.appendChild(row);
      });
      memberCount.innerText = users.length;
    } catch(e){ console.warn(e); }
  }

  // quick snapping/drag (simple implementation): make .vid draggable and snap to 12px grid and edges
  function makeDraggable(el){
    el.style.position = 'fixed';
    el.onpointerdown = function(e){
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const rect = el.getBoundingClientRect();
      const origLeft = rect.left, origTop = rect.top;
      function move(ev){
        let nx = origLeft + (ev.clientX - startX);
        let ny = origTop + (ev.clientY - startY);
        // snap to edges at 18px
        const snap = 18;
        if(Math.abs(nx) < snap) nx = 12;
        if(Math.abs(ny) < snap) ny = 12;
        // grid snap 12px
        nx = Math.round(nx/12)*12; ny = Math.round(ny/12)*12;
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
      }
      function up(ev){
        el.releasePointerCapture(e.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  // make existing future vid elements draggable when added (MutationObserver)
  const vidsContainer = document.getElementById('videos');
  const obs = new MutationObserver((mut)=>{
    mut.forEach(m=>{
      m.addedNodes.forEach(n=>{ if(n.classList && n.classList.contains('vid')) makeDraggable(n); });
    });
  });
  obs.observe(vidsContainer, { childList:true });

  // chat send handler
  chatInput.addEventListener('keydown', async e=>{
    if(e.key!=='Enter') return;
    if(!state.roomStorageId) return alert('join room first');
    const txt = chatInput.value.trim(); if(!txt) return;
    const inner = { type:'chat', from: localId, text: txt, ts: new Date().toISOString() };
    const encInner = await crypto.aesEncryptRaw(state.keys.chat, inner);
    const outer = { enc: encInner, tag: Math.random().toString(36).slice(2) };
    const encOuter = await crypto.aesEncryptRaw(state.keys.auth, outer);
    await storage.insertMessage(state.roomStorageId, { enc: encOuter });
    appendChat('Me: ' + txt);
    chatInput.value='';
  });

  // file receive scaffolding: monitor file_chunks table and reconstruct for this room
  async function pollFileChunks(){
    if(!state.roomStorageId) return;
    try {
      const { data } = await storage.supabase.from('file_chunks').select('*').eq('room', state.roomStorageId).order('seq',{ascending:true});
      if(data && data.length){
        // group by file_id
        const groups = {};
        for(const row of data){
          const fid = row.file_id;
          groups[fid] = groups[fid] || [];
          groups[fid].push(row);
        }
        for(const fid in groups){
          // try decrypt using file key and assemble
          const parts = groups[fid];
          parts.sort((a,b)=>a.seq-b.seq);
          const buffers = [];
          for(const p of parts){
            try {
              const dec = await crypto.aesDecryptRaw(state.keys.file, p.payload);
              if(dec && dec.data) buffers.push(new Uint8Array(dec.data));
            } catch(e){ console.warn('chunk decrypt', e); }
          }
          if(buffers.length){
            // concat buffers
            let totalLen = buffers.reduce((s,b)=>s+b.length,0);
            const out = new Uint8Array(totalLen);
            let offset = 0;
            for(const b of buffers){ out.set(b, offset); offset += b.length; }
            // create blob and download
            const blob = new Blob([out]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = fid + '.bin'; document.body.appendChild(a); a.click(); a.remove();
            // optionally remove chunks from server (not auto-implemented)
          }
        }
      }
    } catch(e){ console.warn(e); }
  }
  setInterval(pollFileChunks, 5000);

  // join button wiring
  joinBtn.onclick = async ()=>{
    const code = roomInput.value.trim();
    const pepper = (pepperInput && pepperInput.value) ? pepperInput.value.trim() : '';
    if(!code) return alert('enter room code');
    await doJoin(code, pepper);
  };

  demoBtn.onclick = async ()=>{
    const code = 'demo-' + Math.random().toString(36).slice(2,6);
    roomInput.value = code; nameInput.value = 'demo-' + localId.slice(-4);
    await doJoin(code, '');
  };

  return { };
}


export function initQRScanner(app){
  const modal=document.getElementById("qr-modal");
  modal.style.display="block";
  const video=document.createElement("video");
  modal.appendChild(video);

  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
    .then(stream=>{
      video.srcObject=stream;
      video.setAttribute("playsinline",true);
      video.play();
      requestAnimationFrame(scan);
    });

  async function scan(){
    if(video.readyState===video.HAVE_ENOUGH_DATA){
      const canvas=document.createElement("canvas");
      canvas.width=video.videoWidth;
      canvas.height=video.videoHeight;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const img=ctx.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(img.data,canvas.width,canvas.height);
      if(code){
        app.handleScannedQR(code.data);
        video.srcObject.getTracks().forEach(t=>t.stop());
        modal.style.display="none";
        return;
      }
    }
    requestAnimationFrame(scan);
  }
}


import jsQR from "./lib/qr/jsQR.js";

export function startQRScanner(app){
  const modal=document.getElementById("qr-modal");
  const video=document.getElementById("qr-video");
  const status=document.getElementById("qr-status");
  modal.style.display="flex";

  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
    .then(stream=>{
      video.srcObject=stream;
      video.setAttribute("playsinline",true);
      video.play();
      requestAnimationFrame(scan);
    });

  let fail=0;
  const worker=new Worker("/src/qrWorker.js");

  worker.onmessage=(ev)=>{
    if(ev.data && ev.data.data){
      finalize(ev.data.data);
    }
  };

  function scan(){
    if(video.readyState===video.HAVE_ENOUGH_DATA){
      const canvas=document.createElement("canvas");
      canvas.width=video.videoWidth;
      canvas.height=video.videoHeight;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const img=ctx.getImageData(0,0,canvas.width,canvas.height);

      const code = jsQR(img.data, canvas.width, canvas.height);
      if(code){ finalize(code.data); return; }

      fail++;
      if(fail>10){
        worker.postMessage({data:img.data, width:canvas.width, height:canvas.height});
        fail=0;
      }
    }
    requestAnimationFrame(scan);
  }

  function finalize(data){
    status.textContent="QR detected… verifying…";
    video.srcObject.getTracks().forEach(t=>t.stop());
    setTimeout(()=>{ modal.style.display="none"; },300);
    app.handleScannedQR(data);
  }
}



// Feature additions: media controls, screen share, draggable, theme toggle, voice recording
async function listDevices(){
  const devices = await navigator.mediaDevices.enumerateDevices();
  const el = document.getElementById('deviceList');
  if(!el) return;
  el.innerHTML = '';
  devices.forEach(d=>{ const p=document.createElement('div'); p.textContent = d.kind + ' — ' + d.label; el.appendChild(p); });
}

let localStream=null;
async function startLocalCam(){
  try{
    localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    const v=document.getElementById('localVideo');
    if(v) v.srcObject = localStream;
    window.__LOCAL_STREAM = localStream;
    listDevices();
  }catch(e){ console.error('startLocalCam',e); alert('Camera error'); }
}
function stopLocalCam(){
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream=null; const v=document.getElementById('localVideo'); if(v) v.srcObject=null; window.__LOCAL_STREAM=null; }
}

async function shareScreen(){
  try{
    const s = await navigator.mediaDevices.getDisplayMedia({video:true});
    const rv = document.getElementById('remoteVideo');
    if(rv) rv.srcObject = s;
    window.__SCREEN_STREAM = s;
    if(window.__PC && window.__PC.addTrack){
      s.getTracks().forEach(track=>{ try{ window.__PC.addTrack(track, s); }catch(e){} });
    }
  }catch(e){ console.error('shareScreen',e); alert('Screen share failed'); }
}

function makeDraggable(el){
  if(!el) return;
  el.onpointerdown = function(e){
    el.setPointerCapture(e.pointerId);
    const startX=e.clientX, startY=e.clientY;
    const rect=el.getBoundingClientRect();
    const ox=rect.left, oy=rect.top;
    function move(ev){
      el.style.position='fixed';
      el.style.left=(ox + (ev.clientX-startX))+'px';
      el.style.top=(oy + (ev.clientY-startY))+'px';
    }
    function up(ev){ el.releasePointerCapture(e.pointerId); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

let mediaRecorder=null;
let audioChunks=[];
function startRecording(){
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e=> audioChunks.push(e.data);
    mediaRecorder.onstop = ()=>{
      const blob = new Blob(audioChunks,{type:'audio/webm'});
      audioChunks=[];
      const url = URL.createObjectURL(blob);
      const d = document.createElement('div');
      const a = document.createElement('audio'); a.controls=true; a.src=url;
      d.appendChild(a);
      const dl = document.createElement('a'); dl.href=url; dl.download='voice.webm'; dl.textContent='Download'; d.appendChild(dl);
      document.getElementById('voiceList').appendChild(d);
      if(window.sendEncryptedFile) window.sendEncryptedFile(blob, window.__CIPHERNEXUS_SENDFUNC);
    };
    mediaRecorder.start();
  }).catch(e=>{ console.error(e); alert('Microphone permission failed'); });
}
function stopRecording(){ if(mediaRecorder && mediaRecorder.state!=='inactive') mediaRecorder.stop(); }

function toggleTheme(){
  const shell = document.getElementById('appShell');
  if(!shell) return;
  if(shell.classList.contains('theme-dark')){ shell.classList.remove('theme-dark'); shell.classList.add('theme-neon'); }
  else { shell.classList.remove('theme-neon'); shell.classList.add('theme-dark'); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  listDevices();
  const startBtn = document.getElementById('btnStartLocal');
  const stopBtn = document.getElementById('btnStopLocal');
  const shareBtn = document.getElementById('btnShareScreen');
  const recBtn = document.getElementById('recordAudioBtn');
  const toggle = document.getElementById('btnToggleTheme');
  const neon = document.getElementById('themeNeon');
  const join = document.getElementById('joinBtn');
  const leave = document.getElementById('leaveBtn');
  startBtn && (startBtn.onclick = startLocalCam);
  stopBtn && (stopBtn.onclick = stopLocalCam);
  shareBtn && (shareBtn.onclick = shareScreen);
  recBtn && (recBtn.onclick = ()=>{ if(mediaRecorder && mediaRecorder.state==='recording'){ stopRecording(); recBtn.textContent='Record Voice Msg'; } else { startRecording(); recBtn.textContent='Stop Recording'; } });
  toggle && (toggle.onclick = toggleTheme);
  neon && (neon.onclick = ()=>{ document.getElementById('appShell').classList.add('theme-neon'); });
  join && (join.onclick = ()=>{ const r=document.getElementById('roomInput').value; if(r) window.app?.joinRoom?.(r); });
  leave && (leave.onclick = ()=>{ window.app?.leaveRoom?.(); });
  makeDraggable(document.getElementById('localPreview'));
  makeDraggable(document.getElementById('remotePreview'));
});



// === Auth & Loader UI handlers ===
async function cnPopulateUsernames(){
  const sel = document.getElementById('cn-username');
  const txt = localStorage.getItem('cn_usernames') || '[]';
  let arr = [];
  try{ arr = JSON.parse(txt);}catch(e){ arr = []; }
  sel.innerHTML = '';
  arr.forEach(u=>{ const o = document.createElement('option'); o.value=u; o.text=u; sel.appendChild(o); });
  const opt = document.createElement('option'); opt.value='__new__'; opt.text='Choose new username...'; sel.appendChild(opt);
}
function cnSaveUsername(name){
  if(!name) return;
  let arr = [];
  try{ arr = JSON.parse(localStorage.getItem('cn_usernames')||'[]'); }catch(e){ arr=[]; }
  if(!arr.includes(name)){ arr.unshift(name); if(arr.length>10) arr=arr.slice(0,10); localStorage.setItem('cn_usernames', JSON.stringify(arr)); }
}
function hideLoader(){ const el=document.getElementById('cn-loading'); if(el) el.style.display='none'; }
function showLoader(){ const el=document.getElementById('cn-loading'); if(el) el.style.display='flex'; }
// Attach join handlers
document.addEventListener('DOMContentLoaded', ()=>{
  cnPopulateUsernames();
  const join = document.getElementById('cn-join'), guest=document.getElementById('cn-guest');
  join && (join.onclick = async ()=>{
    const room = document.getElementById('cn-room').value.trim();
    let user = document.getElementById('cn-username').value;
    const newu = document.getElementById('cn-username-new').value.trim();
    if(user==='__new__' && newu) user=newu;
    if(!room || !user){ alert('Enter room and username'); return; }
    cnSaveUsername(user);
    // derive key from room (passphrase)
    if(window.cryptoHelpers && window.cryptoHelpers.deriveKeyFromCode){
      window.__CIPHERNEXUS_AES_KEY = await window.cryptoHelpers.deriveKeyFromCode(room);
    }
    // expose username and room
    window.__CIPHER_USER = user;
    window.__CIPHER_ROOM = room;
    hideLoader();
    // call app init join
    if(window.app && window.app.onAuth) window.app.onAuth({room, user});
  });
  guest && (guest.onclick = ()=>{ document.getElementById('cn-username-new').value = 'guest'+Math.floor(Math.random()*9000); join && join.click(); });
});



// On join: derive keys from room code using Argon2-preferring helper and set signing/enc contexts
async function cnOnAuthSetup(room){
  try{
    // derive AES/HMAC keys
    const keys = await window.cryptoHelpers.deriveKeysFromPass(room, null);
    if(keys && keys.aesKey){
      window.__CIPHERNEXUS_AES_KEY = keys.aesKey;
      window.__CIPHERNEXUS_HMAC_KEY = keys.hmacKey;
      // also set signaling encryption context to same AES (optional)
      window.__CIPHER_SIGNING = { key: keys.aesKey };
    }
  }catch(e){ console.warn('cnOnAuthSetup', e); }
}
// attach to existing join flows if present
document.addEventListener('DOMContentLoaded', ()=>{
  const joinBtn = document.getElementById('cn-join');
  if(joinBtn) joinBtn.addEventListener('click', async ()=>{ const room=document.getElementById('cn-room').value.trim(); await cnOnAuthSetup(room); });
});



// A1: prefer Argon2-based key derivation
if(typeof window.cryptoHelpers !== 'undefined' && window.cryptoHelpers.deriveKeysFromPassPreferArgon2){ window.cryptoHelpers.deriveKeysFromPass = window.cryptoHelpers.deriveKeysFromPassPreferArgon2; }



// === B3: Theme engine JS ===
function CN_SetTheme(themeName){
  try{
    const root = document.getElementById('appShell') || document.body;
    // animate overlay for smooth transition
    const overlay = document.getElementById('cn-theme-overlay');
    if(overlay){ overlay.classList.add('active'); setTimeout(()=>overlay.classList.remove('active'), 450); }
    // remove existing theme classes
    root.classList.remove('theme-dark','theme-neon','theme-highcontrast');
    if(themeName) root.classList.add(themeName);
    localStorage.setItem('cn_theme', themeName);
  }catch(e){ console.warn('CN_SetTheme', e); }
}

function CN_LoadTheme(){
  const saved = localStorage.getItem('cn_theme') || 'theme-dark';
  CN_SetTheme(saved);
  // update selector if present
  const sel = document.getElementById('cn-theme-select');
  if(sel) sel.value = saved;
}

document.addEventListener('DOMContentLoaded', ()=>{
  CN_LoadTheme();
  const sel = document.getElementById('cn-theme-select');
  if(sel) sel.addEventListener('change', (e)=> CN_SetTheme(e.target.value));
});



// === B4: Login modal handlers and username persistence ===
function CN_LoadUsernames(){
  try{
    const raw = localStorage.getItem('cn_usernames') || '[]';
    const arr = JSON.parse(raw);
    const sel = document.getElementById('cn-username-list');
    if(!sel) return;
    sel.innerHTML = '';
    arr.forEach(u=>{ const o=document.createElement('option'); o.value=u; o.textContent=u; sel.appendChild(o); });
    const opt = document.createElement('option'); opt.value='__new__'; opt.text='-- New username --'; sel.appendChild(opt);
  }catch(e){ console.warn(e); }
}
function CN_SaveUsername(name){
  if(!name) return;
  try{
    let arr = JSON.parse(localStorage.getItem('cn_usernames') || '[]');
    arr = arr.filter(x=>x!==name);
    arr.unshift(name);
    if(arr.length>12) arr=arr.slice(0,12);
    localStorage.setItem('cn_usernames', JSON.stringify(arr));
  }catch(e){ console.warn(e); }
}

async function CN_PerformJoin(room, username){
  try{
    // derive keys using Argon2-preferred helper if available
    if(window.cryptoHelpers && window.cryptoHelpers.deriveKeysFromPassPreferArgon2){
      const keys = await window.cryptoHelpers.deriveKeysFromPassPreferArgon2(room, null);
      if(keys && keys.aesKey){ window.__CIPHERNEXUS_AES_KEY = keys.aesKey; window.__CIPHERNEXUS_HMAC_KEY = keys.hmacKey; }
      // also set signaling signing key derived from AES
      if(window.CN_Derive_SigningKeyFromAES){
        const sigKey = await CN_Derive_SigningKeyFromAES(window.__CIPHERNEXUS_AES_KEY);
        if(sigKey) window.__CIPHER_SIGNING = { key: sigKey };
      }
    } else if(window.cryptoHelpers && window.cryptoHelpers.deriveKeysFromPass){
      const keys = await window.cryptoHelpers.deriveKeysFromPass(room);
      if(keys && keys.aesKey){ window.__CIPHERNEXUS_AES_KEY = keys.aesKey; window.__CIPHERNEXUS_HMAC_KEY = keys.hmacKey; }
    }
    // store username locally
    CN_SaveUsername(username);
    // hide modal
    const modal = document.getElementById('cn-auth-modal');
    if(modal) modal.style.display='none';
    // notify app if handler exists
    if(window.app && window.app.onAuth) window.app.onAuth({room, username});
  }catch(e){ console.error('CN_PerformJoin', e); alert('Failed to derive keys — check console.'); }
}

// attach events
document.addEventListener('DOMContentLoaded', ()=>{
  CN_LoadUsernames();
  const joinBtn = document.getElementById('cn-login-btn');
  const guestBtn = document.getElementById('cn-guest-btn');
  const sel = document.getElementById('cn-username-list');
  const newInp = document.getElementById('cn-username-new');
  joinBtn && (joinBtn.onclick = async ()=>{
    const room = document.getElementById('cn-room-code').value.trim();
    let username = (sel && sel.value) || '';
    const newu = newInp && newInp.value.trim();
    if(username==='__new__' && newu) username=newu;
    if(!room || !username){ alert('Enter a room and username'); return; }
    await CN_PerformJoin(room, username);
  });
  guestBtn && (guestBtn.onclick = async ()=>{
    const room = document.getElementById('cn-room-code').value.trim();
    const guest = 'guest' + Math.floor(Math.random()*9000);
    if(!room){ alert('Enter room code for guest session'); return; }
    await CN_PerformJoin(room, guest);
  });
});



// === B5: Room-Code Pairing UX ===
// Add handler to generate a packed, encrypted QR payload for sharing session info.

async function CN_GeneratePairingPayload(){
  try{
    const room = window.app?.state?.room || document.getElementById('cn-room-code')?.value || "";
    const user = window.app?.state?.username || "";
    if(!room || !user) return null;
    const obj={room:room,user:user};
    return await cryptoHelpers.CN_Pack_RoomPayload(obj);
  }catch(e){ console.error("pair payload fail",e); return null; }
}

window.CN_GeneratePairingPayload = CN_GeneratePairingPayload;



// === C1.2/C1.3: Wire video controls to CN_Video module ===
async function CN_UI_InitVideoControls(){
  try{
    // ensure module exists
    if(typeof CN_Video === 'undefined' && window.importShim === undefined){
      // dynamic import of the module
      try{ await import('./videocall.js'); }catch(e){ console.warn('dynamic import videocall failed', e); }
    }
    // list devices
    if(window.CN_Video && window.CN_Video.listDevices){
      await window.CN_Video.listDevices();
    }
    // wire buttons
    const startBtn = document.getElementById('btnStartLocal');
    const stopBtn = document.getElementById('btnStopLocal');
    const shareBtn = document.getElementById('btnShareScreen');
    const muteBtn = document.getElementById('btnMuteAudio');
    const camToggle = document.getElementById('btnToggleCam');
    const camSelect = document.getElementById('cn-camera-select') || document.getElementById('deviceList');
    startBtn && (startBtn.onclick = async ()=>{ try{ const dev = camSelect && camSelect.value; await window.CN_Video.startCapture(dev); }catch(e){ alert('Camera start failed: '+e.message); } });
    stopBtn && (stopBtn.onclick = ()=>{ window.CN_Video.stopCapture(); });
    muteBtn && (muteBtn.onclick = ()=>{ const on = window.CN_Video.toggleAudioMute(); muteBtn.textContent = on ? 'Mute' : 'Unmute'; });
    camToggle && (camToggle.onclick = ()=>{ const on = window.CN_Video.toggleVideoEnabled(); camToggle.textContent = on ? 'Camera Off' : 'Camera On'; });
    // attach change handler for camera select
    if(camSelect){
      camSelect.onchange = async ()=>{ try{ const dev = camSelect.value; await window.CN_Video.startCapture(dev); }catch(e){} };
    }
  }catch(e){ console.warn('CN_UI_InitVideoControls', e); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  // create extra control buttons if missing
  if(!document.getElementById('btnMuteAudio')){
    const b = document.createElement('button'); b.id='btnMuteAudio'; b.className='button'; b.textContent='Mute'; const cont = document.querySelector('.controls') || document.body; cont && cont.appendChild(b);
  }
  if(!document.getElementById('btnToggleCam')){
    const b2 = document.createElement('button'); b2.id='btnToggleCam'; b2.className='button'; b2.textContent='Camera Off'; const cont = document.querySelector('.controls') || document.body; cont && cont.appendChild(b2);
  }
  // ensure a camera selector exists
  if(!document.getElementById('cn-camera-select')){
    const sel = document.createElement('select'); sel.id='cn-camera-select'; sel.style.width='100%'; sel.style.marginTop='6px'; const sidebar = document.getElementById('sidebar') || document.body; sidebar && sidebar.appendChild(sel);
  }
  CN_UI_InitVideoControls();
});




// === C2/C3 UI hooks: mic controls & screen share hookup ===
document.addEventListener('DOMContentLoaded', ()=>{
  // add local audio preview element
  if(!document.getElementById('localAudioPreview')){
    const a = document.createElement('audio'); a.id='localAudioPreview'; a.autoplay=true; a.muted=true; a.style.display='none'; document.body.appendChild(a);
  }
  // wire mic start/stop if buttons present
  const micStart = document.getElementById('btnStartMic');
  const micStop = document.getElementById('btnStopMic');
  if(!micStart){ const b=document.createElement('button'); b.id='btnStartMic'; b.className='button'; b.textContent='Start Mic'; document.querySelector('.sidebar')?.appendChild(b); }
  if(!micStop){ const b2=document.createElement('button'); b2.id='btnStopMic'; b2.className='button ghost'; b2.textContent='Stop Mic'; document.querySelector('.sidebar')?.appendChild(b2); }
  // attach events
  document.getElementById('btnStartMic')?.addEventListener('click', async ()=>{ try{ await import('./audiocall.js'); await window.CN_Audio.startMic(); }catch(e){ alert('Mic start failed: '+e.message); } });
  document.getElementById('btnStopMic')?.addEventListener('click', ()=>{ try{ window.CN_Audio.stopMic(); }catch(e){} });
  document.getElementById('btnShareScreen')?.addEventListener('click', async ()=>{ try{ await import('./videocall.js'); await window.CN_StartScreenShare(); }catch(e){ alert('Screen share failed: '+e.message); } });
});


// === C6: Draggable video windows ===
function CN_MakeDraggable(el){ if(!el) return; el.style.position='relative'; let dragging=false, ox=0, oy=0; el.addEventListener('pointerdown', (e)=>{ dragging=true; ox=e.clientX; oy=e.clientY; el.setPointerCapture(e.pointerId); el.style.zIndex=9999; }); window.addEventListener('pointermove',(e)=>{ if(!dragging) return; const dx=e.clientX-ox, dy=e.clientY-oy; el.style.transform = `translate(${dx}px, ${dy}px)`; }); window.addEventListener('pointerup',(e)=>{ if(dragging){ dragging=false; el.style.zIndex=''; el.style.transform=''; } }); }
// auto-apply to video boxes
document.addEventListener('DOMContentLoaded', ()=>{ document.querySelectorAll('.video-box').forEach(b=> CN_MakeDraggable(b)); });


// === B7: Toast notifications ===
function CN_ShowToast(text, timeout=4000){ const area=document.getElementById('cn-toasts'); if(!area) return; const el=document.createElement('div'); el.className='cn-toast cn-pop'; el.style.padding='8px 12px'; el.style.background='rgba(0,0,0,0.6)'; el.style.border='1px solid rgba(255,255,255,0.04)'; el.style.borderRadius='8px'; el.textContent=text; area.appendChild(el); setTimeout(()=> el.style.opacity='0', timeout-300); setTimeout(()=> el.remove(), timeout); }
window.CN_ShowToast = CN_ShowToast;
// Settings panel
function CN_OpenSettings(){ const s=document.getElementById('cn-settings-panel'); if(!s){ const p=document.createElement('div'); p.id='cn-settings-panel'; p.className='cn-modal cn-pop'; p.style.position='fixed'; p.style.right='18px'; p.style.top='80px'; p.style.width='320px'; p.style.background='var(--card)'; p.style.padding='12px'; p.style.borderRadius='12px'; p.innerHTML = `<h3>Settings</h3><div><label>Rotate keys</label><button id='cn-rotate-keys' class='button'>Rotate</button></div><div style='margin-top:8px'><label>Export session</label><button id='cn-export-session' class='button'>Export</button></div>`; document.body.appendChild(p); document.getElementById('cn-rotate-keys').onclick = async ()=>{ await window.cryptoHelpers.CN_RotateKeys(); CN_ShowToast('Rotated keys'); }; document.getElementById('cn-export-session').onclick = async ()=>{ try{ const obj = {room: document.getElementById('cn-room-code')?.value}; const payload = await window.cryptoHelpers.CN_Pack_RoomPayload(obj); const a=document.createElement('a'); a.href='data:text/plain;base64,'+btoa(payload); a.download='cn-session.txt'; a.click(); CN_ShowToast('Exported session payload'); }catch(e){ CN_ShowToast('Export failed'); } }; } else { s.remove(); } }
document.addEventListener('DOMContentLoaded', ()=>{ document.getElementById('cn-open-settings')?.addEventListener('click', CN_OpenSettings); });
