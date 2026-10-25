"""Keyless page extraction through Hermes' guarded HTTP transport."""

from html.parser import HTMLParser
import re

from agent.web_search_provider import WebSearchProvider


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ignored = 0
        self.title_depth = 0
        self.title = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'noscript', 'svg', 'template'}:
            self.ignored += 1
        if tag == 'title':
            self.title_depth += 1
        if tag in {'p', 'div', 'article', 'section', 'h1', 'h2', 'h3', 'li', 'br', 'tr'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'noscript', 'svg', 'template'}:
            self.ignored = max(0, self.ignored - 1)
        if tag == 'title':
            self.title_depth = max(0, self.title_depth - 1)

    def handle_data(self, text):
        if self.ignored:
            return
        if self.title_depth:
            self.title.append(text)
        else:
            self.parts.append(text)


class BuiltinParser(WebSearchProvider):
    name = 'companion-parser'
    display_name = 'Built-in parser'

    def is_available(self):
        return True

    def supports_search(self):
        return False

    def supports_extract(self):
        return True

    def get_setup_schema(self):
        return {'name': self.display_name, 'badge': 'free', 'tag': 'Static page text, no API key', 'env_vars': []}

    def extract(self, urls, **kwargs):
        from tools.url_safety import create_ssrf_safe_client, is_safe_url

        results = []
        limit = min(max(int(kwargs.get('max_chars') or 20000), 1), 100000)
        with create_ssrf_safe_client(timeout=20, follow_redirects=True, max_redirects=5) as client:
            for url in urls:
                try:
                    if not is_safe_url(url):
                        raise ValueError('URL blocked by the Hermes network policy.')
                    with client.stream('GET', url, headers={'User-Agent': 'Hermes-Companion-Parser/1.0'}) as response:
                        response.raise_for_status()
                        content_type = response.headers.get('content-type', '').lower()
                        if not any(kind in content_type for kind in ['text/', 'application/xhtml+xml', 'application/json']):
                            raise ValueError('The built-in parser supports text and HTML pages.')
                        data = bytearray()
                        for chunk in response.iter_bytes():
                            data.extend(chunk)
                            if len(data) > 2 * 1024 * 1024:
                                raise ValueError('The page exceeds the 2 MB parser limit.')
                        text = bytes(data).decode(response.encoding or 'utf-8', errors='replace')
                    parser = PageText()
                    parser.feed(text)
                    content = re.sub(r'[ \t]+', ' ', ''.join(parser.parts))
                    content = re.sub(r'\n\s*\n+', '\n\n', content).strip()[:limit]
                    title = ''.join(parser.title).strip()
                    results.append({'url': url, 'title': title, 'content': content, 'raw_content': content, 'metadata': {'sourceURL': url, 'title': title}})
                except Exception:
                    results.append({'url': url, 'title': '', 'content': '', 'error': 'Page extraction failed. Check the URL, network access and content format.'})
        return results


def register(ctx):
    ctx.register_web_search_provider(BuiltinParser())
