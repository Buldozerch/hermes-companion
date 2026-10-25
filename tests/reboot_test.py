"""Verify reboot scheduling and operation locks without rebooting a real machine."""
import fcntl
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class RebootTest(unittest.TestCase):
    def run_request(self, active='', lock=None, fail=False):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);root=base/'managed';root.mkdir();bin_dir=base/'bin';bin_dir.mkdir()
            calls=base/'scheduled'
            systemctl=bin_dir/'systemctl'
            systemctl.write_text('#!/bin/sh\n[ "$3" = "'+active+'" ]\n');systemctl.chmod(0o755)
            runner=bin_dir/'systemd-run'
            runner.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "'+str(calls)+'"\nexit '+('1' if fail else '0')+'\n');runner.chmod(0o755)
            script=base/'reboot.sh';script.write_text(Path('src/scripts/reboot-server.sh').read_text().replace('/var/lib/hermes-companion',str(root)))
            held=(root/lock).open('w') if lock else None
            try:
                if held: fcntl.flock(held,fcntl.LOCK_EX | fcntl.LOCK_NB)
                result=subprocess.run(['sh',str(script)],env={**os.environ,'PATH':str(bin_dir)+':'+os.environ['PATH']},capture_output=True,text=True,timeout=10)
            finally:
                if held: held.close()
            self.assertEqual(result.returncode,0,result.stderr)
            return result.stdout.strip(),calls.read_text() if calls.exists() else None

    def test_acknowledges_a_delayed_system_reboot(self):
        status,command=self.run_request()
        self.assertEqual(status,'reboot_scheduled')
        self.assertIn('--on-active=5s',command)
        self.assertIn('--timer-property=AccuracySec=1s',command)
        self.assertTrue(command.strip().endswith('/usr/sbin/reboot'))

    def test_active_server_job_blocks_reboot(self):
        self.assertEqual(self.run_request(active='hermes-companion-install.service'),('busy',None))

    def test_both_server_operation_locks_block_reboot(self):
        for lock in ['launch.lock','install.lock']:
            with self.subTest(lock=lock): self.assertEqual(self.run_request(lock=lock),('busy',None))

    def test_an_already_scheduled_reboot_is_not_queued_again(self):
        self.assertEqual(self.run_request(active='hermes-companion-reboot.timer'),('reboot_scheduled',None))

    def test_scheduling_failure_does_not_claim_success(self):
        status,_=self.run_request(fail=True)
        self.assertEqual(status,'failed')


if __name__=='__main__': unittest.main()
