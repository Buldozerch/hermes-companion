"""Run a real headless browser process as the unprivileged service account."""
import json
import subprocess
import pwd

checkout = '/home/hermes/.hermes/hermes-agent'
uid = str(pwd.getpwnam('hermes').pw_uid)
prefix = ['runuser', '-u', 'hermes', '--', 'env', 'HOME=/home/hermes', 'HERMES_HOME=/home/hermes/.hermes', 'XDG_RUNTIME_DIR=/run/user/' + uid, 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + uid + '/bus']
code = '''import pm,subprocess,tempfile,os,signal,time,json,urllib.request
from pathlib import Path
from websockets.sync.client import connect
browser=pm.installed_package('chromium')
assert browser and browser.binary, 'The managed Chromium package is unavailable.'
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
    arguments=[str(browser.binary),'--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--disable-extensions','--disable-component-update','--no-first-run','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'data:text/html,<title>Companion test</title><h1>Companion browser test</h1>']
    process=subprocess.Popen(arguments,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        port_file=Path(profile)/'DevToolsActivePort'
        for attempt in range(60):
            if port_file.exists(): break
            if process.poll() is not None: raise RuntimeError('Chromium exited before startup.')
            time.sleep(0.2)
        port=int(port_file.read_text().splitlines()[0])
        with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/json',timeout=4) as response:
            pages=json.load(response)
        page=next(page for page in pages if page['type']=='page')
        with connect(page['webSocketDebuggerUrl'],open_timeout=4) as socket:
            socket.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':'document.body.innerText','returnByValue':True}}))
            for message in range(20):
                result=json.loads(socket.recv(timeout=5))
                if result.get('id')==1: break
            assert 'Companion browser test' in result['result']['result']['value'], 'The test DOM was not rendered.'
    finally:
        try: os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait(timeout=3)
        time.sleep(0.2)
print('PASS: Headless Chromium rendered a page and returned its DOM over CDP as the Hermes user.')
'''
resolver = "import json,sys; from pathlib import Path; from hermes_cli._launchers import runtime_command; print(json.dumps(runtime_command(Path(sys.argv[1]),code=sys.argv[2],home=Path('/home/hermes/.hermes'))))"
command = json.loads(subprocess.check_output(prefix + ['env', 'PYTHONPATH=' + checkout, 'python3', '-c', resolver, checkout, code], text=True))
result = subprocess.run(prefix + command, text=True, capture_output=True)
if result.returncode:
    print('FAIL: Headless browser verification failed.')
    print(result.stdout[-2000:])
    print(result.stderr[-1600:])
    raise SystemExit(0)
print(result.stdout.strip())
