#!/bin/bash
set -euo pipefail

read -r -s -p 'Paste your Tally API key (input is hidden): ' tally_api_key
printf '\n'
if [[ -z "$tally_api_key" ]]; then
  printf 'No key entered.\n' >&2
  exit 1
fi

security add-generic-password -U -a eventboard4SchoolOfArt -s tally-api-key -w "$tally_api_key"
unset tally_api_key
printf 'Saved in macOS Keychain for local Codex reviews.\n'
