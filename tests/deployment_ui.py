"""Check installation UX using deterministic IPC; never connect to a real server."""

import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium')
args = parser.parse_args()
ru = json.loads(Path('frontend/locales/ru.json').read_text())
screenshots = Path('/tmp/hermes-companion-screenshots')
screenshots.mkdir(exist_ok=True)
errors = []


def accessible(page):
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async () => (await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
    assert not violations, violations


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    page.add_init_script(Path('tests/fixtures/desktop-mock.js').read_text())
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('button', name='Hermes settings', exact=True)).to_be_disabled()
    page.get_by_role('button', name='Connect to server', exact=True).click()
    page.get_by_label('Server password').fill('qa-ssh-password')
    page.get_by_role('button', name='Check connection', exact=True).click()
    expect(page.get_by_role('heading', name='Connection established')).to_be_visible()
    expect(page.locator('.connection-success h3')).to_have_css('color','rgb(74, 222, 128)')
    expect(page.get_by_role('button', name='Hermes settings', exact=True)).to_be_disabled()
    page.get_by_role('button', name='Set up Hermes', exact=True).click()
    expect(page.get_by_role('heading',name='Install Hermes first',exact=True)).to_be_visible()
    expect(page.locator('#credential-TELEGRAM_BOT_TOKEN')).to_have_count(0)
    expect(page.locator('#credential-OPENROUTER_API_KEY')).to_have_count(0)
    page.get_by_role('radio',name=ru['Russian'],exact=True).click()
    accessible(page)
    page.evaluate('window.__QA__.serverClockOffset=18000')
    page.get_by_role('button',name=ru['Install latest Hermes'],exact=True).click()
    expect(page.get_by_role('progressbar',name=ru['Installation progress'])).to_be_visible()
    assert page.evaluate('window.__QA__.installCalls')==1
    assert page.evaluate('window.__QA__.lastSecrets.values')==[]
    assert 'qa-ssh-password' not in page.evaluate('JSON.stringify(localStorage)')
    page.get_by_role('radio', name='English', exact=True).click()
    expect(page.get_by_role('progressbar', name='Installation progress')).to_be_visible()
    expect(page.get_by_role('button', name='Restart', exact=True)).to_be_disabled()
    expect(page.get_by_role('button', name='Hermes settings', exact=True)).to_be_disabled()
    expect(page.get_by_text('Live installer output', exact=True)).to_be_visible()
    expect(page.get_by_label('Installer output', exact=True)).to_contain_text('API_SERVER_KEY=[REDACTED]')
    assert page.get_by_test_id('installation-elapsed').inner_text().startswith('02:'), 'VPS clock skew changed elapsed time'
    page.emulate_media(reduced_motion='no-preference')
    spinner = page.locator('.deployment-stage .spin')
    expect(spinner).to_have_css('animation-name','spin')
    transform = spinner.evaluate('(element) => getComputedStyle(element).transform')
    page.wait_for_function('previous => getComputedStyle(document.querySelector(".deployment-stage .spin")).transform !== previous', arg=transform, timeout=2000)
    # The operational spinner keeps rotating with reduced motion; decorative animations stay off.
    page.emulate_media(reduced_motion='reduce')
    expect(spinner).to_have_css('animation-name','spin')
    transform = spinner.evaluate('(element) => getComputedStyle(element).transform')
    page.wait_for_function('previous => getComputedStyle(document.querySelector(".deployment-stage .spin")).transform !== previous', arg=transform, timeout=2000)
    before = page.get_by_test_id('installation-elapsed').inner_text()
    expect(page.get_by_test_id('installation-elapsed')).not_to_have_text(before, timeout=4000)
    page.evaluate("window.__QA__.remoteLogs='Preparing dependencies…\\nDependencies installed.\\n--- Hermes service journal ---\\nOld service log must stay separate.'")
    expect(page.get_by_label('Installer output', exact=True)).to_contain_text('Dependencies installed.', timeout=15000)
    expect(page.get_by_label('Installer output', exact=True)).not_to_contain_text('Old service log')
    page.evaluate("window.__QA__.deploymentError=true")
    expect(page.get_by_text('The server status could not be refreshed.',exact=True)).to_be_visible(timeout=10000)
    page.evaluate("window.__QA__.deploymentError=false")
    expect(page.get_by_text('The server status could not be refreshed.',exact=True)).to_have_count(0, timeout=10000)
    accessible(page)
    page.screenshot(path=str(screenshots / 'installation-live.png'), full_page=True, animations='disabled')
    # Simulate an interruption and verify that the existing remote job can be retried.
    page.evaluate("Object.assign(window.__QA__.job, {state:'interrupted', events:['The remote job was interrupted.']})")
    expect(page.get_by_role('button', name='Retry installation', exact=True)).to_be_enabled(timeout=10000)
    expect(page.get_by_role('button', name='Hermes settings', exact=True)).to_be_disabled()
    page.get_by_role('button', name='Retry installation', exact=True).click()
    expect(page.get_by_role('progressbar')).to_be_visible()
    assert page.evaluate('window.__QA__.installCalls') == 2
    page.evaluate("Object.assign(window.__QA__.job, {state:'succeeded', step:'complete', installedVersion:'v9.8.7', serviceActive:true, serviceInstalled:true, apiHealthy:true, modelConfigured:false, events:['Installation completed.']})")
    expect(page.get_by_role('button', name='Stop', exact=True)).to_be_enabled(timeout=10000)
    expect(page.get_by_role('button', name='Hermes settings', exact=True)).to_be_enabled(timeout=10000)
    expect(page.get_by_role('button', name='Install latest Hermes', exact=True)).to_have_count(0)
    page.get_by_role('button', name='Stop', exact=True).click()
    expect(page.get_by_role('button', name='Start', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Start', exact=True).click()
    expect(page.get_by_role('button', name='Stop', exact=True)).to_be_enabled()
    page.get_by_role('button', name='Restart', exact=True).click()
    page.evaluate('window.__QA__.remoteLogs=null')
    page.get_by_role('button', name='View diagnostic logs', exact=True).click()
    expect(page.get_by_text('API_SERVER_KEY=[REDACTED]', exact=False)).to_be_visible()
    page.get_by_role('radio', name=ru['Russian'], exact=True).click()
    expect(page.get_by_role('button', name=ru['Restart'], exact=True)).to_be_visible()
    expect(page.get_by_text('Installation completed.', exact=False)).to_be_visible()
    accessible(page)
    page.screenshot(path=str(screenshots / 'installed-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'Installation panel overflows on mobile'
    accessible(page)
    page.set_viewport_size({'width':1440,'height':1100})
    page.get_by_role('radio',name='English',exact=True).click()
    page.get_by_role('button',name='Hermes settings',exact=True).click()
    page.get_by_role('radio',name='Model and provider',exact=True).click()
    page.get_by_role('combobox',name='All model providers',exact=True).click()
    page.get_by_role('option',name='ChatGPT or Codex Subscription',exact=True).click()
    page.locator('#model-name').fill('gpt-5.5')
    page.get_by_role('button',name='Sign in with browser',exact=True).click()
    expect(page.get_by_text('QA-1234',exact=True)).to_be_visible()
    expect(page.get_by_role('link',name='Open sign-in page',exact=True)).to_have_attribute('href','https://auth.openai.com/device')
    accessible(page)
    page.screenshot(path=str(screenshots / 'provider-sign-in.png'),full_page=True,animations='disabled')
    page.evaluate('window.__QA__.authStatus="approved"')
    expect(page.get_by_text('Account authorized. Apply changes to use this connection.',exact=True)).to_be_visible(timeout=10000)
    assert page.evaluate('window.__QA__.applyCalls')==0
    page.get_by_role('button',name='Apply changes',exact=True).click()
    expect(page.get_by_role('progressbar')).to_be_visible()
    assert page.evaluate('window.__QA__.applyCalls')==1
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.',exact=True)).to_be_visible(timeout=15000)
    assert not errors, errors
    browser.close()
    print('PASS: latest-release install, secret isolation, EN/RU, remote progress, retry, service controls, English logs, responsive layout and accessibility')
