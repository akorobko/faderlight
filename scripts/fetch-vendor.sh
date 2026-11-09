#!/usr/bin/env bash
# Downloads RME reference material into the gitignored docs/vendor/ folder.
set -euo pipefail
cd "$(dirname "$0")/../docs/vendor"
base=https://www.rme-audio.de/downloads
files=(
  osc_table_totalmix_new.zip      # classic OSC table (OscTableTotalMix_240722, TotalMix FX 1.96)
  fface_ufx3_e.pdf                # Fireface UFX III manual
  tmfx21_streamDeckPlugin_2.zip   # RME's Stream Deck proof of concept (Global OSC, alpha) - reference only
)
for f in "${files[@]}"; do
  echo "fetching $f"
  curl -fsSL -o "$f" "$base/$f"
done
echo "done. Missing: official Global OSC protocol table for TotalMix FX 2.10 (see docs/design/05-agentic-plan.md, M0.2)."
