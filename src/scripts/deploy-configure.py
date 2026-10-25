"""Write only the supported settings; never print secret values."""

import json
import pwd
import subprocess
from pathlib import Path

root = Path('/var/lib/hermes-companion')
home = Path('/home/hermes/.hermes')
account = pwd.getpwnam('hermes')
payload = json.loads(Path('input.json').read_text())
setup = payload['setup']
if setup['provider'] == 'antigravity-oauth':
    subprocess.run(['python3', 'prepare-provider.py'], check=True)
credentials = payload['secrets']
sections = set(payload.get('sections', ['model', 'channels', 'services', 'tools']))
service_dependencies = bool(sections & {'services', 'tools'})


# Resolve and bootstrap the Python owned by this Hermes installation. No secrets enter argv.
checkout = Path('/home/hermes/.hermes/hermes-agent')
run_as_user = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes',
               'HERMES_HOME=' + str(home), 'XDG_RUNTIME_DIR=/run/user/' + str(account.pw_uid),
               'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(account.pw_uid) + '/bus']
resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
command = json.loads(subprocess.check_output(
    run_as_user + ['env', 'PYTHONPATH=' + str(checkout), 'python3', '-c', resolver,
                   str(checkout), Path('configure-user.py').read_text()], text=True))
catalog = json.loads(Path('catalog.json').read_text())
extras = set()
if service_dependencies and setup.get('searchBackend') == 'ddgs':
    extras.add('ddgs')
channel_extras = {'telegram': 'telegram', 'discord': 'discord', 'slack': 'slack',
                  'matrix': 'matrix', 'google_chat': 'google-chat', 'teams': 'teams'}
for channel in setup['channels']:
    if 'channels' in sections and channel in channel_extras:
        extras.add(channel_extras[channel])
if 'model' in sections and setup['provider'] in {'bedrock', 'vertex'}:
    extras.add(setup['provider'])
for tool, collection, selected in [('tts', 'ttsProviders', 'ttsProvider'), ('stt', 'sttProviders', 'sttProvider')]:
    if service_dependencies and tool in setup['tools']:
        option = next(item for item in catalog[collection] if item['id'] == setup[selected])
        if option.get('extra'):
            extras.add(option['extra'])
launcher = '/home/hermes/.local/bin/hermes'
if service_dependencies and ('tts' in setup['tools'] or ('stt' in setup['tools'] and setup['sttProvider'] == 'local')):
    subprocess.run(['apt-get', '-o', 'DPkg::Lock::Timeout=180', 'update'], check=True)
    subprocess.run(['apt-get', '-o', 'DPkg::Lock::Timeout=180', 'install', '-y', '--no-install-recommends', 'ffmpeg'], check=True)
    subprocess.run(['apt-get', 'clean'], check=True)
if 'tools' in sections and 'browser' in setup['tools']:
    # Ubuntu 24.04 Chromium dependencies from Playwright's nativeDeps.ts.
    libraries = ['libasound2t64', 'libatk-bridge2.0-0t64', 'libatk1.0-0t64', 'libatspi2.0-0t64',
                 'libcairo2', 'libcups2t64', 'libdbus-1-3', 'libdrm2', 'libgbm1', 'libglib2.0-0t64',
                 'libnspr4', 'libnss3', 'libpango-1.0-0', 'libx11-6', 'libxcb1', 'libxcomposite1',
                 'libxdamage1', 'libxext6', 'libxfixes3', 'libxkbcommon0', 'libxrandr2',
                 'libfontconfig1', 'libfreetype6', 'fonts-liberation', 'fonts-noto-color-emoji']
    subprocess.run(['apt-get', '-o', 'DPkg::Lock::Timeout=180', 'update'], check=True)
    subprocess.run(['apt-get', '-o', 'DPkg::Lock::Timeout=180', 'install', '-y', '--no-install-recommends', *libraries], check=True)
    subprocess.run(['apt-get', 'clean'], check=True)
if extras:
    arguments = [launcher, 'pm', 'install']
    for extra in sorted(extras):
        arguments.extend(['--extra', extra])
    subprocess.run(run_as_user + arguments, check=True)
for tool, packages in [('browser', ['agent-browser', 'chromium']), ('computer_use', ['cua-driver'])]:
    if service_dependencies and tool in setup['tools']:
        subprocess.run(run_as_user + [launcher, 'pm', 'install', *packages], check=True)
if 'model' in sections and setup['provider'] == 'copilot-acp':
    subprocess.run(run_as_user + [launcher, 'pm', 'install', 'node'], check=True)
    node_env = json.loads(subprocess.check_output(run_as_user + [launcher, 'pm', 'env', 'node'], text=True))
    # Install the provider's official ACP CLI into the service user's PATH.
    subprocess.run(run_as_user + ['env', 'PATH=/home/hermes/.local/bin:' + node_env.get('PATH', '') + ':/usr/bin:/bin',
                                  'sh', '-c', 'npm install --global --prefix /home/hermes/.local @github/copilot'], check=True)
result = subprocess.run(run_as_user + command,
                        input=json.dumps({'payload': payload, 'catalog': catalog, 'pluginSources': {'parser': Path('parser-plugin.py').read_text(), 'replicate': Path('replicate-plugin.py').read_text()}}),
                        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    response = json.loads(result.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    response = {'error': 'The installed Hermes configuration helper returned no valid result.'}
if result.returncode or response.get('error'):
    print(response.get('error', 'The installed Hermes configuration helper failed.'))
    raise SystemExit(1)
marker = root / 'model-configured'
if response['modelConfigured']:
    marker.touch(mode=0o600)
else:
    marker.unlink(missing_ok=True)
(root / 'applied-setup.json').write_text(json.dumps(setup))
print('Private configuration written successfully. Selected channels and tools were applied.')
