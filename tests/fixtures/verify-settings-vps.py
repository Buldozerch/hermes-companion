"""Inspect the disposable VPS without returning configuration or credential values."""
import json
import stat
import subprocess
from pathlib import Path

home = Path('/home/hermes/.hermes')
config = (home / 'config.yaml').read_text()
applied = json.loads(Path('/var/lib/hermes-companion/applied-setup.json').read_text())
assert applied['provider'] == 'custom'
assert applied['tools'] == ['file', 'memory', 'tts']
assert 'companion-configuration-test' in config
assert '127.0.0.1:11434' in config
assert 'HERMES_CUSTOM_' in config
assert "companion-test-'quoted-key-123" not in config
assert 'disabled_toolsets:' in config
assert 'voice: en-US-AriaNeural' in config
assert stat.S_IMODE((home / '.env').stat().st_mode) == 0o600
assert (home / '.env').stat().st_uid != 0
assert subprocess.check_output(['systemctl', 'is-active', 'hermes-companion-agent.service'], text=True).strip() == 'active'
print('PASS: Custom endpoint, private credential reference, selected tools, voice and service health.')
