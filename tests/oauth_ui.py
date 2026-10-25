"""Exercise browser/device OAuth with deterministic IPC and no real account authorization."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium', default='/home/buldozer/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome')
args = parser.parse_args()
ru = json.loads(Path('frontend/locales/ru.json').read_text())
screenshots = Path('/tmp/hermes-companion-screenshots')
screenshots.mkdir(exist_ok=True)
remote = dict(provider='openrouter', model='server-model', authMethod='api_key', channels=[],
              tools=['file', 'memory', 'web', 'tts'], ttsProvider='edge', sttProvider='groq')
fixture = Path('tests/fixtures/desktop-mock.js').read_text() + '''
window.__QA__.connected=true;
Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:true});
window.__QA__.remoteSetup=''' + json.dumps(remote) + ';'

def accessible(page):
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
    assert not violations, violations

def complete_job(page):
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete',modelConfigured:true})")
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.', exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role('progressbar')).to_have_count(0, timeout=10000)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=args.chromium)
    page = browser.new_page(viewport={'width':1440,'height':1050})
    page.add_init_script(fixture)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Manage Hermes', exact=True).click()
    page.get_by_role('radio', name='Services', exact=True).click()
    page.get_by_role('switch', name='Text-to-speech', exact=True).uncheck()
    page.get_by_role('radio', name='Model and provider', exact=True).click()
    page.get_by_role('radio', name='OpenAI', exact=True).click()
    page.locator('#model-name').fill('gpt-5.5')
    page.get_by_role('radio', name='ChatGPT subscription (OAuth)', exact=True).click()
    expect(page.locator('#model-name')).to_have_value('gpt-5.5')
    expect(page.locator('#credential-OPENAI_API_KEY')).to_have_count(0)
    page.get_by_role('button', name='Apply changes', exact=True).click()
    expect(page.get_by_text('Authorize this provider in your browser before applying changes.', exact=True)).to_be_visible()
    page.get_by_role('button', name='Sign in with browser', exact=True).click()
    expect(page.get_by_text('QA-1234', exact=True)).to_be_visible()
    assert page.evaluate('window.__QA__.openedUrls')[-1] == 'https://auth.openai.com/device'
    expect(page.locator('#oauth-callback')).to_have_count(0)
    page.evaluate('window.__QA__.authStatus="approved"')
    expect(page.get_by_text('Account authorized. Apply changes to use this connection.', exact=True)).to_be_visible(timeout=10000)
    assert page.evaluate('window.__QA__.applyCalls') == 0
    page.get_by_role('button', name='Apply changes', exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.setup.provider') == 'openai-codex'
    assert page.evaluate('window.__QA__.lastUpdate.setup.authMethod') == 'oauth'
    assert 'tts' not in page.evaluate('window.__QA__.lastUpdate.setup.tools')
    assert page.evaluate('window.__QA__.lastSecrets.values') == []
    complete_job(page)

    page.get_by_role('radio', name='Anthropic', exact=True).click()
    page.get_by_role('radio', name='Browser sign-in (OAuth)', exact=True).click()
    page.locator('#model-name').fill('claude-test-model')
    expect(page.locator('#credential-ANTHROPIC_API_KEY')).to_have_count(0)
    page.get_by_role('button', name='Sign in with browser', exact=True).click()
    expect(page.locator('#oauth-callback')).to_be_visible()
    assert page.evaluate('window.__QA__.openedUrls')[-1].startswith('https://claude.ai/oauth/authorize?')
    accessible(page)
    page.screenshot(path=str(screenshots/'oauth-anthropic.png'), full_page=True, animations='disabled')
    page.get_by_role('radio', name=ru['Russian'], exact=True).click()
    expect(page.get_by_label(ru['Callback URL or authorization code'])).to_be_visible()
    page.screenshot(path=str(screenshots/'oauth-anthropic-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    accessible(page)
    page.screenshot(path=str(screenshots/'oauth-mobile-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width':1440,'height':1050})
    page.get_by_role('radio', name='English', exact=True).click()
    code = 'https://console.anthropic.com/oauth/code/callback?code=private-callback-code&state=qa-state-1234567890'
    page.locator('#oauth-callback').fill(code)
    page.locator('#oauth-callback').press('Enter')
    assert page.evaluate('window.__QA__.applyCalls') == 1
    expect(page.get_by_text('Account authorized. Apply changes to use this connection.', exact=True)).to_be_visible(timeout=10000)
    assert page.evaluate('window.__QA__.authActions.filter(a=>a.action==="submit").at(-1).code') == code
    assert code not in page.content()
    assert 'private-callback-code' not in page.evaluate('JSON.stringify(localStorage)')
    assert 'private-callback-code' not in page.evaluate('JSON.stringify(window.__QA__.workspace)')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.setup.provider') == 'anthropic'
    assert page.evaluate('window.__QA__.lastSecrets.values') == []
    complete_job(page)

    page.get_by_role('radio', name='API key', exact=True).click()
    expect(page.locator('#credential-ANTHROPIC_API_KEY')).to_be_visible()
    page.get_by_role('radio', name='Browser sign-in (OAuth)', exact=True).click()
    page.get_by_role('button', name='Sign in again', exact=True).click()
    expect(page.locator('#oauth-callback')).to_be_visible()
    page.get_by_role('radio', name='DeepSeek', exact=True).click()
    page.wait_for_function('window.__QA__.authActions.some(a=>a.action==="cancel"&&a.provider==="anthropic")')
    expect(page.locator('#oauth-callback')).to_have_count(0)

    page.get_by_role('radio', name='OpenRouter', exact=True).click()
    page.get_by_role('radio', name='Browser sign-in (OAuth)', exact=True).click()
    page.get_by_role('button', name='Sign in with browser', exact=True).click()
    expect(page.locator('#oauth-callback')).to_be_visible()
    page.evaluate('window.__QA__.authStatus="expired"')
    expect(page.get_by_text('Sign-in expired. Start again to get a new link.', exact=True)).to_be_visible(timeout=10000)
    page.get_by_role('button', name='Sign in with browser', exact=True).click()
    expect(page.locator('#oauth-callback')).to_be_visible()
    page.get_by_role('button', name='Cancel', exact=True).click()
    expect(page.locator('#oauth-callback')).to_have_count(0)
    assert not errors, errors
    browser.close()
    print('PASS: API/OAuth selection, ChatGPT device approval, browser opening, Anthropic callback, preserved drafts, explicit apply, secret isolation, cancellation, expiration/retry, OpenRouter, EN/RU, mobile and accessibility.')
