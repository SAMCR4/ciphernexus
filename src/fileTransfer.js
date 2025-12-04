import * as crypto from './crypto.js';
import { uploadFileChunk } from './storage.js';

export async function sendFileOverDC(dc, file, keys, roomStorageId){
  const chunkSize = 64 * 1024;
  const fileId = 'f_' + Math.random().toString(36).slice(2,9);
  const total = Math.ceil(file.size / chunkSize);
  for(let i=0;i<total;i++){
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const blob = file.slice(start,end);
    const arr = new Uint8Array(await blob.arrayBuffer());
    const enc = await crypto.aesEncryptRaw(keys.file, { seq:i, data: Array.from(arr), fileId, final: i===total-1 });
    try {
      if(dc && dc.readyState === 'open'){
        dc.send(JSON.stringify({ type:'file-chunk', fileId, seq:i, enc }));
      } else {
        await uploadFileChunk(roomStorageId, fileId, i, enc);
      }
    } catch(e){
      await uploadFileChunk(roomStorageId, fileId, i, enc);
    }
  }
  return fileId;
}
