"""Install optional Antigravity components without changing the selected model or account."""
import pwd
import subprocess

account = pwd.getpwnam('hermes')
run_as_user = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes', 'HERMES_HOME=/home/hermes/.hermes',
               'PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin', 'XDG_RUNTIME_DIR=/run/user/' + str(account.pw_uid)]
program = r'''
import json, os, re, subprocess, tempfile, urllib.request
from pathlib import Path
launcher = str(Path.home() / '.local/bin/hermes')
agy = Path.home() / '.local/bin/agy'
if not agy.is_file():
    print('Downloading the official Google Antigravity CLI installer.', flush=True)
    with urllib.request.urlopen('https://antigravity.google/cli/install.sh', timeout=30) as response:
        installer = response.read(2 * 1024 * 1024 + 1)
    if len(installer) > 2 * 1024 * 1024:
        raise SystemExit('The official Antigravity installer exceeded the size limit.')
    with tempfile.TemporaryDirectory(prefix='hermes-companion-agy-') as temporary:
        path = Path(temporary) / 'install.sh'
        path.write_bytes(installer)
        path.chmod(0o700)
        # The official installer verifies the manifest SHA-512 before installing the binary.
        subprocess.run(['bash', str(path), '--dir', str(agy.parent)], check=True, timeout=300)
from providers import get_provider_profile
if not get_provider_profile('antigravity-oauth'):
    request = urllib.request.Request('https://api.github.com/repos/neerazz/hermes-antigravity-oauth/commits/main', headers={'User-Agent': 'Hermes-Companion'})
    with urllib.request.urlopen(request, timeout=30) as response:
        revision = json.load(response)['sha']
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise SystemExit('The provider plugin release reference is invalid.')
    print('Installing the Antigravity Hermes plugin at commit ' + revision + '.', flush=True)
    subprocess.run([launcher, 'plugins', 'install', 'https://github.com/neerazz/hermes-antigravity-oauth', '--ref', revision, '--enable'], check=True, stdin=subprocess.DEVNULL, timeout=300)
subprocess.run([str(agy), '--version'], check=True, stdin=subprocess.DEVNULL, timeout=15)
print('Antigravity support prepared. Google sign-in remains a separate user action.', flush=True)
'''
resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
import json
command = json.loads(subprocess.check_output(run_as_user + ['env', 'PYTHONPATH=/home/hermes/.hermes/hermes-agent', 'python3', '-c', resolver, '/home/hermes/.hermes/hermes-agent', program], text=True))
subprocess.run(run_as_user + command, check=True)
