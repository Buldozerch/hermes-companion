"""Validate the installed service without printing credentials or server addresses."""

import json
import os
import pwd
import stat
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

root = Path('/var/lib/hermes-companion')
home = Path('/home/hermes/.hermes')
account = pwd.getpwnam('hermes')
mode = (home / '.env').stat()
assert stat.S_IMODE(mode.st_mode) == 0o600, 'The provider environment file must have mode 0600.'
assert mode.st_uid == account.pw_uid, 'The provider environment file must belong to hermes.'
assert account.pw_uid != 0, 'Hermes must run without root privileges.'
groups = subprocess.check_output(['id', '-nG', 'hermes'], text=True).split()
assert not {'sudo', 'admin', 'wheel'}.intersection(groups), 'The Hermes account must not be an administrator.'
for verb in ['is-active', 'is-enabled']:
    subprocess.run(['systemctl', verb, '--quiet', 'hermes-companion-agent.service'], check=True)
pid = subprocess.check_output(['systemctl', 'show', 'hermes-companion-agent.service', '-p', 'MainPID', '--value'], text=True).strip()
assert Path('/proc/' + pid).stat().st_uid == account.pw_uid, 'The gateway process must run as hermes.'
assert not list((root / 'jobs').glob('*/input.json')), 'Temporary installation secrets were not removed.'
assert not (root / 'install.swap').exists(), 'Temporary swap was not removed.'

values = {}
for line in (home / '.env').read_text().splitlines():
    key, separator, value = line.partition('=')
    if separator:
        values[key.strip()] = value.strip().strip("'\"")
assert values['API_SERVER_HOST'] == '127.0.0.1', 'The gateway must bind only to loopback.'
listeners = []
for name in ['/proc/net/tcp', '/proc/net/tcp6']:
    for row in Path(name).read_text().splitlines()[1:]:
        fields = row.split()
        address, port = fields[1].split(':')
        if int(port, 16) == 8642 and fields[3] == '0A':
            listeners.append(address)
assert listeners and all(address == '0100007F' for address in listeners), 'The live API socket must listen only on IPv4 loopback.'
request = urllib.request.Request('http://127.0.0.1:8642/health', headers={'Authorization': 'Bearer ' + values['API_SERVER_KEY']})
with urllib.request.urlopen(request, timeout=10) as response:
    assert response.status == 200, 'The authenticated API health check must pass.'
try:
    urllib.request.urlopen('http://127.0.0.1:8642/v1/models', timeout=10)
    raise AssertionError('The model API must reject unauthenticated requests.')
except urllib.error.HTTPError as error:
    assert error.code == 401, 'Unauthenticated API requests must return HTTP 401.'

result = {
    'serviceActive': True, 'autoStartEnabled': True, 'unprivilegedAccount': True,
    'privateEnvPermissions': True, 'temporarySecretsRemoved': True,
    'temporarySwapRemoved': True, 'apiHealthy': True, 'apiAuthenticationRequired': True,
    'version': (root / 'version').read_text().strip(),
    'modelResponseTested': False,
}
print(json.dumps(result))
