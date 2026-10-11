#!/usr/bin/env bash
# Restart cursor-voice on 127.0.0.1:8787 and poke the Cursor extension HTTP bridge.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8787

if lsof -Pi :"${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  lsof -ti:"${PORT}" | xargs kill -9
  sleep 1
fi

cd "${ROOT}/server"
node index.js >>"${ROOT}/.cursor-voice-server.log" 2>&1 &
SERVER_PID=$!
disown "${SERVER_PID}" 2>/dev/null || true
sleep 1

if ! curl -sf "http://127.0.0.1:${PORT}/v1/health" >/dev/null; then
  echo "Voice server did not come up on :${PORT} — see ${ROOT}/.cursor-voice-server.log"
  exit 1
fi

EXT_CFG="${HOME}/.cursor/cursor-voice-extension.json"
if [[ -f "${EXT_CFG}" ]]; then
  node -e "
    const fs=require('fs'),http=require('http');
    const e=JSON.parse(fs.readFileSync(process.env.HOME+'/.cursor/cursor-voice-extension.json','utf8'));
    const body='{}';
    const req=http.request({
      hostname:e.host,port:e.port,path:'/v1/restart',method:'POST',
      headers:{Authorization:'Bearer '+e.token,'Content-Type':'application/json','Content-Length':body.length}
    },res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log('extension bridge',res.statusCode,d));});
    req.on('error',err=>console.warn('extension restart skipped:',err.message));
    req.write(body);req.end();
  "
fi

echo "Voice server running at http://127.0.0.1:${PORT}"
