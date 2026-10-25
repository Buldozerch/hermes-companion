"""Proxy a fixed subset of the native Hermes account API through verified SSH."""

import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def cli_sign_in(request):
    import pwd
    account = pwd.getpwnam('hermes')
    checkout = Path('/home/hermes/.hermes/hermes-agent')
    run_as_user = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes',
                   'PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin',
                   'HERMES_HOME=/home/hermes/.hermes', 'XDG_RUNTIME_DIR=/run/user/' + str(account.pw_uid)]
    resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
    command = json.loads(subprocess.check_output(
        run_as_user + ['env', 'PYTHONPATH=' + str(checkout), 'python3', '-c', resolver, str(checkout), CLI_SOURCE],
        text=True, stderr=subprocess.DEVNULL))
    response = subprocess.run(run_as_user + command, input=json.dumps({**request, 'workerSource': CLI_SOURCE}),
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    return json.loads(response.stdout.strip().splitlines()[-1])


def main(request):
    root = Path('/var/lib/hermes-companion')
    if not (root / 'managed').is_file():
        raise ValueError('Install Hermes before signing in to a provider.')
    provider = request['provider']
    action = request['action']
    session = request.get('session', '')
    if provider not in {'nous', 'openai-codex', 'minimax-oauth', 'xai-oauth', 'anthropic', 'openrouter', 'antigravity-oauth'}:
        raise ValueError('This provider does not support native browser sign-in.')
    if action not in {'start', 'poll', 'cancel', 'submit'} or (action != 'start' and not re.fullmatch(r'[A-Za-z0-9_-]{10,128}', session)):
        raise ValueError('Invalid provider sign-in request.')
    if action == 'start' and subprocess.run(['systemctl', 'is-active', '--quiet', 'hermes-companion-install.service']).returncode == 0:
        raise ValueError('Wait for the current server operation to finish before signing in.')
    if provider in {'anthropic', 'openrouter', 'antigravity-oauth'}:
        return cli_sign_in(request)
    if action == 'submit':
        raise ValueError('This provider completes sign-in automatically after browser approval.')
    token_path = root / 'auth-token'
    try:
        descriptor = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, 'w') as output:
            output.write(secrets.token_urlsafe(32))
    descriptor = os.open(token_path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as source:
        token = source.read().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', token):
        raise ValueError('The private account service token is invalid.')
    environment = root / 'auth.env'
    descriptor = os.open(environment, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write('HERMES_DASHBOARD_SESSION_TOKEN=' + token + '\n')
    unit = '''[Unit]
Description=Hermes Companion temporary account sign-in
After=network-online.target
[Service]
Type=exec
User=hermes
Group=hermes
WorkingDirectory=/home/hermes/.hermes
Environment=HOME=/home/hermes
Environment=HERMES_HOME=/home/hermes/.hermes
Environment=PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/var/lib/hermes-companion/auth.env
ExecStart=/home/hermes/.local/bin/hermes serve --host 127.0.0.1 --port 8643 --isolated
RuntimeMaxSec=1800
UMask=0077
'''
    unit_path = Path('/etc/systemd/system/hermes-companion-auth.service')
    if not unit_path.exists() or unit_path.read_text() != unit:
        unit_path.write_text(unit)
        subprocess.run(['systemctl', 'daemon-reload'], check=True, capture_output=True)
    subprocess.run(['systemctl', 'start', '--no-block', 'hermes-companion-auth.service'], check=True, capture_output=True)

    def call(path, method='GET'):
        query = urllib.request.Request('http://127.0.0.1:8643' + path, method=method,
                                       headers={'X-Hermes-Session-Token': token, 'Content-Type': 'application/json'},
                                       data=b'{}' if method == 'POST' else None)
        with urllib.request.urlopen(query, timeout=20) as response:
            return json.load(response)

    if action == 'start':
        for attempt in range(10):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8643/health', timeout=1):
                    pass
                break
            except urllib.error.HTTPError:
                break  # An authenticated 401 or an unknown health route still means the listener is ready.
            except OSError:
                time.sleep(1)
    if action == 'start':
        response = call('/api/providers/oauth/' + provider + '/start', 'POST')
    elif action == 'poll':
        response = call('/api/providers/oauth/' + provider + '/poll/' + session)
    else:
        response = call('/api/providers/oauth/sessions/' + session, 'DELETE')
    # Never return access tokens, refresh tokens, account identifiers or provider error bodies.
    allowed = {'session_id', 'flow', 'user_code', 'verification_url', 'expires_in', 'poll_interval', 'status'}
    result = {key: value for key, value in response.items() if key in allowed}
    if response.get('error_message'):
        result['error'] = 'The provider did not complete sign-in. Retry or check your account settings.'
    if result.get('verification_url') and not result['verification_url'].startswith('https://'):
        raise ValueError('The provider returned an unsupported sign-in URL.')
    if action == 'cancel' or result.get('status') in {'approved', 'denied', 'expired', 'error'}:
        subprocess.run(['systemctl', 'stop', '--no-block', 'hermes-companion-auth.service'], check=True, capture_output=True)
    return result


if __name__ == '__main__':
    try:
        import sys
        payload = json.loads(sys.argv[1])
        print(json.dumps(main(payload)))
    except Exception:
        print(json.dumps({'error': 'Provider sign-in failed. Check the SSH connection and availability of the installed Hermes account service.'}))
