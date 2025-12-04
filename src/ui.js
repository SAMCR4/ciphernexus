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
