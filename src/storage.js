import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kljdpxtheqywenuycrgc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsamRweHRoZXF5d2VudXljcmdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MDc1MTMsImV4cCI6MjA4MDM4MzUxM30.ZqYXnJ6utRXpZTT2o81APRKk3J-IaOgBXIc8YBV9P-0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// outbox local
const OUTBOX = 'ultra_outbox_v2';

function readOutbox(){ return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); }
function writeOutbox(q){ localStorage.setItem(OUTBOX, JSON.stringify(q)); }
export function enqueueOutbox(item){ const q=readOutbox(); q.push(item); writeOutbox(q); }

export async function insertSignal(roomStorageId, payload){
  try {
    const { error } = await supabase.from('signals').insert([{ room: roomStorageId, payload: JSON.stringify(payload) }]);
    if(error) throw error;
  } catch(e){
    enqueueOutbox({ t:'signal', room:roomStorageId, payload });
  }
}

export async function insertMessage(roomStorageId, payload){
  try {
    const { error } = await supabase.from('messages').insert([{ room: roomStorageId, payload: JSON.stringify(payload) }]);
    if(error) throw error;
  } catch(e){
    enqueueOutbox({ t:'message', room:roomStorageId, payload });
  }
}

export async function upsertUser(roomStorageId, user){
  try {
    await supabase.from('users').upsert([{ id: user.id, room: roomStorageId, name: user.name, admin: user.admin||false, kicked: user.kicked||false }]);
  } catch(e){ console.warn('upsertUser', e); }
}

export async function fetchInitial(roomStorageId, sinceIso){
  const res = { users:[], messages:[], signals:[] };
  try {
    const { data: u } = await supabase.from('users').select('*').eq('room', roomStorageId);
    res.users = u || [];
  } catch(e){}
  try {
    let q = supabase.from('messages').select('*').eq('room', roomStorageId).order('created_at',{ascending:true}).limit(1000);
    if(sinceIso) q = q.gte('created_at', sinceIso);
    const { data: m } = await q;
    res.messages = m || [];
  } catch(e){}
  try {
    let q2 = supabase.from('signals').select('*').eq('room', roomStorageId).order('created_at',{ascending:true}).limit(1000);
    if(sinceIso) q2 = q2.gte('created_at', sinceIso);
    const { data: s } = await q2;
    res.signals = s || [];
  } catch(e){}
  return res;
}

export function subscribeRealtime(roomStorageId, handlers){
  const channel = supabase.channel('room-'+roomStorageId);
  channel.on('postgres_changes', { event:'INSERT', schema:'public', table:'signals', filter:`room=eq.${roomStorageId}` }, payload => handlers.onSignal && handlers.onSignal(payload.new));
  channel.on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`room=eq.${roomStorageId}` }, payload => handlers.onMessage && handlers.onMessage(payload.new));
  channel.on('postgres_changes', { event:'INSERT', schema:'public', table:'users', filter:`room=eq.${roomStorageId}` }, payload => handlers.onUser && handlers.onUser(payload.new));
  channel.on('postgres_changes', { event:'UPDATE', schema:'public', table:'users', filter:`room=eq.${roomStorageId}` }, payload => handlers.onUser && handlers.onUser(payload.new));
  channel.subscribe();
  return channel;
}

export async function saveLayoutEncrypted(roomStorageId, encryptedLayout){
  try {
    await supabase.from('layouts').insert([{ room: roomStorageId, payload: JSON.stringify({ enc: encryptedLayout }) }]);
  } catch(e){ enqueueOutbox({ t:'layout', room: roomStorageId, payload: encryptedLayout }); }
}

// file chunk fallback
export async function uploadFileChunk(roomStorageId, fileId, seq, encChunkB64){
  try {
    await supabase.from('file_chunks').insert([{ room: roomStorageId, file_id: fileId, seq, payload: encChunkB64 }]);
  } catch(e){ enqueueOutbox({ t:'file_chunk', room: roomStorageId, payload:{ fileId, seq, encChunkB64 } }); }
}

export { supabase };
