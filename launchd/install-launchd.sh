#!/usr/bin/env bash
# install-launchd.sh — install / reinstall / uninstall personal launchd jobs.
#
# Usage:
#   ./install-launchd.sh                 # install all *.plist in this dir
#   ./install-launchd.sh install <name>  # install a specific plist (name without .plist)
#   ./install-launchd.sh uninstall <name>
#   ./install-launchd.sh status          # list all installed personal-tools jobs + last run
#
# Behavior:
#   - lint plist first (plutil)
#   - copy (not symlink) into ~/Library/LaunchAgents/  (snapshot semantics)
#   - launchctl unload existing -> launchctl load -w  (idempotent)
#   - create log dir if missing
#
# Conventions:
#   - All plists this script touches MUST have Label starting with "personal." or "personal-tools."
#     (refuses to touch e.g. com.apple.* or homebrew.* by accident)

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/personal-tools"
LABEL_PREFIX_RE='^(personal\.|personal-tools\.)'

mkdir -p "$LOG_DIR"

err() { echo "✗ $*" >&2; }
ok()  { echo "✓ $*"; }
info(){ echo "  $*"; }

extract_label() {
    local plist="$1"
    /usr/libexec/PlistBuddy -c 'Print :Label' "$plist" 2>/dev/null
}

lint() {
    local plist="$1"
    plutil -lint "$plist" >/dev/null
}

guard_label() {
    local label="$1"
    if [[ ! "$label" =~ $LABEL_PREFIX_RE ]]; then
        err "label '$label' missing required prefix (personal.* / personal-tools.*); refusing to touch"
        return 1
    fi
}

install_one() {
    local plist="$1"
    local name target label
    name="$(basename "$plist" .plist)"
    target="$TARGET_DIR/$name.plist"

    [[ -f "$plist" ]] || { err "no such plist: $plist"; return 1; }
    lint "$plist"

    label="$(extract_label "$plist")"
    [[ -n "$label" ]] || { err "could not read Label from $plist"; return 1; }
    guard_label "$label"

    if launchctl list | awk '{print $3}' | grep -qx "$label"; then
        info "already loaded → unload first ($label)"
        launchctl unload "$target" 2>/dev/null || true
    fi

    cp "$plist" "$target"
    chmod 644 "$target"
    launchctl load -w "$target"

    if launchctl list | awk '{print $3}' | grep -qx "$label"; then
        ok "installed: $label  (plist: $target)"
        info "logs: $LOG_DIR/${name#personal.}.{out,err}.log (per plist's StandardOutPath)"
    else
        err "load reported success but label '$label' not in launchctl list"
        return 1
    fi
}

uninstall_one() {
    local name="$1"
    local target="$TARGET_DIR/$name.plist"
    local label

    if [[ ! -f "$target" ]]; then
        info "nothing to uninstall: $target does not exist"
        return 0
    fi

    label="$(extract_label "$target" || echo "$name")"
    guard_label "$label"

    launchctl unload "$target" 2>/dev/null || true
    rm "$target"
    ok "uninstalled: $label  (removed $target)"
}

status_all() {
    echo "Installed personal-tools launchd jobs:"
    local found=0
    for f in "$TARGET_DIR"/personal.*.plist "$TARGET_DIR"/personal-tools.*.plist; do
        [[ -f "$f" ]] || continue
        found=1
        local label name
        label="$(extract_label "$f")"
        name="$(basename "$f" .plist)"
        local listed pid status
        listed="$(launchctl list | awk -v l="$label" '$3 == l {print $1, $2}' || true)"
        if [[ -n "$listed" ]]; then
            pid="$(echo "$listed" | awk '{print $1}')"
            status="$(echo "$listed" | awk '{print $2}')"
            echo "  ✓ $label  (pid=$pid  last-exit=$status  plist=$name.plist)"
        else
            echo "  ✗ $label  (file present but NOT loaded)"
        fi
    done
    [[ $found -eq 1 ]] || echo "  (none)"

    echo
    echo "Recent logs (tail -1):"
    for log in "$LOG_DIR"/*.log; do
        [[ -f "$log" ]] || continue
        echo "  $(basename "$log"):"
        tail -n 1 "$log" 2>/dev/null | sed 's/^/    /' || true
    done
}

main() {
    local cmd="${1:-install_all}"
    case "$cmd" in
        install_all|"")
            local count=0
            for plist in "$SRC_DIR"/personal.*.plist "$SRC_DIR"/personal-tools.*.plist; do
                [[ -f "$plist" ]] || continue
                install_one "$plist"
                count=$((count + 1))
            done
            [[ $count -gt 0 ]] || info "no plists found in $SRC_DIR (nothing to install)"
            ;;
        install)
            local name="${2:?usage: install <name-without-.plist>}"
            install_one "$SRC_DIR/$name.plist"
            ;;
        uninstall)
            local name="${2:?usage: uninstall <name-without-.plist>}"
            uninstall_one "$name"
            ;;
        status)
            status_all
            ;;
        *)
            err "unknown command: $cmd"
            echo "Usage: $0 [install_all | install <name> | uninstall <name> | status]" >&2
            exit 2
            ;;
    esac
}

main "$@"
