"""Run against npm run dev. Credentials must never enter browser persistence."""

import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:1420")
parser.add_argument("--chromium", default=None)
parser.add_argument("--screenshots", default="/tmp/hermes-companion-screenshots")
args = parser.parse_args()
screenshots = Path(args.screenshots)
screenshots.mkdir(parents=True, exist_ok=True)
errors = []
ru = json.loads(Path("frontend/locales/ru.json").read_text())


def language(page, locale):
    page.get_by_role("radio", name="English" if locale == "en" else ru["Russian"], exact=True).click()
    expect(page.locator("html")).to_have_attribute("lang", locale)


def accessible(page):
    page.add_script_tag(path="node_modules/axe-core/axe.min.js")
    violations = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>n.target)}))")
    assert not violations, violations

with sync_playwright() as p:
    options = {"headless": True}
    if args.chromium:
        options["executable_path"] = args.chromium
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Manage Hermes", exact=True)).to_be_visible()
    page.screenshot(path=str(screenshots / "overview.png"), full_page=True, animations="disabled")
    page.add_script_tag(path="node_modules/axe-core/axe.min.js")
    accessibility = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v => ({id:v.id, impact:v.impact, nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))")
    print({"accessibility": accessibility})
    expect(page.get_by_role("link",name="Author: @buldozercode")).to_have_attribute("href","https://t.me/buldozercode")
    expect(page.locator("html")).to_have_attribute("lang", "en")
    language(page, "ru")
    expect(page.get_by_role("heading", name=ru["Manage Hermes"], exact=True)).to_be_visible()
    expect(page.get_by_role("link", name=ru["Author: @buldozercode"])).to_be_visible()
    accessible(page)
    page.screenshot(path=str(screenshots / "overview-ru.png"), full_page=True, animations="disabled")
    page.reload()
    expect(page.locator("html")).to_have_attribute("lang", "ru")
    language(page, "en")

    page.get_by_role("button", name="Set up Hermes", exact=True).click()
    expect(page.get_by_role("heading",name="Buy a server for Hermes",exact=True)).to_be_visible()
    expect(page.locator("#server-host")).to_have_count(0)
    assert page.locator(".hosting-provider a").evaluate_all("links=>links.map(link=>link.href)") == ["https://www.vdsina.com/?partner=62n73usqa1jp","https://hip.hosting/?code=9f78107d10447a5f9b47"]
    expect(page.get_by_text("At least 4 GB RAM",exact=True)).to_be_visible()
    accessible(page)
    page.screenshot(path=str(screenshots / "purchase.png"),full_page=True,animations="disabled")
    language(page, "ru")
    expect(page.get_by_role("heading", name=ru["Buy a server for Hermes"], exact=True)).to_be_visible()
    expect(page.get_by_text(ru["At least 4 GB RAM"], exact=True)).to_be_visible()
    accessible(page)
    page.screenshot(path=str(screenshots / "purchase-ru.png"), full_page=True, animations="disabled")
    language(page, "en")
    page.get_by_role("button",name="I already have a server",exact=True).click()
    expect(page.get_by_role("heading",name="Add your server",exact=True)).to_be_visible()
    page.get_by_role("button",name="Back to hosting providers",exact=True).click()
    expect(page.get_by_role("heading",name="Buy a server for Hermes",exact=True)).to_be_visible()
    page.get_by_role("button",name="I bought a server",exact=True).click()
    expect(page.get_by_role("heading", name="Add your server")).to_be_visible()
    page.get_by_role("button", name="Continue", exact=True).click()
    expect(page.get_by_text("Enter the server IP address", exact=True)).to_be_visible()
    page.get_by_label("IP address or domain").fill("https://example.com")
    page.get_by_role("button", name="Continue", exact=True).click()
    expect(page.get_by_text("Enter an IP address or domain without https:// or spaces")).to_be_visible()
    language(page, "ru")
    expect(page.get_by_text(ru["Enter an IP address or domain without https:// or spaces"])).to_be_visible()
    expect(page.locator("#server-host")).to_have_value("https://example.com")
    language(page, "en")
    page.get_by_label("IP address or domain").fill("203.0.113.10")
    page.get_by_label("Server name").fill("Test Hermes")
    page.screenshot(path=str(screenshots / "server-form.png"), full_page=True, animations="disabled")
    page.get_by_role("button", name="Continue", exact=True).click()
    expect(page.get_by_role("heading", name="Connect to your server")).to_be_visible()
    page.get_by_label("Server password").fill("qa-secret-never-persist")
    page.get_by_role("button", name="Check connection", exact=True).click()
    expect(page.get_by_text("Could not connect", exact=True)).to_be_visible()
    language(page, "ru")
    expect(page.get_by_text(ru["Could not connect"], exact=True)).to_be_visible()
    expect(page.locator("#ssh-password")).to_have_value("qa-secret-never-persist")
    language(page, "en")
    assert "qa-secret-never-persist" not in page.evaluate("JSON.stringify(localStorage)")
    page.get_by_role("radio", name="SSH key", exact=True).click()
    expect(page.get_by_label("Private SSH key")).to_be_visible()
    page.screenshot(path=str(screenshots / "connection.png"), full_page=True, animations="disabled")

    page.get_by_role("button", name="Hermes settings", exact=True).click()
    expect(page.get_by_role("heading",name="Make Hermes yours",exact=True)).to_be_visible()
    page.get_by_role("radio",name="Agent brain",exact=True).click()
    page.get_by_role("radio",name="Custom OpenAI-compatible",exact=True).click()
    page.locator('#model-base-url').fill('http://127.0.0.1:11434/v1')
    page.locator('#model-name').fill('provider/my-model')
    page.locator('#credential-COMPANION_CUSTOM_API_KEY').fill('qa-provider-secret')
    language(page,'ru');expect(page.locator('#model-name')).to_have_value('provider/my-model');accessible(page)
    language(page,'en');page.get_by_role('button',name='Save draft',exact=True).click()
    expect(page.get_by_text('Settings draft saved',exact=True)).to_be_visible()
    assert 'qa-provider-secret' not in page.evaluate('JSON.stringify(localStorage)')
    page.reload();page.wait_for_load_state('networkidle');page.get_by_role('button',name='Hermes settings',exact=True).click();page.get_by_role('radio',name='Agent brain',exact=True).click()
    expect(page.locator('#model-name')).to_have_value('provider/my-model');expect(page.locator('#credential-COMPANION_CUSTOM_API_KEY')).to_have_value('')
    language(page,'ru');page.screenshot(path=str(screenshots/'model-ru.png'),full_page=True,animations='disabled');language(page,'en')

    page.get_by_role("button",name="My servers",exact=False).click()
    page.get_by_role("button",name="Connect to server",exact=True).click()
    expect(page.get_by_role("heading",name="Connect to your server",exact=True)).to_be_visible()
    expect(page.get_by_role("heading",name="Buy a server for Hermes",exact=True)).to_have_count(0)

    page.get_by_role("button", name="Activity log", exact=True).click()
    expect(page.get_by_role("heading", name="Server draft added")).to_be_visible()
    language(page, "ru")
    expect(page.get_by_role("heading", name="Server draft added")).to_be_visible()
    expect(page.locator(".activity-detail h3")).to_have_attribute("lang", "en")
    workspace = page.evaluate("JSON.parse(localStorage.getItem('hermes-companion.preview.v1'))")
    assert workspace["activity"][0]["title"] == "Server draft added"
    assert workspace["activity"][0]["detail"] == "The profile was saved in the browser preview. No SSH connection has been made."
    diagnostic = "SSH authentication failed: permission denied (publickey)."
    workspace["activity"].insert(0, {"id": "qa-error", "serverId": None, "title": "Connection failed", "detail": diagnostic, "level": "error", "createdAt": 1770000000})
    workspace["activity"].insert(0, {"id": "qa-legacy", "serverId": None, "title": ru["Connection checked"], "detail": ru["Connection settings were saved on this device."], "level": "info", "createdAt": 1770000000})
    page.evaluate("workspace => localStorage.setItem('hermes-companion.preview.v1', JSON.stringify(workspace))", workspace)
    page.reload()
    expect(page.locator("html")).to_have_attribute("lang", "ru")
    page.get_by_role("button", name=ru["Activity log"], exact=True).click()
    expect(page.get_by_text(diagnostic, exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Connection checked", exact=True)).to_be_visible()
    assert not any(0x0400 <= ord(char) <= 0x04ff for char in page.locator(".activity-detail").all_text_contents()[0])
    accessible(page)
    language(page, "en")
    page.get_by_role("button", name="My servers", exact=False).click()
    page.get_by_role("button", name="Remove profile", exact=True).click()
    expect(page.get_by_role("dialog")).to_be_visible()
    page.get_by_role("button", name="Cancel", exact=True).click()
    expect(page.get_by_role("heading", name="Test Hermes", exact=True)).to_be_visible()
    page.get_by_role("button", name="Remove profile", exact=True).click()
    page.get_by_role("dialog").get_by_role("button", name="Remove profile", exact=True).click()
    expect(page.get_by_role("heading", name="Your servers will appear here")).to_be_visible()

    mobile = browser.new_page(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    mobile.on("pageerror", lambda error: errors.append(str(error)))
    mobile.goto(args.url)
    mobile.wait_for_load_state("networkidle")
    assert not mobile.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile layout overflows"
    mobile.screenshot(path=str(screenshots / "mobile.png"), full_page=True, animations="disabled")
    language(mobile, "ru")
    expect(mobile.locator(".language-switcher")).to_be_visible()
    assert not mobile.evaluate("document.documentElement.scrollWidth > innerWidth"), "Russian mobile layout overflows"
    accessible(mobile)
    mobile.screenshot(path=str(screenshots / "mobile-ru.png"), full_page=True, animations="disabled")
    mobile.get_by_role("button", name=ru["Open menu"]).click()
    mobile.get_by_role("button", name=ru["Activity log"], exact=True).click()
    expect(mobile.get_by_role("heading", name=ru["Start with your first server"])).to_be_visible()
    assert not errors, errors
    assert not accessibility, accessibility
    browser.close()
    print("PASS: EN/RU switching, language persistence, live validation translation, form and credential retention, English activity/errors, legacy events, purchase-first onboarding, provider links, settings persistence, deletion, mobile navigation, accessibility")
