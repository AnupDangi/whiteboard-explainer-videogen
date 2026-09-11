#!/usr/bin/env bash
# Kokoro worker pool supervisor.
#
# Why a pool: kokoro-mlx is single-flight per process (`with self._lock:` in
# kokoro_mlx/kokoro.py) and has no batch API, so one server serializes every scene.
# Multi-chapter jobs queue 20 scenes and the tail waits past any sane deadline.
# N independent processes = real parallel synthesis.
#
# Each worker is wrapped in a restart loop so the server's self-recycle
# (KOKORO_RECYCLE_AFTER) and crash recovery both bring the port back with a clean
# Metal buffer pool. MKL cache is capped/released in-process (see kokoro_tts.py).
#
# Usage:
#   scripts/kokoro_pool.sh start [N] [base_port]
#   scripts/kokoro_pool.sh stop
#   scripts/kokoro_pool.sh status
#
# Env: KOKORO_PYTHON (default .kokoro-venv/bin/python), KOKORO_POOL_STATE
#      (default .data/kokoro-pool), KOKORO_POOL_MIN_FREE_MB (default 4096)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${KOKORO_PYTHON:-$REPO_ROOT/.kokoro-venv/bin/python}"
STATE="${KOKORO_POOL_STATE:-$REPO_ROOT/.data/kokoro-pool}"
MIN_FREE_MB="${KOKORO_POOL_MIN_FREE_MB:-4096}"
RECYCLE_AFTER="${KOKORO_RECYCLE_AFTER:-0}"
mkdir -p "$STATE"
STOP_FLAG="$STATE/stop"

free_mb() {
  # free + speculative pages * page size (16 KB on Apple silicon)
  vm_stat 2>/dev/null | awk '/Pages free|Pages speculative/ {gsub(/\./,""); s+=$3} END {printf "%d", (s*16384)/1048576}'
}

kill_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
  # the supervisor loop respawns children; kill by process group where possible
  pkill -P "$pid" 2>/dev/null || true
}

start_worker() {
  local port="$1"
  local pidfile="$STATE/$port.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "port $port already running (pid $(cat "$pidfile"))"
    return 0
  fi
  nohup env KOKORO_RECYCLE_AFTER="$RECYCLE_AFTER" \
    bash -c 'port="$1"; py="$2"; stop="$3"; root="$4"
      while [ ! -f "$stop" ]; do
        "$py" "$root/scripts/kokoro_server.py" --port "$port" || true
        sleep 1
      done' _ "$port" "$PYTHON" "$STOP_FLAG" "$REPO_ROOT" \
    >"$STATE/$port.log" 2>&1 &
  echo $! > "$pidfile"
  echo "started port $port (supervisor pid $(cat "$pidfile"))"
}

case "${1:-start}" in
  start)
    N="${2:-3}"
    BASE="${3:-8765}"
    rm -f "$STOP_FLAG"
    if [ ! -x "$PYTHON" ]; then
      echo "error: $PYTHON not found. Run npm run kokoro:setup first." >&2
      exit 1
    fi
    FREE="$(free_mb)"
    if [ "$FREE" -lt "$MIN_FREE_MB" ] && [ "$N" -gt 1 ]; then
      echo "warn: only ${FREE} MB free (< ${MIN_FREE_MB} MB) — reducing pool to 1 worker" >&2
      N=1
    fi
    for i in $(seq 0 $((N-1))); do start_worker $((BASE+i)); done
    echo "waiting for health..."
    for i in $(seq 0 $((N-1))); do
      port=$((BASE+i))
      for _ in $(seq 1 120); do
        if curl -sf -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then echo "  $port up"; break; fi
        sleep 1
      done
      curl -sf -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1 || echo "  $port FAILED to become healthy (see $STATE/$port.log)" >&2
    done
    ;;
  stop)
    touch "$STOP_FLAG"
    for pidfile in "$STATE"/*.pid; do
      [ -f "$pidfile" ] || continue
      kill_pid "$(cat "$pidfile")"
      rm -f "$pidfile"
    done
    pkill -f 'scripts/kokoro_server.py' 2>/dev/null || true
    echo "stopped"
    ;;
  status)
    for pidfile in "$STATE"/*.pid; do
      [ -f "$pidfile" ] || continue
      port="$(basename "$pidfile" .pid)"
      pid="$(cat "$pidfile")"
      if kill -0 "$pid" 2>/dev/null; then printf 'port %s: supervisor pid %s — ' "$port" "$pid"; else printf 'port %s: DOWN — ' "$port"; fi
      curl -sf -m 2 "http://127.0.0.1:$port/health" || echo "(no health)"
      echo
    done
    ;;
  *)
    echo "usage: $0 start [N] [base_port] | stop | status" >&2
    exit 2
    ;;
esac
