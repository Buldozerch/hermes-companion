"""Exercise Companion and Hermes update controls without installing real packages."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:1420')
parser.add_argument('--chromium',default=None)
args=parser.parse_args()
fixture=Path('tests/fixtures/desktop-mock.js').read_text()
ru=json.loads(Path('frontend/locales/ru.json').read_text())
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=args.chromium)
    page=browser.new_page(viewport={'width':1440,'height':1050})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script(fixture+'''window.__QA__.companionUpdate={currentVersion:'0.1.2',latestVersion:'0.1.3',available:true,canInstall:true,notes:'Signed update regression fixture.'};window.__QA__.companionUpdateError=true;''')
    page.goto(args.url);page.wait_for_load_state('networkidle')
    expect(page.get_by_role('button',name='Companion updates',exact=True)).to_contain_text('Update Companion 0.1.3')
    page.get_by_role('button',name='Companion updates',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button',name='Install and restart',exact=True).click()
    expect(page.get_by_text('The application update failed. Signature verification failed.',exact=True)).to_be_visible()
    assert page.evaluate('window.__QA__.companionInstallCalls??0')==0
    page.evaluate('window.__QA__.companionUpdateError=false')
    page.get_by_role('button',name='Install and restart',exact=True).click()
    expect(page.get_by_role('progressbar',name='Update download progress')).to_have_attribute('value','50')
    expect(page.get_by_role('status')).to_contain_text('Restarting application…')
    assert page.evaluate('window.__QA__.companionInstallCalls')==1
    page.close()

    page=browser.new_page(viewport={'width':1440,'height':1050});page.on('pageerror',lambda error:errors.append(str(error)))
    page.add_init_script(fixture+'''window.__QA__.connected=true;Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:true});window.__QA__.hermesUpdate={currentVersion:'v9.8.7',latestVersion:'v9.8.8',available:true};''')
    page.goto(args.url);page.wait_for_load_state('networkidle');page.get_by_role('button',name='Manage Hermes',exact=True).click()
    update=page.get_by_role('button',name='Update Hermes to v9.8.8',exact=True)
    expect(update).to_be_enabled()
    page.locator('#model-name').fill('unsaved-model');expect(update).to_be_disabled()
    page.get_by_role('button',name='Discard changes',exact=True).click();expect(update).to_be_enabled()
    before=page.evaluate('JSON.stringify(window.__QA__.workspace.servers[0].setup)')
    update.click();expect(page.get_by_text('Updating Hermes…',exact=True).first).to_be_visible()
    expect(page.get_by_role('progressbar')).to_be_visible()
    assert page.evaluate('window.__QA__.hermesUpdateCalls')==1
    assert page.evaluate('window.__QA__.installCalls')==0
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete',installedVersion:'v9.8.8'});window.__QA__.hermesUpdate={currentVersion:'v9.8.8',latestVersion:'v9.8.8',available:false}")
    expect(page.get_by_text('Hermes is up to date',exact=True)).to_be_visible(timeout=15000)
    assert before==page.evaluate('JSON.stringify(window.__QA__.workspace.servers[0].setup)')
    page.get_by_role('radio',name=ru['Russian'],exact=True).click()
    expect(page.get_by_text(ru['Hermes is up to date'],exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations,violations
    assert not errors,errors
    browser.close()
    print('PASS: automatic Companion notification, failed verification/retry, download progress/restart, Hermes update, unsaved-change guard, configuration preservation, EN/RU and accessibility.')
