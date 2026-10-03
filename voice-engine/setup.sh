#!/usr/bin/env bash
# Sets up the local voice-engine: Python venv with Supertonic + Piper, and the
# Piper voices the default router needs. Idempotent.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$REPO_ROOT/.venv"

command -v uv >/dev/null 2>&1 || { echo "error: uv is required (https://docs.astral.sh/uv/)" >&2; exit 1; }

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating venv at $VENV ..."
  uv venv "$VENV" --python 3.12
fi

echo "Installing supertonic + piper-tts ..."
uv pip install --python "$VENV/bin/python" "supertonic==1.3.1" "piper-tts==1.8.0"

echo "Downloading default Piper voices (English, Nepali) ..."
"$VENV/bin/python" -m piper.download_voices en_US-lessac-medium --data-dir "$REPO_ROOT/models/piper"
"$VENV/bin/python" -m piper.download_voices ne_NP-chitwan-medium --data-dir "$REPO_ROOT/models/piper"

echo ""
echo "Done. Supertonic weights auto-download on first synthesis (~/.cache/supertonic3)."
echo "Then: pnpm install && pnpm run compare:en"
