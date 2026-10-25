"""Exercise custom transport selection and legacy repair without a live LLM request."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:1420')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
ru = json.loads(Path('frontend/locales/ru.json').read_text())
fixture = Path('tests/fixtures/desktop-mock.js').read_text() + '''
window.__QA__.connected=true;
Object.assign(window.__QA__.job,{state:'succeeded',operation:'install',managed:true,installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:true});
window.__QA__.remoteSetup={provider:'custom',model:'gpt-6.1-sol',baseUrl:'https://gateway.example/v1',apiMode:'codex_responses',authMethod:'api_key',allowUnauthenticatedModel:false,channels:[],tools:['file','memory'],ttsProvider:'edge',sttProvider:'groq'};
window.__QA__.configuredCredentials=['COMPANION_CUSTOM_API_KEY'];
window.__QA__.modelTransportNeedsUpdate=true;
window.__QA__.modelCatalog={models:['gpt-6.1-sol','gpt-6-astra'],source:'provider',status:'ok',message:'',truncated:false};
'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script(fixture)
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_text('SSH connected', exact=True)).to_have_css('color', 'rgb(74, 222, 128)')
    page.get_by_role('button', name='Manage Hermes', exact=True).click()
    mode = page.get_by_label('Transport / API mode', exact=True)
    expect(mode).to_have_value('codex_responses')
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled()
    repair = page.get_by_role('button', name='Apply transport fix', exact=True)
    expect(repair).to_be_enabled()
    page.locator('#model-name').fill('pending-model-edit')
    expect(repair).to_be_disabled()
    page.get_by_role('button', name='Discard changes', exact=True).click()
    expect(repair).to_be_enabled()
    repair.click()
    assert page.evaluate('window.__QA__.lastUpdate.sections') == ['model']
    assert page.evaluate('window.__QA__.lastUpdate.setup.model') == 'gpt-6.1-sol'
    assert page.evaluate('window.__QA__.lastUpdate.setup.baseUrl') == 'https://gateway.example/v1'
    assert page.evaluate('window.__QA__.lastUpdate.setup.apiMode') == 'codex_responses'
    assert page.evaluate('window.__QA__.lastSecrets.values') == []
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(repair).to_have_count(0, timeout=15000)
    expect(mode).to_have_value('codex_responses')
    mode.select_option('chat_completions')
    expect(page.get_by_role('button', name='Use OpenAI Responses', exact=True)).to_be_visible()
    # A model change/catalog refresh must preserve an explicit protocol selection.
    page.locator('#model-name').fill('gpt-6-astra')
    expect(mode).to_have_value('chat_completions')
    page.get_by_role('button', name='Use OpenAI Responses', exact=True).click()
    expect(mode).to_have_value('codex_responses')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.setup.apiMode') == 'codex_responses'
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled(timeout=15000)
    mode.select_option('chat_completions')
    page.get_by_role('button', name='Apply changes', exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.setup.apiMode') == 'chat_completions'
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_role('button', name='Apply changes', exact=True)).to_be_disabled(timeout=15000)
    expect(mode).to_have_value('chat_completions')
    page.evaluate('window.__QA__.modelDelay=3000')
    refresh = page.get_by_role('button', name='Refresh models', exact=True)
    expect(refresh).to_be_enabled(timeout=10000)
    refresh.click()
    spinner = page.locator('button .spin').filter(visible=True)
    expect(spinner.first).to_have_css('animation-name', 'spin')
    expect(mode).to_have_value('chat_completions')
    expect(refresh).to_be_enabled(timeout=10000)
    page.get_by_role('radio', name='Русский', exact=True).click()
    expect(page.get_by_label(ru['Transport / API mode'], exact=True)).to_have_value('chat_completions')
    expect(page.get_by_role('button', name=ru['Use OpenAI Responses'], exact=True)).to_be_visible()
    screenshots = Path('/tmp/hermes-companion-screenshots')
    screenshots.mkdir(exist_ok=True)
    page.screenshot(path=str(screenshots / 'custom-transport-ru.png'), full_page=True, animations='disabled')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async () => (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id)")
    assert not violations, violations
    assert not errors, errors
    browser.close()
    print('PASS: named transport repair, unchanged key/endpoint/model, explicit Chat/Responses selection, Sol/Astra hint, animated model loading, green SSH status, EN/RU and accessibility.')
