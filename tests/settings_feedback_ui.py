"""Check viewport-anchored logs, read-only refresh wording and truthful green status."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium')
args = parser.parse_args()
ru = json.loads(Path('frontend/locales/ru.json').read_text())
fixture = Path('tests/fixtures/desktop-mock.js').read_text() + '''
window.__QA__.connected=true;
Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:true});
window.__QA__.remoteSetup={provider:'openrouter',model:'server/model',channels:[],tools:['file','memory','web','tts'],ttsProvider:'edge',sttProvider:'groq'};
'''


def assert_panel_bounds(panel):
    position = panel.evaluate('element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,width:r.width,height:innerHeight,viewportWidth:innerWidth,transform:getComputedStyle(element).transform,translate:getComputedStyle(element).translate}}')
    assert abs(position['top']) <= 1, position
    assert abs(position['bottom'] - position['height']) <= 1, position
    assert abs(position['right'] - position['viewportWidth']) <= 1, position
    assert position['width'] <= position['viewportWidth'] + 1, position
    assert position['transform'] == 'none', position
    assert position['translate'] == 'none', position
    # The close control must also be inside the viewport, not just the scrollable log body.
    assert panel.locator('[data-slot="dialog-close"]').evaluate('element=>{const r=element.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.right<=innerWidth}')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium)
    page = browser.new_page(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    page.add_init_script(fixture)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='Manage Hermes', exact=True).click()
    badge = page.locator('.management-heading [data-slot="badge"]')
    expect(badge).to_have_text('Running')
    expect(badge).to_have_css('color', 'rgb(74, 222, 128)')
    refresh = page.get_by_role('button', name='Refresh settings', exact=True)
    expect(refresh).to_have_attribute('title', 'Read the current Hermes settings from the server into this form.')
    before = page.evaluate('window.__QA__.settingsReads')
    refresh.click()
    expect(page.locator('#model-name')).to_have_value('server/model')
    assert page.evaluate('window.__QA__.settingsReads') > before
    assert page.evaluate('window.__QA__.applyCalls') == 0
    assert page.evaluate('window.__QA__.installCalls') == 0
    page.locator('#model-name').fill('draft-model')
    expect(refresh).to_be_disabled()
    page.get_by_role('button', name='Discard changes', exact=True).click()
    page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
    assert page.evaluate('scrollY') > 0
    page.get_by_role('button', name='Logs', exact=True).click()
    panel = page.get_by_role('dialog', name='Server operation and logs')
    expect(panel).to_have_attribute('data-placement', 'right')
    assert_panel_bounds(panel)
    expect(panel.locator('dt', has_text='Service').locator('..').locator('dd')).to_have_css('color', 'rgb(74, 222, 128)')
    expect(panel.locator('dt', has_text='Local API').locator('..').locator('dd')).to_have_css('color', 'rgb(74, 222, 128)')
    page.set_viewport_size({'width': 1440, 'height': 520})
    assert_panel_bounds(panel)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert_panel_bounds(panel)
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_role('button', name='Logs', exact=True)).to_be_focused()
    page.set_viewport_size({'width': 1440, 'height': 900})
    # An active process with an unhealthy API must not look ready.
    page.evaluate('window.__QA__.job.apiHealthy=false')
    expect(badge).to_have_text('API not ready', timeout=10000)
    expect(badge).not_to_have_css('color', 'rgb(74, 222, 128)')
    page.evaluate('Object.assign(window.__QA__.job,{serviceActive:false,apiHealthy:false})')
    expect(badge).to_have_text('Stopped', timeout=10000)
    expect(badge).not_to_have_css('color', 'rgb(74, 222, 128)')
    page.evaluate('Object.assign(window.__QA__.job,{serviceActive:true,apiHealthy:true})')
    expect(badge).to_have_text('Running', timeout=10000)
    page.get_by_role('radio', name='Русский', exact=True).click()
    expect(page.get_by_role('button', name=ru['Refresh settings'], exact=True)).to_be_visible()
    expect(badge).to_have_text(ru['Running'])
    expect(badge).to_have_css('color', 'rgb(74, 222, 128)')
    page.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)')
    page.get_by_role('button', name=ru['Logs'], exact=True).click()
    panel = page.get_by_role('dialog', name=ru['Server operation and logs'])
    assert_panel_bounds(panel)
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async () => (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations, violations
    screenshots = Path('/tmp/hermes-companion-screenshots')
    screenshots.mkdir(exist_ok=True)
    page.screenshot(path=str(screenshots / 'logs-viewport-ru.png'), animations='disabled')
    page.get_by_role('button', name=ru['Close'], exact=True).click()
    # Existing modal windows retain centered placement.
    page.get_by_role('button', name=ru['Companion updates'], exact=True).click()
    modal = page.get_by_role('dialog', name=ru['Companion updates'])
    expect(modal).to_have_attribute('data-placement', 'center')
    assert modal.evaluate('e=>{const r=e.getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-innerHeight/2)<2 && Math.abs((r.left+r.right)/2-innerWidth/2)<2}')
    assert not errors, errors
    browser.close()
    print('PASS: scrolled/short/mobile viewport bounds, stable close control, preserved modal placement, read-only refresh, green healthy status, neutral stopped/unhealthy status, EN/RU and accessibility.')
