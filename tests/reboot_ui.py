"""Exercise reboot controls and expected SSH disconnection with mocked IPC."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:1420')
parser.add_argument('--chromium',default=None)
args=parser.parse_args()
ru=json.loads(Path('frontend/locales/ru.json').read_text())
fixture=Path('tests/fixtures/desktop-mock.js').read_text()+'''
window.__QA__.connected=true;
Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:true,rebootRequired:true});
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=args.chromium)
    page=browser.new_page(viewport={'width':1440,'height':1050});page.add_init_script(fixture)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(args.url);page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='Manage Hermes',exact=True).click()
    page.get_by_role('button',name='Service status and logs',exact=True).click()
    reboot=page.get_by_role('button',name='Reboot server',exact=True)
    expect(reboot).to_be_enabled()
    page.locator('#model-name').fill('unsaved-model');expect(reboot).to_be_disabled()
    expect(page.get_by_text('Save or discard your settings before rebooting.',exact=True)).to_be_visible()
    page.get_by_role('button',name='Discard changes',exact=True).click();expect(reboot).to_be_enabled()
    page.evaluate("Object.assign(window.__QA__.job,{state:'running',operation:'update',step:'install'})")
    expect(reboot).to_be_disabled(timeout=10000)
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',operation:'update',step:'complete'})")
    expect(reboot).to_be_enabled(timeout=15000)
    page.evaluate('window.__QA__.rebootError=true');reboot.click()
    expect(page.get_by_text('Could not schedule the server reboot. Check root or passwordless sudo access and systemd.',exact=True)).to_be_visible()
    assert page.evaluate('window.__QA__.connected')
    page.get_by_role('radio',name=ru['Russian'],exact=True).click()
    page.evaluate('window.__QA__.rebootError=false')
    page.get_by_role('button',name=ru['Reboot server'],exact=True).click()
    expect(page.get_by_text(ru['Server reboot requested'],exact=True)).to_be_visible()
    assert page.evaluate('window.__QA__.rebootCalls')==1
    assert not page.evaluate('window.__QA__.connected')
    expect(page.get_by_text(ru['Operation failed'],exact=True)).to_have_count(0)
    page.get_by_role('button',name=ru['Reconnect to server'],exact=True).click()
    page.get_by_label(ru['Server password']).fill('qa-reconnect-password')
    page.get_by_role('button',name=ru['Check connection'],exact=True).click()
    expect(page.get_by_text('The server reboot is scheduled. Wait for the server to restart before reconnecting.',exact=True)).to_be_visible()
    expect(page.get_by_text(ru['Server reboot requested'],exact=True)).to_be_visible()
    page.evaluate('window.__QA__.rebootPending=false')
    page.get_by_role('button',name=ru['Check connection'],exact=True).click()
    expect(page.get_by_role('radiogroup',name=ru['Hermes settings sections'])).to_be_visible()
    expect(page.get_by_text(ru['Server reboot requested'],exact=True)).to_have_count(0)
    page.get_by_role('button',name=ru['Service status and logs'],exact=True).click()
    expect(page.get_by_role('button',name=ru['Reboot server'],exact=True)).to_have_count(0)
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations,violations
    assert not errors,errors
    browser.close()
    print('PASS: reboot control, unsaved/running-job guards, failure/retry, expected SSH disconnect, EN/RU, reconnect and accessibility.')
