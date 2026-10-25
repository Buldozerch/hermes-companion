"""Return bounded diagnostic output with configured credentials removed."""

import re
import json
import os
import subprocess
from pathlib import Path

root = Path('/var/lib/hermes-companion')
job_id = (root / 'latest-job').read_text().strip() if (root / 'latest-job').exists() else ''
output = ''
if re.fullmatch(r'[0-9a-f-]{36}', job_id):
    path = root / 'jobs' / job_id / 'installer.log'
    if path.exists():
        with path.open('rb') as stream:
            stream.seek(max(0, path.stat().st_size - 24000))
            output = stream.read(24000).decode('utf-8', errors='replace')
output += '\n--- Hermes service journal ---\n'
result = subprocess.run(['journalctl', '-u', 'hermes-companion-agent.service', '-n', '60', '--no-pager', '-o', 'cat'],
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
output += result.stdout[-24000:].decode('utf-8', errors='replace')
env_path = Path('/home/hermes/.hermes/.env')
try:
    directory = os.open(env_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        descriptor = os.open(env_path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    finally:
        os.close(directory)
    with os.fdopen(descriptor, 'r') as source:
        env_content = source.read()
except FileNotFoundError:
    env_content = ''
if env_content:
    for line in env_content.splitlines():
        key, separator, value = line.partition('=')
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            # Hermes escapes backslashes and double quotes when serializing dotenv values.
            value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        if separator and re.search(r'(KEY|TOKEN|PASSWORD|SECRET)$', key.strip()) and value:
            output = output.replace(value, '[REDACTED]')
            output = output.replace(json.dumps(value)[1:-1], '[REDACTED]')
output = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output)
print(output[-48000:])
