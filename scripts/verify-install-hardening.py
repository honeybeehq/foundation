#!/usr/bin/env python3
"""Real temp-HOME archive/install/version/rollback check; run from the repo root."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path.cwd()
node = shutil.which('node')
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
with tempfile.TemporaryDirectory(prefix='foundation-install-') as scratch:
    root = Path(scratch)
    home = root / 'home'
    home.mkdir()
    # 100 bytes leaves no room for tsx CLI's extra IPC directory/socket name.
    temp = root / ('t' * (100 - len(str(root)) - 1))
    temp.mkdir()
    env = {**os.environ, 'HOME': str(home), 'TMPDIR': str(temp),
           'FOUNDATION_GATEWAY_DIR': str(home / '.hive/gateways'),
           'FOUNDATION_SYNC_AUTO_OPEN': '0'}
    for key in ['FDN_ROOT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']:
        env.pop(key, None)
    def run(args):
        result = subprocess.run(args, env=env, text=True, capture_output=True)
        print(result.stdout, end='')
        if result.returncode:
            print(result.stderr, end='')
            raise RuntimeError(f'command failed ({result.returncode}): {args}')
        return result.stdout
    # A surrounding HOME repo must not supply the archive's runtime identity or
    # have its index refreshed by the archive's version query.
    run(['git', '-C', str(home), 'init', '-q'])
    (home / 'tracked').write_text('original')
    run(['git', '-C', str(home), 'add', 'tracked'])
    run(['git', '-C', str(home), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture'])
    index = home / '.git/index'
    before = (index.read_bytes(), index.stat().st_mtime_ns)
    bin = home / '.local/bin/foundation'
    bin.parent.mkdir(parents=True)
    bin.write_text('#!/bin/sh\necho original\n')
    bin.chmod(0o751)
    original = bin.read_bytes()
    cli = [node, '--import', str(repo / 'node_modules/tsx/dist/loader.mjs'), str(repo / 'packages/cli/src/main.ts')]
    print(f'CHECK TMPDIR bytes={len(str(temp))}; source={sha}')
    installed = json.loads(run(cli + ['install', '--from', str(repo)]))
    assert installed['sourceSha'] == sha
    assert len(installed['stateOutsideRollback']) == 8
    base = home / '.local/share/foundation'
    assert (base / 'rollback.json').is_file()
    assert (base / 'rollback-active').is_file()
    assert list((base / 'rollbacks').glob('*/restore.sh'))
    assert (index.read_bytes(), index.stat().st_mtime_ns) == before
    version = json.loads(run([str(bin), 'version', '--json']))
    assert version['sourceSha'] == sha and version['dirty'] is False
    run([str(bin), '--version'])
    run([str(bin), 'install', '--rollback'])
    assert bin.read_bytes() == original and bin.stat().st_mode & 0o777 == 0o751
    assert not (home / '.local/share/foundation/current').exists()
    assert not (home / '.hive/gateways/foundation.json').exists()
    assert not (home / '.local/share/foundation/install.lock').exists()
    assert (home / '.local/share/foundation/versions' / sha).exists()
    assert Path(str(bin) + '.before-foundation-install').read_bytes() == original
    assert not (base / 'rollback.json').exists()
    assert (base / 'rollback-restored.json').is_file()
    assert not (base / 'rollback-active').exists()
    assert list((base / 'rollbacks').glob('*/restore.sh'))
    assert not list((base / 'versions').glob('*.tmp'))
    print('PASS: archive install, untouched ancestor index, installed version, and rollback with 100-byte TMPDIR')
