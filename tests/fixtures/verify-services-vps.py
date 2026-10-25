"""Verify plugin registration and free page extraction without calling paid services."""
import json
import pwd
import subprocess

checkout = '/home/hermes/.hermes/hermes-agent'
uid = str(pwd.getpwnam('hermes').pw_uid)
prefix = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes', 'HERMES_HOME=/home/hermes/.hermes', 'XDG_RUNTIME_DIR=/run/user/' + uid, 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + uid + '/bus']
code = '''import json
from hermes_cli.plugins import get_plugin_manager
from hermes_cli.config import load_config
from agent.web_search_registry import get_provider
from agent.image_gen_registry import get_provider as image_provider
get_plugin_manager().discover_and_load()
config=load_config()
assert config['web']['search_backend']=='ddgs'
assert config['web']['extract_backend']=='companion-parser'
parser=get_provider('companion-parser')
assert parser is not None and parser.is_available() and parser.supports_extract() and not parser.supports_search()
assert get_provider('ddgs') is not None and get_provider('ddgs').is_available()
result=parser.extract(['https://example.com'],max_chars=10000)
if not result or result[0].get('error'):
    from tools.url_safety import is_safe_url, create_ssrf_safe_client
    print('Diagnostic: URL allowed='+str(is_safe_url('https://example.com')))
    try:
        with create_ssrf_safe_client(timeout=10,follow_redirects=True) as client:
            response=client.get('https://example.com')
            print('Diagnostic: HTTP status='+str(response.status_code)+' content-type='+response.headers.get('content-type',''))
    except Exception as error:
        print('Diagnostic: '+type(error).__name__)
assert result and not result[0].get('error') and 'example' in result[0]['content'].lower() and result[0]['title']=='Example Domain'
replicate=image_provider('replicate')
assert replicate is not None and replicate.is_available()
assert replicate.capabilities()['modalities']==['text']
print('PASS: Native Hermes loaded the built-in parser and Replicate backend; DuckDuckGo is ready and public-page extraction returned content. No paid API was called.')
'''
resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
command = json.loads(subprocess.check_output(prefix + ['env', 'PYTHONPATH=' + checkout, 'python3', '-c', resolver, checkout, code], text=True))
result = subprocess.run(prefix + command, text=True, capture_output=True)
if result.returncode:
    print(result.stdout[-1200:])
    print('FAIL: Service verification did not pass. ' + result.stderr[-1500:])
else:
    print(result.stdout.strip())
