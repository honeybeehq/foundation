"""Exercise the backup stop-result boundary without a real systemd service."""
import os, pathlib, subprocess, tempfile, unittest
SCRIPT=pathlib.Path(__file__).with_name('backup.sh')
class BackupStopResult(unittest.TestCase):
    def run_backup(self, result):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory); binaries=root/'bin';binaries.mkdir()
            systemctl=binaries/'systemctl'
            systemctl.write_text('#!/bin/sh\necho "$*" >> "$TEST_CALLS"\ncase "$*" in\n*"show -p Result"*) echo "$TEST_RESULT";;\nesac\nexit 0\n')
            systemctl.chmod(0o700)
            foundation=binaries/'foundation'
            foundation.write_text('#!/bin/sh\nmkdir -p "$3"\nprintf "{}" > "$3/BACKUP.json"\necho called > "$TEST_BACKUP_CALLED"\n')
            foundation.chmod(0o700)
            config=root/'comb.toml';config.write_text('fixture-only')
            env={**os.environ,'PATH':str(binaries)+':'+os.environ['PATH'],'TEST_RESULT':result,'TEST_CALLS':str(root/'calls'),'TEST_BACKUP_CALLED':str(root/'called'),'SHARE_FOUNDATION':str(foundation),'SHARE_CONFIG':str(root/'service.json'),'SHARE_BACKUPS':str(root/'backups'),'SHARE_COMB_CONFIG':str(config)}
            completed=subprocess.run(['bash',str(SCRIPT)],env=env,capture_output=True,text=True)
            return completed,(root/'called').exists(),(root/'calls').read_text(),sum(p.is_dir() for p in (root/'backups').iterdir())
    def test_timeout_refuses_snapshot_and_restarts(self):
        result,called,calls,snapshots=self.run_backup('timeout')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(called)
        self.assertEqual(snapshots,0)
        self.assertIn('did not stop cleanly',result.stderr)
        self.assertIn('start foundation-share.service',calls)
    def test_clean_stop_allows_snapshot_and_restarts(self):
        result,called,calls,snapshots=self.run_backup('success')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(called)
        self.assertIn('start foundation-share.service',calls)
if __name__=='__main__':unittest.main()
