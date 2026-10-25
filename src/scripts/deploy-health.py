"""Probe the private loopback API without exposing the gateway key."""

import json
import os
import urllib.request
from pathlib import Path

directory = os.open('/home/hermes/.hermes', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    descriptor = os.open('.env', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
finally:
    os.close(directory)
with os.fdopen(descriptor, 'r') as source:
    content = source.read()
values = {}
for line in content.splitlines():
    key, separator, value = line.partition('=')
    if separator:
        values[key.strip()] = value.strip().strip("'\"")
request = urllib.request.Request('http://127.0.0.1:8642/health', headers={'Authorization': 'Bearer ' + values['API_SERVER_KEY']})
with urllib.request.urlopen(request, timeout=5) as response:
    if response.status != 200:
        raise RuntimeError('Hermes API health check failed.')
    result = json.load(response)
print('Hermes loopback API is healthy.')
