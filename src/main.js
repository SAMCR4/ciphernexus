import * as crypto from './crypto.js';
import * as storage from './storage.js';
import * as webrtc from './webrtc.js';
import * as ui from './ui.js';
import * as fileTransfer from './fileTransfer.js';

window._ultra_storage = storage;
window._ultra_crypto = crypto;

const localId = 'u_' + Math.random().toString(36).slice(2,9);
let localStream = null;
try { localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true}); } catch(e){ console.warn('no cam', e); }
window._ultra_runtime = { localId, localStream };

document.getElementById('app').innerHTML = `
  <div id="joinBox" class="panel">
    <h3>ULTRA Chat</h3>
    <input id="roomInput" placeholder="room code"/>
    <input id="nameInput" placeholder="name"/>
    <button id="joinBtn" class="btn">Join</button>
  </div>
  <div id="controls" style="display:none">
    <div id="roomLabel" class="panel small">Not joined</div>
    <div id="adminBadge" class="panel small" style="display:none">★ ADMIN</div>
    <button id="leaveBtn" class="btn">Leave</button>
    <button id="toggleMatrix" class="btn">Toggle BG</button>
  </div>
  <div id="chat" style="display:none" class="panel resizable">
    <div><strong>Chat</strong></div>
    <div id="chatLog"></div>
    <input id="chatInput" placeholder="type and enter"/>
  </div>
  <div id="videos"></div>
  <div id="userList" style="display:none"></div>
`;

// init UI
ui.initUI(window._ultra_runtime);
console.log('app ready');
