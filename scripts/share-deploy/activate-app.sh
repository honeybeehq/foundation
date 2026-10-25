#!/usr/bin/env bash
set -euo pipefail
umask 077
if [ "$#" != 3 ]; then echo 'usage: activate-app.sh PINNED_FOUNDATION PRIVATE_APP_CONFIG REPO_OWNER/NAME' >&2; exit 2; fi
foundation=$1
app_config=$2
repo=$3
# This prints only fixed permission/refusal results, never the installation token.
"$foundation" share github-app check --user trmdy --config "$app_config" --repo "$repo"
backup_file=$(python3 - "$app_config" <<'PY'
import json, os, pathlib, stat, sys, tempfile
app = pathlib.Path(sys.argv[1])
if not app.is_absolute() or app.is_symlink() or not app.is_file() or stat.S_IMODE(app.stat().st_mode) != 0o600:
    raise SystemExit('Expected absolute private regular App config mode0600')
config = pathlib.Path.home()/'.config/foundation-share/service.json'
value = json.loads(config.read_text())
if value.get('githubApiUrl') or value.get('githubPermissionToken'):
    raise SystemExit('Refusing to activate production App over a stub/static configuration')
fd, backup = tempfile.mkstemp(prefix='service-before-app-', suffix='.json', dir=config.parent)
with os.fdopen(fd, 'wb') as file:
    file.write(config.read_bytes())
    file.flush()
    os.fsync(file.fileno())
value['githubAppConfig'] = str(app)
target = config.with_suffix('.json.new')
fd = os.open(target, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump(value, file, indent=2)
    file.write('\n')
    file.flush()
    os.fsync(file.fileno())
os.replace(target, config)
print(backup)
PY
)
rollback() {
  cp -- "$backup_file" "$HOME/.config/foundation-share/service.json"
  chmod 600 "$HOME/.config/foundation-share/service.json"
  systemctl --user restart foundation-share.service
  echo 'App activation failed; previous service configuration restored' >&2
}
if ! systemctl --user restart foundation-share.service; then rollback; exit 1; fi
for attempt in {1..10}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:19487/v1/oauth >/dev/null; then
    echo 'App configuration activated; service HTTP health passed'
    exit 0
  fi
  sleep 1
done
rollback
exit 1
