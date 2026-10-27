#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${SHARE_BACKUPS:?}"
# Serialize with the entire backup window, including stop and restart. A oneshot
# backup remains 'activating', so is-active alone cannot detect that window.
exec 9>"$SHARE_BACKUPS/.backup.lock"
flock -n 9 || exit 0
# An intentional stop must remain stopped (restore/maintenance). Crashes are
# handled by Restart=on-failure; health only repairs a running hung service.
systemctl --user is-active --quiet foundation-share.service || exit 0
if ! curl --fail --silent --max-time 5 http://127.0.0.1:19487/v1/oauth >/dev/null; then
  systemctl --user restart foundation-share.service
fi
