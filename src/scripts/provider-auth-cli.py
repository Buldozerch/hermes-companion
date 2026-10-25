"""Relay interactive native Hermes CLI OAuth prompts without exposing account credentials."""

import contextlib
import fcntl
import hmac
import io
import json
import logging
import os
import pty
import re
import secrets
import shutil
import signal
import select
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TTL = 900
PROVIDERS = {'anthropic', 'openrouter', 'antigravity-oauth'}


def write_json(path, value):
    temporary = path.with_name('.pending-' + secrets.token_hex(12))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as source:
        return json.load(source)


@contextlib.contextmanager
def locked(directory):
    descriptor = os.open(directory / 'lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def normalized_code(provider, value, verification_url):
    value = value.strip()
    if not value or len(value) > 4096 or any(ord(char) < 32 for char in value):
        raise ValueError('Paste the complete callback URL or authorization code.')
    if '://' in value:
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError:
            raise ValueError('Paste the callback URL from the selected provider.') from None
        expected_redirect = parse_qs(urlsplit(verification_url).query).get('redirect_uri', [''])[0]
        expected = urlsplit(expected_redirect)
        allowed_hosts = {'console.anthropic.com', 'platform.claude.com'} if provider == 'anthropic' else ({expected.hostname} if provider == 'antigravity-oauth' else {'openrouter.ai'})
        google_loopback = provider == 'antigravity-oauth' and expected.scheme == 'http' and expected.hostname in {'localhost', '127.0.0.1', '::1'} and parsed.scheme == expected.scheme and port == expected.port
        if (not google_loopback and (parsed.scheme != 'https' or port not in {None, 443})) or parsed.hostname not in allowed_hosts or parsed.username or parsed.password:
            raise ValueError('Paste the callback URL from the selected provider.')
        if provider == 'anthropic' and parsed.path.rstrip('/') != '/oauth/code/callback':
            raise ValueError('Paste the callback URL from the selected provider.')
        if provider == 'antigravity-oauth' and (not expected.hostname or parsed.path != expected.path or parsed.port != expected.port):
            raise ValueError('Paste the Google authorization code, or its complete callback URL.')
        fields = parse_qs(parsed.query, keep_blank_values=True)
        if any(len(items) != 1 for items in fields.values()) or fields.get('error'):
            raise ValueError('The provider did not return a valid authorization code.')
        code = fields.get('code', [''])[0]
        state = fields.get('state', [''])[0]
        if provider == 'antigravity-oauth':
            expected_state = parse_qs(urlsplit(verification_url).query).get('state', [''])[0]
            if expected_state and not hmac.compare_digest(state.encode(), expected_state.encode()):
                raise ValueError('The callback does not match this Google sign-in session.')
        value = code + '#' + state if provider == 'anthropic' else code
    if provider == 'anthropic':
        parts = value.split('#')
        expected = parse_qs(urlsplit(verification_url).query).get('state', [''])[0]
        if len(parts) != 2 or not parts[0] or not expected or not hmac.compare_digest(parts[1].encode(), expected.encode()):
            raise ValueError('The code does not match this sign-in session. Paste the full code including #state, or restart sign-in.')
    elif not re.fullmatch(r'[A-Za-z0-9._~+/=-]{8,2048}', value):
        raise ValueError('Paste the authorization code shown by the selected provider.')
    return value


def public_state(state):
    allowed = {'session_id', 'flow', 'verification_url', 'expires_in', 'poll_interval', 'status', 'error'}
    return {key: value for key, value in state.items() if key in allowed}


def control(request):
    provider = request['provider']
    action = request['action']
    if provider not in PROVIDERS or action not in {'start', 'poll', 'submit', 'cancel'}:
        raise ValueError('Invalid provider sign-in request.')
    root = Path.home() / '.hermes/companion-oauth'
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError('The private sign-in directory is invalid.')
    if action == 'start':
        # Import before spawning so incompatible native releases fail without a dangling session.
        from hermes_cli.auth_commands import _OAUTH_ADD_SPECS
        from hermes_cli._launchers import runtime_command
        if provider == 'antigravity-oauth':
            from providers import get_provider_profile
            profile = get_provider_profile(provider)
            if not profile or not os.access(Path.home() / '.local/bin/agy', os.X_OK):
                raise ValueError('Prepare Antigravity support before starting Google sign-in.')
            if profile.fetch_models(timeout=6) is not None:
                return {'status': 'approved', 'flow': 'paste_code'}
        elif provider not in _OAUTH_ADD_SPECS:
            raise ValueError('Update Hermes to use browser sign-in for this provider.')
        for candidate in root.iterdir():
            if re.fullmatch(r'[a-f0-9]{32}', candidate.name) and candidate.is_dir() and not candidate.is_symlink() and candidate.stat().st_mtime < time.time() - TTL * 2:
                shutil.rmtree(candidate)
        session = uuid.uuid4().hex
        directory = root / session
        directory.mkdir(mode=0o700)
        state = {'provider': provider, 'session_id': session, 'flow': 'paste_code', 'status': 'starting',
                 'expires_at': time.time() + TTL, 'expires_in': TTL, 'poll_interval': 2}
        write_json(directory / 'state.json', state)
        command = runtime_command(Path('/home/hermes/.hermes/hermes-agent'), code=request['workerSource'], home=Path.home() / '.hermes')
        environment = {**os.environ, 'HERMES_COMPANION_AUTH_WORKER': str(directory)}
        subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
        for _ in range(200 if provider == 'antigravity-oauth' else 80):
            state = read_json(directory / 'state.json')
            if state['status'] != 'starting':
                return public_state(state)
            time.sleep(0.1)
        with locked(directory):
            state = read_json(directory / 'state.json')
            state.update(status='cancelled')
            write_json(directory / 'state.json', state)
        raise ValueError('The native Hermes sign-in prompt did not become ready. Update Hermes and retry.')
    session = request.get('session', '')
    if not re.fullmatch(r'[a-f0-9]{32}', session):
        raise ValueError('Invalid provider sign-in session.')
    directory = root / session
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError('Sign-in expired. Start a new sign-in session.')
    with locked(directory):
        state = read_json(directory / 'state.json')
        if state['provider'] != provider or state['session_id'] != session:
            raise ValueError('This sign-in session belongs to another provider.')
        if state['expires_at'] <= time.time() and state['status'] not in {'approved', 'cancelled', 'error'}:
            state['status'] = 'expired'
            (directory / 'input.json').unlink(missing_ok=True)
        if action == 'cancel' and state['status'] != 'approved':
            state['status'] = 'cancelled'
            (directory / 'input.json').unlink(missing_ok=True)
        elif action == 'submit':
            if state['status'] != 'pending':
                raise ValueError('This session is not waiting for a code. Check its status or start again.')
            code = normalized_code(provider, request.get('code', ''), state.get('verification_url', ''))
            write_json(directory / 'input.json', {'code': code})
            state['status'] = 'exchanging'
        write_json(directory / 'state.json', state)
        return public_state(state)


class PromptCapture(io.StringIO):
    def __init__(self, directory, provider):
        super().__init__()
        self.directory = directory
        self.provider = provider

    def write(self, value):
        result = super().write(value)
        host = 'claude.ai' if self.provider == 'anthropic' else 'openrouter.ai'
        match = re.search(r'https://' + re.escape(host) + r'/[^\s\x1b]+', self.getvalue())
        if match:
            with locked(self.directory):
                state = read_json(self.directory / 'state.json')
                if state['status'] == 'starting':
                    state.update(status='pending', verification_url=match.group())
                    write_json(self.directory / 'state.json', state)
        return result


def wait_for_code(directory):
    while True:
        with locked(directory):
            state = read_json(directory / 'state.json')
            if state['status'] in {'cancelled', 'expired'} or state['expires_at'] <= time.time():
                raise EOFError()
            path = directory / 'input.json'
            if path.exists():
                response = read_json(path)
                path.unlink()
                return response['code']
        time.sleep(0.2)


def persist_native_credential(provider, credentials):
    # Match `hermes auth add --type oauth`: use the installed pool, source and refresh metadata.
    from hermes_cli.auth_commands import _OAUTH_ADD_SPECS
    from agent.credential_pool import PooledCredential, load_pool
    spec = _OAUTH_ADD_SPECS[provider]
    source = spec.source(credentials) if callable(spec.source) else spec.source
    entry = PooledCredential(provider=provider, id=uuid.uuid4().hex[:6], label='Hermes Companion',
                             auth_type=spec.auth_type, priority=0, source=source,
                             access_token=spec.token(credentials), **spec.fields(credentials, provider))
    load_pool(provider).add_entry(entry)


def run_antigravity_login(directory):
    """Relay only Google's public prompt; the official CLI owns credential storage."""
    pid, descriptor = pty.fork()
    if pid == 0:
        try:
            os.chdir(directory)
            launcher = str(Path.home() / '.local/bin/hermes')
            os.execv(launcher, [launcher, 'auth', 'add', 'antigravity-oauth'])
        except BaseException:
            os._exit(127)
    buffer = b''
    reaped = False
    try:
        while True:
            with locked(directory):
                state = read_json(directory / 'state.json')
                if state['status'] in {'cancelled', 'expired'} or state['expires_at'] <= time.time():
                    raise EOFError()
                path = directory / 'input.json'
                if path.exists():
                    code = read_json(path)['code']
                    path.unlink()
                    os.write(descriptor, (code + '\n').encode())
            ready, _, _ = select.select([descriptor], [], [], 0.2)
            if ready:
                try:
                    chunk = os.read(descriptor, 16384)
                except OSError:
                    chunk = b''
                buffer = (buffer + chunk)[-32768:]
                clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', buffer)
                match = re.search(rb'https://accounts\.google\.com/[^\s\x1b<>"\']+', clean)
                if match:
                    with locked(directory):
                        state = read_json(directory / 'state.json')
                        if state['status'] == 'starting':
                            state.update(status='pending', verification_url=match.group().decode('ascii'), expires_in=60)
                            write_json(directory / 'state.json', state)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                reaped = True
                if os.waitstatus_to_exitcode(status) != 0:
                    raise ValueError('Google sign-in did not complete.')
                return
    finally:
        os.close(descriptor)
        # The PTY child owns its process group, including the agy process.
        if not reaped:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for _ in range(20):
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done:
                    reaped = True
                    break
                time.sleep(0.05)
            if not reaped:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)


def worker(directory):
    import builtins
    import webbrowser
    state = read_json(directory / 'state.json')
    provider = state['provider']
    def timed_out(*_args):
        raise TimeoutError()
    main_thread = threading.current_thread() is threading.main_thread()
    if main_thread:
        signal.signal(signal.SIGALRM, timed_out)
        signal.alarm(max(1, int(state['expires_at'] - time.time())))
    logging.disable(logging.CRITICAL)
    builtins.input = lambda *_args: wait_for_code(directory)
    webbrowser.open = lambda *_args, **_kwargs: False
    try:
        with contextlib.redirect_stdout(PromptCapture(directory, provider)), contextlib.redirect_stderr(io.StringIO()):
            if provider == 'antigravity-oauth':
                run_antigravity_login(directory)
                credentials = True
            elif provider == 'anthropic':
                from agent.anthropic_credentials import run_hermes_oauth_login_pure
                credentials = run_hermes_oauth_login_pure()
            else:
                import hermes_cli.auth_openrouter as native
                import hermes_cli.secret_prompt as prompt
                prompt.masked_secret_prompt = lambda *_args, **_kwargs: wait_for_code(directory)
                # This UI controls a remote CLI prompt, so use Hermes' documented headless branch.
                native._is_remote_session = lambda: True
                credentials = native._openrouter_pkce_login(open_browser=False, timeout_seconds=TTL)
        with locked(directory):
            state = read_json(directory / 'state.json')
            if state['status'] in {'cancelled', 'expired'} or state['expires_at'] <= time.time():
                return
            if not credentials:
                raise ValueError()
            if main_thread:
                signal.alarm(0)
            if provider != 'antigravity-oauth':
                persist_native_credential(provider, credentials)
            state.update(status='approved')
            state.pop('verification_url', None)
            write_json(directory / 'state.json', state)
    except BaseException:
        with locked(directory):
            state = read_json(directory / 'state.json')
            if state['status'] not in {'cancelled', 'expired', 'approved'}:
                state.update(status='expired' if state['expires_at'] <= time.time() else 'error',
                             error='The provider did not complete sign-in. Start again or check your account access.')
                state.pop('verification_url', None)
                write_json(directory / 'state.json', state)
    finally:
        if main_thread:
            signal.alarm(0)
        (directory / 'input.json').unlink(missing_ok=True)


if __name__ == '__main__':
    if os.environ.get('HERMES_COMPANION_AUTH_WORKER'):
        worker(Path(os.environ['HERMES_COMPANION_AUTH_WORKER']))
    else:
        try:
            print(json.dumps(control(json.load(sys.stdin))))
        except ValueError as error:
            print(json.dumps({'error': str(error)}))
        except Exception:
            print(json.dumps({'error': 'Provider sign-in failed. Check the installed Hermes version and server connection.'}))
