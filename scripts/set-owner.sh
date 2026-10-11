#!/usr/bin/env sh
# Replace the OWNER placeholder with the real GitHub username in every tracked
# text file (README badges/links, LICENSE, package.json, CHANGELOG links, issue
# templates, the JS header, docs...). Run once, before the first push.
#
#   sh scripts/set-owner.sh <github-username>
#
# Checks only whole-word OWNER, skips .git/ and node_modules/, and prints what changed.
set -eu
NEW="${1:-}"
case "$NEW" in
  ""|*[!A-Za-z0-9-]*) echo "usage: sh scripts/set-owner.sh <github-username> (letters, digits, '-')" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
FILES=$(git ls-files | grep -v -e '^scripts/set-owner.sh$' -e '\.png$' -e '\.gif$' | xargs grep -l -w 'OWNER' || true)
[ -n "$FILES" ] || { echo "No OWNER placeholders left."; exit 0; }
for f in $FILES; do
  sed -i.bak "s/\bOWNER\b/$NEW/g" "$f" && rm -f "$f.bak"
  echo "updated: $f"
done
echo
echo "Remaining matches (should be none):"
git ls-files | grep -v -e '^scripts/set-owner.sh$' -e '\.png$' | xargs grep -n -w 'OWNER' || echo "  none"
