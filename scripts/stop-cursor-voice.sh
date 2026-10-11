#!/usr/bin/env bash
# Stop leftover cursor-voice processes (old multi-port setup).
set -euo pipefail
for port in 8787 8790 5179; do
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids}" ]]; then
    echo "Stopping port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
done
echo "Done. Start fresh with: npm start"
