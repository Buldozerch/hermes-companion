"""Run a model probe in the installed runtime, or use standard HTTP before installation."""
import os
import pwd
import subprocess
from pathlib import Path

payload = {'request': request, 'catalog': catalog}
checkout = Path('/home/hermes/.hermes/hermes-agent')
try:
    if (Path('/var/lib/hermes-companion/managed').exists() and checkout.is_dir()
            and Path('/home/hermes/.local/bin/hermes').is_file()):
        account = pwd.getpwnam('hermes')
        run_as_user = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes',
                       'HERMES_HOME=/home/hermes/.hermes', 'PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin',
                       'XDG_RUNTIME_DIR=/run/user/' + str(account.pw_uid)]
        resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
        command = json.loads(subprocess.check_output(run_as_user + ['env', 'PYTHONPATH=' + str(checkout), 'python3', '-c', resolver, str(checkout), helper], text=True, stderr=subprocess.DEVNULL))
        result = subprocess.run(run_as_user + command, input=json.dumps(payload), text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=25)
        response = json.loads(result.stdout.strip().splitlines()[-1])
    else:
        module = {'__name__': 'companion_model_probe'}
        exec(compile(helper, 'provider-models', 'exec'), module)
        response = module['discover'](request, catalog)
    print(json.dumps(response))
except Exception:
    print(json.dumps({'models': [], 'source': 'provider', 'status': 'unavailable', 'truncated': False,
                      'message': 'Could not load models. Check the server connection and provider configuration.'}))
