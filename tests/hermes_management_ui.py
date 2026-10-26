"""Test installed-server management without real model, messenger or paid API calls."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
translations = json.loads(Path('frontend/locales/ru.json').read_text())
screenshots = Path('/tmp/hermes-companion-screenshots')
screenshots.mkdir(exist_ok=True)
remote = dict(provider='openrouter', model='server/actual-model', channels=['telegram'],
              tools=['file', 'memory', 'web', 'tts'], ttsProvider='edge', sttProvider='groq',
              searchBackend='ddgs', extractBackend='builtin', imageProvider='fal')
fixture = Path('tests/fixtures/desktop-mock.js').read_text() + '''
window.__QA__.connected = true;
Object.assign(window.__QA__.job, {state:'succeeded', operation:'install', managed:true,
  installedVersion:'v9.8.7', serviceInstalled:true, serviceActive:true, apiHealthy:true, modelConfigured:true});
window.__QA__.configuredCredentials = ['OPENROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS'];
window.__QA__.remoteSetup = ''' + json.dumps(remote) + ';'

def accessible(page):
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async () => (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
    assert not violations, violations

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=args.chromium)
    page = browser.new_page(viewport={'width':1440, 'height':1050})
    page.add_init_script(fixture)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Manage Hermes', exact=True).click()
    expect(page.get_by_role('radiogroup', name='Hermes settings sections')).to_be_visible()
    expect(page.get_by_role('radio', name='Model and provider', exact=True)).to_be_checked()
    expect(page.locator('#model-name')).to_have_value('server/actual-model')
    expect(page.get_by_role('button', name='Continue to model', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled()
    expect(page.locator('#credential-OPENROUTER_API_KEY')).to_have_count(0)
    accessible(page)
    page.screenshot(path=str(screenshots/'management-model.png'), full_page=True, animations='disabled')

    page.get_by_role('button', name='Replace', exact=True).click()
    page.locator('#credential-OPENROUTER_API_KEY').fill('rotated-model-key')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.sections') == ['model']
    assert [item['name'] for item in page.evaluate('window.__QA__.lastSecrets.values')] == ['OPENROUTER_API_KEY']
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_be_visible(timeout=15000)
    expect(page.locator('#credential-OPENROUTER_API_KEY')).to_have_count(0)
    expect(page.get_by_role('button', name='Replace', exact=True)).to_be_visible()
    page.get_by_role('button', name='Replace', exact=True).click()
    page.locator('#credential-OPENROUTER_API_KEY').fill('abandoned-model-key')
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_have_count(0)
    page.get_by_role('radio', name='Channels', exact=True).click()
    expect(page.locator('#credential-TELEGRAM_BOT_TOKEN')).to_have_count(0)
    expect(page.get_by_text('Configured on server', exact=True)).to_have_count(2)
    page.get_by_role('switch', name='Telegram', exact=True).uncheck()
    page.get_by_role('switch', name='Telegram', exact=True).check()
    page.get_by_role('radio', name='Agent tools', exact=True).click()
    page.get_by_role('checkbox', name='Memory', exact=True).uncheck()
    page.get_by_role('radio', name='Services', exact=True).click()
    page.get_by_role('switch', name='Web search', exact=True).uncheck()
    expect(page.get_by_role('radio', name='DuckDuckGo Recommended', exact=True)).to_have_count(0)
    page.get_by_role('switch', name='Web search', exact=True).check()
    page.get_by_role('switch', name='Speech-to-text', exact=True).click()
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.locator('#credential-GROQ_API_KEY')).to_have_attribute('aria-invalid','true')
    assert page.evaluate('window.__QA__.applyCalls') == 1
    page.locator('#credential-GROQ_API_KEY').fill('new-groq-key')
    page.get_by_role('radio', name='Brave Search', exact=True).click()
    page.locator('#credential-BRAVE_SEARCH_API_KEY').fill('new-brave-key')
    page.get_by_role('radio', name='Model and provider', exact=False).first.click()
    page.get_by_role('radio', name='DeepSeek', exact=True).click()
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.locator('#credential-DEEPSEEK_API_KEY')).to_have_attribute('aria-invalid','true')
    page.locator('#credential-DEEPSEEK_API_KEY').fill('new-deepseek-key')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.get_by_role('progressbar')).to_be_visible()
    assert page.evaluate('window.__QA__.installCalls') == 0
    assert page.evaluate('window.__QA__.applyCalls') == 2
    payload = page.evaluate('window.__QA__.lastUpdate')
    assert set(payload['sections']) == {'model','services','tools'}
    names = {item['name'] for item in page.evaluate('window.__QA__.lastSecrets.values')}
    assert names == {'DEEPSEEK_API_KEY','GROQ_API_KEY','BRAVE_SEARCH_API_KEY'}, names
    assert 'new-deepseek-key' not in page.evaluate('JSON.stringify(localStorage)')
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete',modelConfigured:true})")
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_be_visible(timeout=15000)
    expect(page.locator('#credential-DEEPSEEK_API_KEY')).to_have_count(0)
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled()

    page.get_by_role('radio', name='Agent tools', exact=True).click()
    page.get_by_role('checkbox', name='Memory', exact=True).check()
    page.get_by_role('button', name='Discard changes', exact=True).click()
    expect(page.get_by_role('checkbox', name='Memory', exact=True)).not_to_be_checked()
    page.get_by_role('radio', name='Model and provider', exact=True).click()
    page.evaluate("window.__QA__.remoteSetup.model='cli-edited-model';window.__QA__.revision='external-revision'")
    page.get_by_role('button', name='Refresh settings', exact=True).click()
    expect(page.locator('#model-name')).to_have_value('cli-edited-model')
    page.locator('#model-name').fill('unsaved-model')
    page.evaluate("window.__QA__.revision='another-external-revision'")
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.get_by_text('The server settings changed. Reload them before applying your changes.', exact=True)).to_be_visible()
    page.get_by_role('button', name='Discard edits and refresh settings', exact=True).click()
    expect(page.locator('#model-name')).to_have_value('cli-edited-model')

    page.get_by_role('radio', name=translations['Russian'], exact=True).click()
    accessible(page)
    page.screenshot(path=str(screenshots/'management-model-ru.png'), full_page=True, animations='disabled')
    page.get_by_role('radio', name=translations['Agent tools'], exact=True).click()
    accessible(page)
    page.screenshot(path=str(screenshots/'management-tools-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    accessible(page)
    page.screenshot(path=str(screenshots/'management-mobile-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width':1440,'height':1050})
    page.get_by_role('radio', name='English', exact=True).click()
    page.get_by_role('button', name='My servers', exact=False).click()
    expect(page.get_by_role('button', name='Manage Hermes', exact=True)).to_be_visible()
    page.evaluate("Object.assign(window.__QA__.job,{state:'running',step:'configure'})")
    page.get_by_role('button', name='Show progress', exact=True).click(timeout=15000)
    expect(page.get_by_role('progressbar')).to_be_visible()
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_role('button', name='Refresh settings', exact=True)).to_be_enabled(timeout=15000)
    page.get_by_role('button', name='My servers', exact=False).click()
    page.get_by_role('button', name='Disconnect SSH', exact=True).click()
    page.get_by_role('button', name='Connect to server', exact=True).click()
    page.get_by_label('Server password').fill('qa-only-password')
    page.get_by_role('button', name='Check connection', exact=True).click()
    expect(page.get_by_role('radiogroup', name='Hermes settings sections')).to_be_visible()
    expect(page.locator('#model-name')).to_have_value('cli-edited-model')
    assert not errors, errors
    browser.close()
    print('PASS: installed-server routing, remote settings, independent sections, key replacement, selective validation/apply, completion, discard, CLI reload/conflict, reconnect, EN/RU, mobile and accessibility.')
