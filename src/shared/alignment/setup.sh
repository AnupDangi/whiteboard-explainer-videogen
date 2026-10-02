#!/usr/bin/env bash
# Sets up the local forced-alignment sidecar's Python environment:
# stable-ts (faster-whisper/CTranslate2 backend). Idempotent. Mirrors the
# same uv-based pattern used by ../../../voice-engine/setup.sh.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$REPO_ROOT/.venv"

command -v uv >/dev/null 2>&1 || { echo "error: uv is required (https://docs.astral.sh/uv/)" >&2; exit 1; }

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating venv at $VENV ..."
  uv venv "$VENV" --python 3.12
fi

echo "Installing stable-ts + faster-whisper ..."
uv pip install --python "$VENV/bin/python" -r "$REPO_ROOT/requirements.txt"

echo ""
echo "Done. The faster-whisper 'base' model auto-downloads on first use via"
echo "huggingface-hub, cached under ~/.cache/huggingface (separate from"
echo "openai-whisper's ~/.cache/whisper/*.pt files, which this sidecar does"
echo "NOT use)."
echo ""
echo "Smoke test:"
echo "  echo '{\"audioPath\":\"/path/to/some.wav\",\"text\":\"exact spoken text\"}' | \"$VENV/bin/python\" \"$REPO_ROOT/align.py\""
