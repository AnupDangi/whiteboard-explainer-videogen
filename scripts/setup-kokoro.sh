#!/usr/bin/env bash
# Creates (once) a persistent Kokoro TTS venv inside the repo, instead of /tmp
# (which gets wiped, forcing a manual rebuild every session — this was the
# actual reliability problem, not the model itself). Idempotent: safe to
# re-run; skips work if the venv already has kokoro-mlx installed.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.kokoro-venv"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required (https://docs.astral.sh/uv/). Install it, then re-run this script." >&2
  exit 1
fi
if ! command -v espeak-ng >/dev/null 2>&1; then
  echo "error: espeak-ng is required. Install with: brew install espeak-ng" >&2
  exit 1
fi

if [ -x "$VENV_DIR/bin/python" ] && "$VENV_DIR/bin/python" -c "import kokoro_mlx" >/dev/null 2>&1; then
  echo "Kokoro venv already set up at $VENV_DIR"
else
  echo "Creating persistent Kokoro venv at $VENV_DIR ..."
  uv venv "$VENV_DIR"
  uv pip install --python "$VENV_DIR/bin/python" kokoro-mlx \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
  echo "Kokoro venv ready at $VENV_DIR"
fi

echo ""
echo "KOKORO_PYTHON=$VENV_DIR/bin/python"
echo "Add that line to .env (or export it) if not already present."
