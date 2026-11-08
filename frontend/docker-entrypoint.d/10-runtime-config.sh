#!/bin/sh
set -eu

template=/etc/fleetguard/runtime-config.js.template
output=/usr/share/nginx/html/runtime-config.js
temporary_output="${output}.tmp"

envsubst '${VITE_API_BASE_URL} ${VITE_WS_URL}' < "$template" > "$temporary_output"
mv -f "$temporary_output" "$output"
