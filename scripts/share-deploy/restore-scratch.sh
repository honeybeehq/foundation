#!/usr/bin/env bash
set -euo pipefail
umask 077
if [ "$#" != 2 ]; then echo 'usage: restore-scratch.sh BACKUP NEW_SCRATCH_DIR' >&2; exit 2; fi
python3 - "$1" "$2" <<'PY'
import json, pathlib, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((source / 'BACKUP.json').read_text())
if manifest.get('scope') != 'complete-local-store' or manifest.get('backendIncluded') is not True:
    raise SystemExit('Not a complete local snapshot')
# Never overwrite an existing restore target or touch production.
target.mkdir(mode=0o700)
(target / 'metadata').mkdir(mode=0o700)
shutil.copy2(source / 'metadata.json', target / 'metadata' / 'metadata.json')
shutil.copytree(source / 'comb-store', target / 'objects')
config = (source / 'comb-config.toml').read_text()
# This deployment generates a single absolute root in its private Comb config.
import re
config, count = re.subn(r'^root = .*$', 'root = ' + json.dumps(str((target / 'objects').resolve())), config, flags=re.M)
if count != 1: raise SystemExit('expected exactly one local backend root')
(target / 'comb').mkdir(mode=0o700)
(target / 'comb' / 'config.toml').write_text(config)
(target / 'comb' / 'config.toml').chmod(0o600)
if not isinstance(json.loads((target / 'metadata' / 'metadata.json').read_text()), dict):
    raise SystemExit('invalid metadata')
print('Complete snapshot restored to scratch; production unchanged')
PY
