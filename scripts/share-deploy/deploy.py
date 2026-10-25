#!/usr/bin/env python3
"""Render user units for an already pinned Foundation and Comb install (no secrets)."""
import argparse, json, os, pathlib, shlex, shutil, tempfile
from urllib.parse import urlsplit
p = argparse.ArgumentParser()
p.add_argument('--foundation', required=True, type=pathlib.Path)
p.add_argument('--comb-bridge', required=True, type=pathlib.Path)
p.add_argument('--node-bin', required=True, type=pathlib.Path)
p.add_argument('--public-url', required=True)
p.add_argument('--owner', action='append', required=True)
a = p.parse_args()
origin = urlsplit(a.public_url)
if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
    raise SystemExit('--public-url must be an HTTPS origin')
public_url = a.public_url.rstrip('/')
home = pathlib.Path.home()
base = home / '.config/foundation-share/data'
config_dir = home / '.config/foundation-share'
units = home / '.config/systemd/user'
for directory in (base, config_dir, units, base/'metadata', base/'objects', base/'comb', base/'backups', base/'bin'):
    directory.mkdir(parents=True, exist_ok=True)
    if directory != units: directory.chmod(0o700)
for source in pathlib.Path(__file__).parent.glob('*.sh'):
    shutil.copy2(source, base/'bin'/source.name)
# Initialize the brand-new empty registry so the first nightly backup also works.
metadata = base/'metadata/metadata.json'
if not metadata.exists():
    import subprocess
    if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', 'foundation-share.service']).returncode == 0:
        raise SystemExit('Stop foundation-share before initializing an empty registry')
    with metadata.open('x') as file: json.dump(dict(version=1, spaces=[]), file)
    metadata.chmod(0o600)
# Never overwrite operator configuration (especially after App provisioning).
comb_config = base/'comb/config.toml'
if not comb_config.exists():
    import secrets
    comb_config.write_text('tenant = "foundation-share"\ndigest_key = "' + secrets.token_hex(32) + '"\n[backend]\nkind = "local"\nroot = ' + json.dumps(str(base/'objects')) + '\n')
    comb_config.chmod(0o600)
service_config = config_dir/'service.json'
if not service_config.exists():
    service_config.write_text(json.dumps(dict(host='127.0.0.1', port=19487, publicUrl=public_url, allowedRepoOwners=a.owner, stateDir=str(base/'metadata'), comb=dict(binary=str(a.comb_bridge.resolve()), args=['--dir', str(base/'comb')]), backupLocalStore=str(base/'objects')), indent=2)+'\n')
    service_config.chmod(0o600)
# Add required deployment pins without discarding App configuration or secrets.
value = json.loads(service_config.read_text())
if value.get('publicUrl', public_url) != public_url or sorted(value.get('allowedRepoOwners', a.owner)) != sorted(a.owner):
    raise SystemExit('Existing public URL/owner pins differ; edit the private configuration deliberately')
value['publicUrl'], value['allowedRepoOwners'] = public_url, a.owner
fd, temporary = tempfile.mkstemp(prefix='service-render-', suffix='.json', dir=config_dir)
with os.fdopen(fd, 'w') as file:
    json.dump(value, file, indent=2)
    file.write('\n')
    file.flush()
    os.fsync(file.fileno())
os.replace(temporary, service_config)
# App path is added only once a real private config exists; absent credential fails closed.
# No fake account or credential is presented as production auth.
common = 'Environment="PATH=' + str(a.node_bin.resolve()) + ':/usr/local/bin:/usr/bin:/bin"\nUMask=0077\nNoNewPrivileges=yes\n'
foundation = str(a.foundation.resolve())
def unit(name, text): (units/name).write_text(text)
unit('foundation-share.service', '[Unit]\nDescription=Foundation encrypted team sharing (tailnet only)\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=0\n\n[Service]\nType=simple\n' + common + 'ExecStart=' + shlex.quote(foundation) + ' share serve --config ' + shlex.quote(str(service_config)) + '\nRestart=always\nRestartSec=3\nTimeoutStopSec=45\n\n[Install]\nWantedBy=default.target\n')
env = dict(SHARE_FOUNDATION=foundation, SHARE_CONFIG=str(service_config), SHARE_BACKUPS=str(base/'backups'), SHARE_COMB_CONFIG=str(comb_config))
unit('foundation-share-backup.service', '[Unit]\nDescription=Stopped Foundation share snapshot with seven-day retention\n\n[Service]\nType=oneshot\n' + common + ''.join('Environment="'+k+'='+v+'"\n' for k,v in env.items()) + 'ExecStart='+str(base/'bin/backup.sh')+'\nTimeoutStartSec=15min\n')
unit('foundation-share-backup.timer', '[Unit]\nDescription=Nightly Foundation share backup\n\n[Timer]\nOnCalendar=*-*-* 03:15:00\nRandomizedDelaySec=10min\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n')
unit('foundation-share-health.service', '[Unit]\nDescription=Foundation share HTTP health check\n\n[Service]\nType=oneshot\n' + common + 'Environment="SHARE_BACKUPS='+str(base/'backups')+'"\nExecStart='+str(base/'bin/health.sh')+'\n')
unit('foundation-share-health.timer', '[Unit]\nDescription=Foundation share minute health check\n\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\n\n[Install]\nWantedBy=timers.target\n')
print('Rendered private local-backend configuration and user service/backup/health units; App auth remains unconfigured until provisioned')
