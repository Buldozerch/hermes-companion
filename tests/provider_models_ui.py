"""Exercise provider preparation, Google OAuth and model discovery with deterministic IPC."""
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
window.__QA__.remoteSetup={provider:'openrouter',model:'saved/model',authMethod:'api_key',channels:[],tools:['file','memory','web','tts'],ttsProvider:'edge',sttProvider:'groq'};
window.__QA__.modelCatalog={models:['live/First','live/Second'],source:'provider',status:'ok',message:'',truncated:false};
'''

def accessible(page):
    page.add_script_tag(path='node_modules/axe-core/axe.min.js')
    violations = page.evaluate("async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
    assert not violations, violations

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=args.chromium)
    page = browser.new_page(viewport={'width':1440,'height':1050})
    page.add_init_script(fixture)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.get_by_role('button',name='Manage Hermes',exact=True).click()
    expect(page.get_by_role('combobox',name='Available models',exact=True)).to_be_visible()
    expect(page.locator('#model-name')).to_have_value('saved/model')
    page.get_by_role('combobox',name='Available models',exact=True).click()
    page.get_by_role('combobox',name='Search models',exact=True).fill('Second')
    page.get_by_role('option',name='live/Second',exact=True).click()
    expect(page.locator('#model-name')).to_have_value('live/Second')
    # The support job must preserve both a different provider draft and another section's draft.
    page.get_by_role('radio',name='Services',exact=True).click()
    page.get_by_role('switch',name='Text-to-speech',exact=True).uncheck()
    page.get_by_role('radio',name='Model and provider',exact=True).click()
    page.get_by_role('radio',name='Google',exact=True).click()
    page.get_by_role('radio',name='Google Antigravity (OAuth)',exact=True).click()
    expect(page.get_by_role('button',name='Install Antigravity support',exact=True)).to_be_visible()
    page.get_by_role('button',name='Install Antigravity support',exact=True).click()
    page.evaluate("window.__QA__.preparedProviders=['antigravity-oauth'];window.__QA__.revision='after-plugin';Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_role('button',name='Sign in with browser',exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role('radio',name='Google Antigravity (OAuth)',exact=True)).to_be_checked()
    page.get_by_role('radio',name='Services',exact=True).click()
    expect(page.get_by_role('switch',name='Text-to-speech',exact=True)).not_to_be_checked()
    page.get_by_role('radio',name='Model and provider',exact=True).click()
    page.get_by_role('button',name='Sign in with browser',exact=True).click()
    expect(page.locator('#oauth-callback')).to_be_visible()
    assert page.evaluate('window.__QA__.openedUrls.at(-1)').startswith('https://accounts.google.com/')
    page.evaluate("window.__QA__.modelCatalog={models:['Gemini-Account-Exact','Claude-Account-Exact'],source:'provider',status:'ok',message:'',truncated:false}")
    page.locator('#oauth-callback').fill('4/private-google-code')
    page.get_by_role('button',name='Complete sign-in',exact=True).click()
    expect(page.get_by_text('Account authorized. Apply changes to use this connection.',exact=True)).to_be_visible(timeout=12000)
    expect(page.locator('#model-name')).to_have_value('Gemini-Account-Exact',timeout=10000)
    assert all(item['name'] not in ['TELEGRAM_BOT_TOKEN','GROQ_API_KEY'] for query in page.evaluate('window.__QA__.modelQueries') for item in query['secrets']['values'])
    accessible(page)
    Path('/tmp/hermes-companion-screenshots').mkdir(exist_ok=True)
    page.evaluate('document.activeElement.blur()')
    page.screenshot(path='/tmp/hermes-companion-screenshots/antigravity-models.png',full_page=True,animations='disabled')
    page.get_by_role('button',name='Apply changes',exact=True).click()
    assert page.evaluate('window.__QA__.lastUpdate.revision') == 'after-plugin'
    assert page.evaluate('window.__QA__.lastUpdate.setup.provider') == 'antigravity-oauth'
    assert page.evaluate('window.__QA__.lastUpdate.setup.model') == 'Gemini-Account-Exact'
    assert page.evaluate('window.__QA__.lastUpdate.sections') == ['model','tools']
    page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete'})")
    expect(page.get_by_text('Changes applied. The Hermes service is healthy.',exact=True)).to_be_visible(timeout=15000)
    # A late catalog from the previous provider must not replace the current provider's models.
    page.evaluate("window.__QA__.modelDelay=3000;window.__QA__.modelCatalog={models:['stale/model'],source:'provider',status:'ok',message:'',truncated:false}")
    page.get_by_role('button',name='Refresh models',exact=True).click()
    page.get_by_role('radio',name='OpenAI',exact=True).click()
    page.locator('#model-name').fill('manual/model')
    page.wait_for_timeout(3500)
    expect(page.locator('#model-name')).to_have_value('manual/model')
    expect(page.get_by_text('stale/model',exact=True)).to_have_count(0)
    page.evaluate("window.__QA__.modelDelay=0;window.__QA__.modelCatalog={models:['key/account-model'],source:'provider',status:'ok',message:'',truncated:false}")
    page.locator('#credential-OPENAI_API_KEY').fill('private-probe-api-key')
    expect(page.get_by_role('combobox',name='Available models',exact=True)).to_be_visible(timeout=10000)
    expect(page.locator('#model-name')).to_have_value('manual/model')
    assert page.evaluate('window.__QA__.modelQueries.at(-1).secrets.values') == [{'name':'OPENAI_API_KEY','value':'private-probe-api-key'}]
    assert 'private-probe-api-key' not in page.evaluate('JSON.stringify(localStorage)')
    page.get_by_role('radio',name='Русский',exact=True).click()
    expect(page.get_by_role('button',name=ru['Refresh models'],exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    accessible(page)
    assert not errors, errors
    browser.close()
    print('PASS: Live catalog selection, exact IDs, stale response isolation, preserved preparation drafts, Google OAuth, scoped apply, EN/RU, mobile and accessibility.')
