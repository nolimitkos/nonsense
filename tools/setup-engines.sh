#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for engine in luraph14 moonveil luaobf-good ironbrew2 goofy ironveil1 77f prometheus wearedevs hercules; do
  if ! "$ROOT/tools/ensure-engine.sh" "$engine"; then
    printf '[engine] WARNING: %s could not be prepared. It will be retried when used.\n' "$engine" >&2
  fi
done
