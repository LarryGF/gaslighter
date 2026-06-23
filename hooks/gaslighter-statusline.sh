#!/usr/bin/env bash
flag="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.gaslighter-active"
[ -f "$flag" ] || exit 0

mode=$(head -n1 "$flag" | tr -d '[:space:]')

if [ -z "$mode" ] || [ "$mode" = "full" ]; then
    printf '\033[38;5;167m[GASLIGHTER]\033[0m'
else
    printf '\033[38;5;167m[GASLIGHTER:%s]\033[0m' "$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
fi
