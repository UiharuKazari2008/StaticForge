#!/usr/bin/env bash
# Old vs new, interleaved. Two browsers already up: old profile on :9361, new profile on :9362 (swap.js).
#   newmatrix.sh <tag> "<rates>" <reps> "<variants>" [extra measure.js args]   (miniport early unless --miniport given)
set -uo pipefail
cd "$(dirname "$0")"
TAG="$1"; RATES="$2"; REPS="$3"; VARIANTS="$4"; shift 4
W="$HOME/.cache/claude-run/1408"; mkdir -p runs-newcode "$W/frames"
mp=(--miniport early); [[ " $* " == *" --miniport "* ]] && mp=()
for rate in $RATES; do
  for i in $(seq 1 "$REPS"); do
    for v in $VARIANTS; do
      port=9362; [ "$v" = old ] && port=9361
      label="$TAG-$v-r$rate-$i"
      if ! CDP_PORT=$port timeout 280 node measure.js --label "$label" --variant "$v" --rate "$rate" "${mp[@]}" --shots --shotdir "$W/frames/$label" --out "$PWD/runs-newcode" "$@" >/dev/null 2>"$W/$label.err"; then echo "$label FAILED: $(tail -n 2 "$W/$label.err" | tr '\n' ' ' | cut -c1-200)"; continue; fi
      node classify.js "runs-newcode/$label.json" "$W/frames/$label" >/dev/null && node line.js "runs-newcode/$label.json"
    done
  done
done
echo "MATRIX $TAG done"
