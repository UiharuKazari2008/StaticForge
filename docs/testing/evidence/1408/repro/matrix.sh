#!/usr/bin/env bash
# Repeated cold boots (service worker stopped first), old code vs. the same with a CDP-injected preload.
#   SHOTS=<frames dir> matrix.sh "<rates>" <reps> <prefix> [extra measure.js args]
set -uo pipefail
cd "$(dirname "$0")"
RATES="$1"; REPS="$2"; PREFIX="$3"; shift 3
for rate in $RATES; do
  for i in $(seq 1 "$REPS"); do
    for variant in plain preload; do
      label="$PREFIX-$variant-r$rate-$i"
      extra=(); [ "$variant" = preload ] && extra=(--preload)
      timeout 280 node measure.js --label "$label" --rate "$rate" --showcafe --shots --shotdir "$SHOTS/$label" "${extra[@]}" "$@" >/dev/null || { echo "$label FAILED"; continue; }
      echo -n "$label "; node classify.js "runs/$label.json" "$SHOTS/$label" | cut -c1-230
    done
  done
done
