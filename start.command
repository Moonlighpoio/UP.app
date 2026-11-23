#!/bin/bash
# UP · Lanzador para macOS (doble clic)
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-3100}"
echo "Iniciando UP en http://localhost:$PORT ..."
echo "Cierra esta ventana para detener el servidor."
node server.js &
SERVER_PID=$!
sleep 1
open "http://localhost:$PORT"
wait "$SERVER_PID"
