#!/data/data/com.termux/files/usr/bin/bash
# CipherNexus Termux deploy helper
# Usage: ./termux_push.sh /sdcard/Download/ciphernexus <github-repo-url>
SRC="$1"
REPO="$2"
if [ -z "$SRC" ] || [ -z "$REPO" ]; then echo "Usage: $0 /path/to/project https://github.com/user/repo.git"; exit 1; fi
cd "$SRC"
pkg install -y git >/dev/null 2>&1 || true
termux-setup-storage >/dev/null 2>&1 || true
if [ ! -d .git ]; then git init; git remote add origin "$REPO" || git remote set-url origin "$REPO"; fi
git add -A
git commit -m "Deploy CipherNexus" || true
git branch -M main || true
git push -u origin main --force
echo "Pushed to $REPO (main)"
