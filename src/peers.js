
// peers.js - simple peer manager (client-side) - requires signaling to wire actual exchange
window.CN_Peers = window.CN_Peers || (function(){
  const peers = {};
  function createPeer(id, isInitiator, signalingSend){
    const pc = new RTCPeerConnection();
    peers[id] = {id, pc, state:'new'};
    // attach tracks from local stream
    if(window.__LOCAL_STREAM){ window.__LOCAL_STREAM.getTracks().forEach(t=> pc.addTrack(t, window.__LOCAL_STREAM)); }
    pc.ontrack = (ev)=>{ window.cnAddRemoteStream && window.cnAddRemoteStream(ev.streams && ev.streams[0], id); };
    pc.onicecandidate = (ev)=>{ if(ev.candidate) signalingSend && CN_Signaling_Send(signalingSend, {type:'ice', to:id, candidate:ev.candidate}); };
    return pc;
  }
  function getPeer(id){ return peers[id] && peers[id].pc; }
  function removePeer(id){ if(peers[id]){ try{ peers[id].pc.close(); }catch(e){} delete peers[id]; } }
  return {createPeer, getPeer, removePeer, list: ()=>Object.keys(peers)};
})();
