"""Read a whitelisted configuration snapshot through the installed Hermes runtime."""
import json
import pwd
import subprocess
from pathlib import Path

try:
    account = pwd.getpwnam('hermes')
    checkout = Path('/home/hermes/.hermes/hermes-agent')
    run_as_user = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes',
                   'PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin',
                   'HERMES_HOME=/home/hermes/.hermes',
                   'XDG_RUNTIME_DIR=/run/user/' + str(account.pw_uid)]
    resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
    command = json.loads(subprocess.check_output(
        run_as_user + ['env', 'PYTHONPATH=' + str(checkout), 'python3', '-c', resolver,
                       str(checkout), data.pop('helper')], text=True, stderr=subprocess.DEVNULL))
    result = subprocess.run(run_as_user + command, input=json.dumps(data), text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=45)
    response = json.loads(result.stdout.strip().splitlines()[-1])
    if result.returncode or response.get('error'):
        raise ValueError()
    print(json.dumps(response))
except Exception:
    print('Could not read the installed Hermes settings. Check the server connection and Hermes runtime.')
    raise SystemExit(1)
