#!/bin/sh
set -eu
if [ -f /data/state/firebase-export-metadata.json ]; then
  exec node /app/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --project demo-rivet --only auth,firestore --import=/data/state --export-on-exit=/data/state
fi
exec node /app/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --project demo-rivet --only auth,firestore --export-on-exit=/data/state
