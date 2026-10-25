"""Run the durable upgrade job with an isolated filesystem and fake system services."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class UpdateRunnerTest(unittest.TestCase):
    def run_job(self, fail=False):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)
            root=base/'managed';home=base/'home';job=root/'jobs'/'test-job';bin_dir=base/'bin'
            for path in [job,bin_dir,home/'.local/bin',home/'.hermes/hermes-agent',base/'systemd/system']:
                path.mkdir(parents=True,exist_ok=True)
            (root/'managed').touch();(root/'version').write_text('v0.22.5\n');(root/'commit').write_text('old-commit\n')
            profile=home/'.hermes'
            config=b'model:\n  provider: custom\n  default: user-model\n'
            secret=b'COMPANION_PRIVATE_TEST_KEY=keep-test-value\n'
            (profile/'config.yaml').write_bytes(config);(profile/'.env').write_bytes(secret)
            (job/'operation').write_text('update');(job/'input.json').write_text('{}')
            (job/'health.py').write_text('pass\n')
            (job/'configure.py').write_text('raise RuntimeError("Configuration must not be rewritten during an upgrade")\n')
            os_release=base/'os-release';os_release.write_text('ID=ubuntu\nVERSION_ID=24.04\n')
            service=base/'systemd/system/hermes-companion-agent.service'
            service.write_text('Existing managed service with a user override\n')
            calls=base/'service-calls'
            scripts={
                'systemctl': f'printf "%s\\n" "$*" >> "{calls}"\nexit 0\n',
                'loginctl':'exit 0\n',
                'id':'echo 1001\n',
                'df':'echo "Filesystem 1M-blocks Used Available Use% Mounted"\necho "test 10000 100 9900 1% /"\n',
                'runuser': '''while [ "$1" != -- ]; do shift; done
shift
case "$*" in
  *"git "*"describe"*) echo v0.22.6; exit 0 ;;
  *"git "*"rev-parse"*) echo 1111111111111111111111111111111111111111; exit 0 ;;
esac
exec "$@"
''',
            }
            for name,body in scripts.items():
                path=bin_dir/name;path.write_text('#!/bin/sh\n'+body);path.chmod(0o755)
            launcher=home/'.local/bin/hermes'
            launcher.write_text('#!/bin/sh\n'+('exit 23\n' if fail else 'test "$1" = update\nprintf "Native updater completed.\\n"\n'))
            launcher.chmod(0o755)
            script=Path('src/scripts/deploy-runner.sh').read_text()
            for old,new in [('/var/lib/hermes-companion',str(root)),('/home/hermes',str(home)),('/etc/os-release',str(os_release)),('/run/systemd/system',str(base/'systemd/system')),('/etc/systemd/system',str(base/'systemd/system'))]:
                script=script.replace(old,new)
            (job/'run.sh').write_text(script)
            result=subprocess.run(['bash',str(job/'run.sh')],env={**os.environ,'PATH':str(bin_dir)+':'+os.environ['PATH']},capture_output=True,text=True,timeout=20)
            self.assertEqual(result.returncode,1 if fail else 0,result.stderr)
            self.assertEqual((profile/'config.yaml').read_bytes(),config)
            self.assertEqual((profile/'.env').read_bytes(),secret)
            self.assertEqual(service.read_text(),'Existing managed service with a user override\n')
            self.assertFalse((job/'input.json').exists())
            backups=list((root/'backups').glob('*/profile.tar.gz'))
            self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].stat().st_mode & 0o777,0o600)
            state=(job/'state').read_text();self.assertIn('state='+('failed' if fail else 'succeeded'),state)
            self.assertNotIn('keep-test-value',(job/'events.log').read_text())
            self.assertEqual((root/'version').read_text().strip(),'v0.22.5' if fail else 'v0.22.6')
            if fail:
                self.assertIn('stop hermes-companion-agent.service',calls.read_text())
                self.assertIn('restart hermes-companion-agent.service',calls.read_text())
            else:
                self.assertIn('restart hermes-companion-agent.service',calls.read_text())

    def test_upgrade_preserves_connections_and_restarts_the_service(self):
        self.run_job()

    def test_failed_upgrade_keeps_backup_configuration_and_installed_version(self):
        self.run_job(fail=True)


if __name__=='__main__':
    unittest.main()
