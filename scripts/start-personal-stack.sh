#!/usr/bin/env bash
# start-personal-stack.sh — start | stop | status | restart | logs
#
# Brings up the localhost-only trio used by personal-web in dev:
#   1) personal-finance  (127.0.0.1:7001)
#   2) personal-agent    (127.0.0.1:7100)
#   3) personal-web Vite (127.0.0.1:5173)
#
# PIDs + logs live under PERSONAL_STACK_STATE (default ~/.local/state/personal-stack).
#
# Doc: ~/obsidian-wiki/_system/guides/personal-stack-usage.md

set -u
set -o pipefail

FINANCE_ROOT="${FINANCE_ROOT:-$HOME/personal-finance}"
WEB_ROOT="${WEB_ROOT:-$HOME/personal-web}"
AGENT_ROOT="${AGENT_ROOT:-$HOME/personal-agent}"
STATE_DIR="${PERSONAL_STACK_STATE:-$HOME/.local/state/personal-stack}"

FINANCE_PID="$STATE_DIR/finance.pid"
AGENT_PID="$STATE_DIR/agent.pid"
WEB_PID="$STATE_DIR/web.pid"
FINANCE_LOG="$STATE_DIR/finance.log"
AGENT_LOG="$STATE_DIR/agent.log"
WEB_LOG="$STATE_DIR/web.log"

port_listening() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    # fallback: bash /dev/tcp
    (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
  fi
}

http_ok() {
  local url="$1"
  curl -sf --connect-timeout 1 --max-time 3 "$url" >/dev/null 2>&1
}

wait_http() {
  local url="$1"
  local max="${2:-45}"
  local i=0
  while (( i < max )); do
    if http_ok "$url"; then
      return 0
    fi
    sleep 1
    ((i += 1)) || true
  done
  return 1
}

kill_pidfile() {
  local pf="$1"
  local name="$2"
  if [[ ! -f "$pf" ]]; then
    echo "  ($name: no pid file)"
    return 0
  fi
  local pid
  pid=$(tr -d ' \n' <"$pf" || true)
  if [[ -z "${pid:-}" ]]; then
    rm -f "$pf"
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "  stopping $name (pid $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pf"
}

cmd_start() {
  mkdir -p "$STATE_DIR"
  local failed_services=()

  if ! [[ -d "$FINANCE_ROOT" ]]; then
    echo "✗ FINANCE_ROOT not a directory: $FINANCE_ROOT" >&2
    exit 1
  fi
  if ! [[ -d "$AGENT_ROOT" ]]; then
    echo "✗ AGENT_ROOT not a directory: $AGENT_ROOT" >&2
    exit 1
  fi
  if ! [[ -d "$WEB_ROOT" ]]; then
    echo "✗ WEB_ROOT not a directory: $WEB_ROOT" >&2
    exit 1
  fi

  # --- finance ---
  if port_listening 7001; then
    echo "• finance: already listening on :7001 (skip start)"
  else
    if [[ -f "$FINANCE_PID" ]]; then
      oldpid=$(tr -d ' \n' <"$FINANCE_PID" || true)
      if [[ -n "${oldpid:-}" ]] && ! kill -0 "$oldpid" 2>/dev/null; then
        rm -f "$FINANCE_PID"
      fi
    fi
    echo "• finance: starting (make run) → $FINANCE_LOG"
    (
      cd "$FINANCE_ROOT" || exit 1
      nohup make run >>"$FINANCE_LOG" 2>&1 &
      echo $! >"$FINANCE_PID"
    )
    if wait_http "http://127.0.0.1:7001/healthz" 60; then
      echo "  ✓ finance healthy"
    else
      echo "  ✗ finance did not become healthy in time; see $FINANCE_LOG" >&2
      failed_services+=("finance")
    fi
  fi

  # --- agent ---
  if port_listening 7100; then
    echo "• agent: already listening on :7100 (skip start)"
  else
    if [[ ! -f "$AGENT_ROOT/.env" ]]; then
      echo "  ⚠ no $AGENT_ROOT/.env — agent may exit immediately; copy .env.example" >&2
    fi
    if [[ -f "$AGENT_PID" ]]; then
      oldpid=$(tr -d ' \n' <"$AGENT_PID" || true)
      if [[ -n "${oldpid:-}" ]] && ! kill -0 "$oldpid" 2>/dev/null; then
        rm -f "$AGENT_PID"
      fi
    fi
    if [[ ! -d "$AGENT_ROOT/.venv" ]]; then
      echo "  ⚠ no $AGENT_ROOT/.venv — run: cd \"$AGENT_ROOT\" && uv sync" >&2
    fi
    echo "• agent: starting (make run) → $AGENT_LOG"
    (
      cd "$AGENT_ROOT" || exit 1
      nohup make run >>"$AGENT_LOG" 2>&1 &
      echo $! >"$AGENT_PID"
    )
    if wait_http "http://127.0.0.1:7100/healthz" 60; then
      echo "  ✓ agent healthy"
    else
      echo "  ✗ agent did not become healthy in time; see $AGENT_LOG" >&2
      failed_services+=("agent")
    fi
  fi

  # --- web ---
  if port_listening 5173; then
    echo "• web: already listening on :5173 (skip start)"
  else
    if [[ ! -d "$WEB_ROOT/node_modules" ]]; then
      echo "  ✗ $WEB_ROOT/node_modules missing — run: cd \"$WEB_ROOT\" && npm install" >&2
      exit 1
    fi
    if [[ -f "$WEB_PID" ]]; then
      oldpid=$(tr -d ' \n' <"$WEB_PID" || true)
      if [[ -n "${oldpid:-}" ]] && ! kill -0 "$oldpid" 2>/dev/null; then
        rm -f "$WEB_PID"
      fi
    fi
    echo "• web: starting (npm run dev) → $WEB_LOG"
    (
      cd "$WEB_ROOT" || exit 1
      nohup npm run dev >>"$WEB_LOG" 2>&1 &
      echo $! >"$WEB_PID"
    )
    if wait_http "http://127.0.0.1:5173/" 90; then
      echo "  ✓ web responding"
    else
      echo "  ✗ web did not respond in time; see $WEB_LOG" >&2
      failed_services+=("web")
    fi
  fi

  echo
  if (( ${#failed_services[@]} > 0 )); then
    echo "stack started with failed health checks: ${failed_services[*]}" >&2
    echo "Partial bring-up only. Inspect logs with: $0 logs" >&2
    if port_listening 5173; then
      echo "Web may still be reachable at: http://127.0.0.1:5173  (chat: /chat)" >&2
    fi
    return 2
  fi

  echo "Open: http://127.0.0.1:5173  (chat: /chat)"
  if [[ "${OPEN_BROWSER:-}" == "1" ]] && command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:5173/"
  fi
}

cmd_stop() {
  echo "stopping personal stack..."
  kill_pidfile "$WEB_PID" "web"
  kill_pidfile "$AGENT_PID" "agent"
  kill_pidfile "$FINANCE_PID" "finance"
  echo "done."
}

cmd_status() {
  echo "ports:"
  for p in 7001 7100 5173; do
    if port_listening "$p"; then
      echo "  :$p LISTEN"
    else
      echo "  :$p (closed)"
    fi
  done
  echo "health:"
  http_ok "http://127.0.0.1:7001/healthz" && echo "  finance /healthz OK" || echo "  finance /healthz —"
  http_ok "http://127.0.0.1:7100/healthz" && echo "  agent   /healthz OK" || echo "  agent   /healthz —"
  http_ok "http://127.0.0.1:5173/" && echo "  web     GET / OK" || echo "  web     GET / —"
  echo "state dir: $STATE_DIR"
}

cmd_logs() {
  for f in "$FINANCE_LOG" "$AGENT_LOG" "$WEB_LOG"; do
    echo "── $(basename "$f") (last 25 lines) ──"
    if [[ -f "$f" ]]; then
      tail -n 25 "$f"
    else
      echo "(missing)"
    fi
    echo
  done
}

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local sub="${1:-}"
  case "$sub" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    restart) cmd_stop; sleep 1; cmd_start ;;
    logs) cmd_logs ;;
    help|-h|--help|"") usage ;;
    *)
      echo "unknown command: $sub" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "${1:-}"
