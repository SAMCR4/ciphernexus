
importScripts('/src/lib/qr/jsQR.js');

onmessage = function(e){
  const {data,width,height} = e.data;
  const code = jsQR(data, width, height, {inversionAttempts:"attemptBoth"});
  postMessage(code ? {data:code.data} : null);
};
