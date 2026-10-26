"""Verify the first settings walkthrough, pinned actions and visible server feedback."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium')
args = parser.parse_args()
ru = json.loads(Path('frontend/locales/ru.json').read_text())
fixture = Path('tests/fixtures/desktop-mock.js').read_text() + '''
window.__QA__.connected=true;
window.__QA__.configuredCredentials=[];
window.__QA__.onboarding={current:'model',completed:[],skipped:[],finished:false,pending:null};
window.__QA__.remoteSetup={deferModelSetup:true,provider:'openrouter',model:'',channels:[],tools:['file','memory','web','tts'],ttsProvider:'edge',sttProvider:'groq'};
Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:false,rebootRequired:true});
'''


def open_settings(browser, script):
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    page.add_init_script(script)
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name=re.compile(r'^(Manage Hermes|Show progress)$')).click()
    expect(page.locator('[aria-label="Hermes settings sections"]')).to_be_visible()
    return page


def restore_script(page):
    snapshot = page.evaluate('({onboarding:window.__QA__.onboarding,remoteSetup:window.__QA__.remoteSetup,configuredCredentials:window.__QA__.configuredCredentials,job:window.__QA__.job,revision:window.__QA__.revision})')
    return fixture + '\nObject.assign(window.__QA__,' + json.dumps(snapshot) + ');'


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium)
    page = open_settings(browser, fixture)
    expect(page.get_by_role('button', name='Reboot server', exact=True)).to_be_enabled()
    expect(page.get_by_text('You can reboot now. SSH will disconnect briefly; reconnect when the server starts.', exact=True)).to_be_visible()
    page.get_by_role('radio', name='OpenRouter', exact=True).click()
    page.locator('#model-name').fill('qa/test-model')
    page.locator('#credential-OPENROUTER_API_KEY').fill('test-only-model-key')
    expect(page.get_by_role('button', name='Reboot server', exact=True)).to_be_disabled()
    page.get_by_role('radio', name='Channels', exact=True).click()
    left = page.get_by_role('navigation', name='Server settings navigation')
    left.get_by_role('button', name='Model and provider', exact=False).click()
    expect(page.locator('#credential-OPENROUTER_API_KEY')).to_have_value('test-only-model-key')
    actions = page.locator('footer[aria-label="Settings actions"]')
    assert actions.evaluate('(element) => {const r=element.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1}')
    page.get_by_role('button', name='Save and continue', exact=True).click()
    expect(page.get_by_role('dialog', name='Server operation and logs')).to_be_visible()
    expect(page.get_by_label('Diagnostic logs', exact=True)).to_contain_text('API_SERVER_KEY=[REDACTED]')
    assert page.evaluate('window.__QA__.onboarding.current') == 'model'
    assert page.evaluate('window.__QA__.onboarding.completed') == []
    assert 'test-only-model-key' not in page.evaluate('JSON.stringify(window.__QA__.onboarding)')
    # Closing during a durable job must resume that exact job before advancing the step.
    pending_script = restore_script(page)
    page.close()
    page = open_settings(browser, pending_script)
    expect(page.get_by_role('dialog', name='Server operation and logs')).to_be_visible()
    assert page.evaluate('window.__QA__.onboarding.completed') == []
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete',modelConfigured:true})")
    expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
    expect(page.get_by_role('radio', name='Channels', exact=True)).to_be_checked()
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_have_css('color', 'rgb(74, 222, 128)')
    assert page.evaluate('window.__QA__.onboarding.completed') == ['model']
    Path('/tmp/hermes-companion-screenshots').mkdir(exist_ok=True)
    page.screenshot(path='/tmp/hermes-companion-screenshots/settings-walkthrough.png', full_page=True, animations='disabled')
    # Reopen with the persisted database response; native DB tests cover actual disk persistence/isolation.
    script = restore_script(page)
    page.close()
    page = open_settings(browser, script)
    expect(page.get_by_role('radio', name='Channels', exact=True)).to_be_checked()
    page.get_by_role('button', name='Skip for now', exact=True).click()
    expect(page.get_by_role('radio', name='Services', exact=True)).to_be_checked()
    assert page.evaluate('window.__QA__.onboarding.skipped') == ['channels']
    page.get_by_role('button', name='Next section', exact=True).click()
    expect(page.get_by_role('radio', name='Agent tools', exact=True)).to_be_checked()
    page.get_by_role('button', name='Finish setup', exact=True).click()
    expect(page.get_by_text('Settings walkthrough complete', exact=True)).to_be_visible()
    assert page.evaluate('window.__QA__.onboarding.finished')
    script = restore_script(page)
    page.close()
    page = open_settings(browser, script)
    expect(page.get_by_role('button', name='Next section', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled()
    # A failed job opens logs and never reports a green success.
    page.locator('#model-name').fill('changed-model')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.evaluate("Object.assign(window.__QA__.job,{state:'failed',step:'configure',events:['The configuration job failed.']})")
    expect(page.get_by_text('The configuration job failed.', exact=False)).to_be_visible(timeout=15000)
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_have_count(0)
    page.get_by_role('radio', name='Русский', exact=True).click()
    page.set_viewport_size({'width': 390, 'height': 844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.get_by_role('button', name=ru['Logs'], exact=True).click()
    expect(page.get_by_role('dialog', name=ru['Server operation and logs'])).to_be_visible()
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async () => (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations, violations
    Path('/tmp/hermes-companion-screenshots').mkdir(exist_ok=True)
    page.screenshot(path='/tmp/hermes-companion-screenshots/settings-operation-mobile.png', full_page=True, animations='disabled')
    browser.close()
    print('PASS: per-server walkthrough resume/completion, optional skips, synchronized navigation, retained drafts, pinned actions, green success, visible reboot timing, automatic logs, failure feedback, EN/RU and accessibility.')
