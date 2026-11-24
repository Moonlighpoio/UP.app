#!/bin/bash
# UP · Lanzador para macOS (doble clic). Equivale a `npm start`.
cd "$(dirname "$0")" || exit 1
echo "Iniciando UP en http://localhost:3100 ..."
echo "Cierra esta ventana para detener el servidor."
npm start &
SERVER_PID=$!
sleep 1
open "http://localhost:3100"
wait "$SERVER_PID"
