#!/usr/bin/env bash
set -euo pipefail
umask 077
# The unit sets these absolute paths; do not include credentials in this script.
: "${SHARE_FOUNDATION:?}" "${SHARE_CONFIG:?}" "${SHARE_BACKUPS:?}" "${SHARE_COMB_CONFIG:?}"
mkdir -p "$SHARE_BACKUPS"
exec 9>"$SHARE_BACKUPS/.backup.lock"
flock -w 120 9
was_active=false
if systemctl --user is-active --quiet foundation-share.service; then was_active=true; fi
restart() { if "$was_active"; then systemctl --user start foundation-share.service; fi; }
trap restart EXIT
systemctl --user stop foundation-share.service
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$SHARE_BACKUPS/$stamp"
"$SHARE_FOUNDATION" share backup "$destination" --config "$SHARE_CONFIG"
# Matching tenant/digest config is secret and stays outside repositories.
if ! cp "$SHARE_COMB_CONFIG" "$destination/comb-config.toml"; then
  # Do not leave a snapshot labelled complete without its matching secret config.
  rm -rf -- "$destination"
  exit 1
fi
chmod 600 "$destination/comb-config.toml"
# Prune only complete snapshots created by this script, after a successful backup.
python3 - "$SHARE_BACKUPS" <<'PY'
import datetime, json, pathlib, shutil, sys
root = pathlib.Path(sys.argv[1])
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
for entry in root.iterdir():
    try:
        created = datetime.datetime.strptime(entry.name, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
        manifest = json.loads((entry / 'BACKUP.json').read_text())
    except (ValueError, OSError):
        continue
    if created < cutoff and manifest.get('scope') == 'complete-local-store' and manifest.get('backendIncluded') is True:
        shutil.rmtree(entry)
PY
