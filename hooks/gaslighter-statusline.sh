#!/usr/bin/env bash
mode="${GASLIGHTER_MODE:-full}"
mode=$(printf '%s' "$mode" | tr '[:upper:]' '[:lower:]')
[ "$mode" = "off" ] && exit 0

if [ "$mode" = "full" ]; then
    printf '\033[38;5;167m[GASLIGHTER]\033[0m'
else
    printf '\033[38;5;167m[GASLIGHTER:%s]\033[0m' "$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
fi
