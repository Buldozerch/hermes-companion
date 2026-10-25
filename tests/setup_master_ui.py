"""Exercise the complete setup master with deterministic desktop IPC and no external writes."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:1420');parser.add_argument('--chromium',default=None);args=parser.parse_args()
ru=json.loads(Path('frontend/locales/ru.json').read_text());catalog=json.loads(Path('catalog/hermes-options.json').read_text())
core=[tool['id'] for tool in catalog['tools'] if tool['id'] not in ['tts','stt','image_gen','video_gen','x_search','computer_use','discord_admin','yuanbao']]
screenshots=Path('/tmp/hermes-companion-screenshots');screenshots.mkdir(exist_ok=True)
fixture=Path('tests/fixtures/desktop-mock.js').read_text()+"\nObject.assign(window.__QA__.workspace.servers[0].setup,"+json.dumps(dict(channels=['telegram'],tools=core+['tts','stt'],ttsProvider='edge',sttProvider='groq',searchBackend='ddgs',extractBackend='builtin',imageProvider='fal'))+");"

def language(page,locale):
 page.get_by_role('radio',name='English' if locale=='en' else ru['Russian'],exact=True).click()
 expect(page.locator('html')).to_have_attribute('lang',locale)

def accessible(page):
 page.add_script_tag(path='node_modules/axe-core/axe.min.js')
 violations=page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))")
 assert not violations,violations

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=args.chromium)
 page=browser.new_page(viewport={'width':1440,'height':1050});page.add_init_script(fixture);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url);page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='Connect to server',exact=True).click();page.get_by_label('Server password').fill('qa-ssh-password');page.get_by_role('button',name='Check connection',exact=True).click();page.get_by_role('button',name='Set up Hermes',exact=True).click()
 expect(page.get_by_role('heading',name='Install Hermes first',exact=True)).to_be_visible()
 expect(page.locator('#credential-TELEGRAM_BOT_TOKEN')).to_have_count(0);expect(page.locator('#credential-OPENROUTER_API_KEY')).to_have_count(0)
 language(page,'ru');accessible(page);language(page,'en')
 page.get_by_role('button',name='Install latest Hermes',exact=True).click();expect(page.get_by_role('progressbar')).to_be_visible()
 assert page.evaluate('window.__QA__.lastSecrets.values')==[]
 page.evaluate("Object.assign(window.__QA__.job,{state:'succeeded',step:'complete',installedVersion:'v9.8.7',serviceInstalled:true,serviceActive:true,apiHealthy:true,modelConfigured:false});window.__QA__.configuredCredentials=[];window.__QA__.workspace.servers[0].setup.tools="+json.dumps(core+['tts']))
 page.get_by_role('button',name='Continue to configuration',exact=True).click(timeout=15000)
 expect(page.get_by_text('No model connected yet',exact=True)).to_be_visible()
 page.get_by_role('radio',name='Channels',exact=True).click();page.get_by_role('switch',name='Telegram',exact=True).check()
 expect(page.get_by_role('link',name='Create a bot with @BotFather',exact=True)).to_have_attribute('href','https://t.me/BotFather')
 expect(page.get_by_role('link',name='Find my Telegram ID',exact=True)).to_have_attribute('href','https://t.me/userinfobot')
 page.get_by_role('button',name='Apply changes',exact=True).click();expect(page.locator('#credential-TELEGRAM_BOT_TOKEN')).to_have_attribute('aria-invalid','true')
 page.locator('#credential-TELEGRAM_BOT_TOKEN').fill('123456789:AA_fake_test_token_12345678901234567890');page.locator('#credential-TELEGRAM_ALLOWED_USERS').fill('123456789')
 language(page,'ru');expect(page.locator('#credential-TELEGRAM_ALLOWED_USERS')).to_have_value('123456789');accessible(page);language(page,'en')
 page.get_by_role('radio',name='Model and provider',exact=False).first.click()
 expect(page.get_by_role('radiogroup',name='Quick provider selection',exact=True).get_by_role('radio')).to_have_count(7)
 page.get_by_role('combobox',name='All model providers',exact=True).click();expect(page.get_by_role('listbox').get_by_role('option')).to_have_count(len(catalog['providers'])+len(catalog.get('additionalProviders',[]))+len(catalog['compatibleProviders']))
 page.get_by_role('combobox',name='Search all providers',exact=True).fill('hugging');page.get_by_role('option',name='Hugging Face',exact=True).click()
 expect(page.get_by_role('link',name='Get Hugging Face key',exact=True)).to_have_attribute('href','https://huggingface.co/settings/tokens')
 page.get_by_role('radio',name='Groq',exact=True).click();expect(page.locator('#model-base-url')).to_have_value('https://api.groq.com/openai/v1')
 page.get_by_role('radio',name='Custom OpenAI-compatible',exact=True).click();page.locator('#model-base-url').fill('http://localhost:8000/v1');page.locator('#model-name').fill('9router/qa-model')
 page.get_by_role('button',name='Apply changes',exact=True).click();expect(page.locator('#credential-COMPANION_CUSTOM_API_KEY')).to_have_attribute('aria-invalid','true')
 page.locator('#credential-COMPANION_CUSTOM_API_KEY').fill('qa-model-key');language(page,'ru');accessible(page);language(page,'en')
 page.get_by_role('radio',name='Services',exact=True).click()
 tts=page.get_by_role('group',name='Text-to-speech',exact=True)
 expect(tts.get_by_role('radio',name='Edge TTS Recommended',exact=True)).to_be_checked();expect(tts.locator('input[type=password]')).to_have_count(0)
 tts.get_by_role('radio',name='ElevenLabs',exact=True).click();page.locator('#credential-ELEVENLABS_API_KEY').fill('unused-eleven-key');tts.get_by_role('radio',name='Edge TTS Recommended',exact=True).click()
 page.get_by_role('switch',name='Speech-to-text',exact=True).check();page.get_by_role('button',name='Apply changes',exact=True).click();expect(page.locator('#credential-GROQ_API_KEY')).to_have_attribute('aria-invalid','true');page.locator('#credential-GROQ_API_KEY').fill('qa-groq-key')
 page.get_by_role('radio',name='Brave Search',exact=True).click();page.get_by_role('button',name='Apply changes',exact=True).click();expect(page.locator('#credential-BRAVE_SEARCH_API_KEY')).to_have_attribute('aria-invalid','true');page.locator('#credential-BRAVE_SEARCH_API_KEY').fill('qa-brave-key')
 page.get_by_role('radio',name='Firecrawl',exact=True).click();page.locator('#credential-FIRECRAWL_API_KEY').fill('unused-firecrawl-key');page.get_by_role('radio',name='Built-in parser Recommended',exact=False).click()
 page.get_by_role('switch',name='Image generation',exact=True).check();page.get_by_role('radio',name='Replicate',exact=True).click();page.locator('#credential-REPLICATE_API_TOKEN').fill('qa-replicate-key')
 language(page,'ru');accessible(page);page.set_viewport_size({'width':390,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');accessible(page);page.set_viewport_size({'width':1440,'height':1050});language(page,'en')
 page.get_by_role('radio',name='Agent tools',exact=True).click();expect(page.get_by_role('checkbox',name='Code Execution',exact=True)).to_be_checked();expect(page.get_by_role('checkbox',name='Terminal & Processes',exact=True)).to_be_checked()
 page.get_by_role('button',name='Apply changes',exact=True).click();expect(page.get_by_role('progressbar')).to_be_visible()
 assert page.evaluate('window.__QA__.installCalls')==1 and page.evaluate('window.__QA__.applyCalls')==1
 payload=page.evaluate('window.__QA__.lastSecrets');names={entry['name'] for entry in payload['values']}
 assert {'COMPANION_CUSTOM_API_KEY','GROQ_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_ALLOWED_USERS','BRAVE_SEARCH_API_KEY','REPLICATE_API_TOKEN'}<=names
 assert 'ELEVENLABS_API_KEY' not in names and 'FIRECRAWL_API_KEY' not in names
 assert 'qa-model-key' not in page.content();assert 'qa-model-key' not in page.evaluate('JSON.stringify(localStorage)')
 assert set(core)<=set(page.evaluate('window.__QA__.lastUpdate.setup.tools'))
 assert not errors,errors
 browser.close();print('PASS: credential-free initial installation, post-install Telegram/model/services, all providers, scoped keys, full core tools, EN/RU, mobile and accessibility.')
