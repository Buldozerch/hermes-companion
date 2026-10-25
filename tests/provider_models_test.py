"""Test model metadata probes, credential isolation and hostile HTTP responses."""
import json
import runpy
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

helper = runpy.run_path('src/scripts/provider-models.py')


class ModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                cls.requests.append((self.path, dict(self.headers)))
                status, document = 200, {'data': [{'id': 'Case-Sensitive'}, {'id': 'second'}, {'id': 'Case-Sensitive'}]}
                if self.path.startswith('/unauthorized'):
                    status, document = 401, {'error': 'private-api-key'}
                elif self.path.startswith('/redirect'):
                    self.send_response(302)
                    self.send_header('Location', '/stolen')
                    self.end_headers()
                    return
                elif self.path == '/fallback/models':
                    status = 404
                elif self.path.startswith('/gemini'):
                    document = {'models': [{'name': 'models/Gemini-Live', 'supportedGenerationMethods': ['generateContent']}, {'name': 'models/embedding', 'supportedGenerationMethods': ['embedContent']}]}
                elif self.path.startswith('/empty'):
                    document = {'data': []}
                elif self.path.startswith('/invalid'):
                    document = {'not_models': []}
                self.send_response(status)
                self.end_headers()
                self.wfile.write(json.dumps(document).encode())
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def probe(self, path='', provider='custom', mode='chat_completions'):
        return helper['http_models'](self.base + path, 'private-api-key', provider, mode)

    def test_ids_preserve_case_and_order_without_duplicates(self):
        self.assertEqual(self.probe()['models'], ['Case-Sensitive', 'second'])
        self.assertEqual(self.requests[-1][1]['Authorization'], 'Bearer private-api-key')

    def test_alternate_v1_endpoint_is_tried_after_404(self):
        self.assertEqual(self.probe('/fallback')['status'], 'ok')
        self.assertEqual(self.requests[-1][0], '/fallback/v1/models')

    def test_anthropic_headers_and_version(self):
        self.probe('/anthropic', 'anthropic')
        path, headers = self.requests[-1]
        self.assertEqual(path, '/anthropic/v1/models')
        self.assertEqual(headers['X-Api-Key'], 'private-api-key')
        self.assertNotIn('Authorization', headers)

    def test_google_models_are_filtered_to_generation(self):
        self.assertEqual(self.probe('/gemini', 'gemini')['models'], ['Gemini-Live'])
        self.assertEqual(self.requests[-1][1]['X-Goog-Api-Key'], 'private-api-key')

    def test_errors_do_not_echo_private_response_bodies(self):
        result = self.probe('/unauthorized')
        self.assertEqual(result['status'], 'unauthorized')
        self.assertNotIn('private-api-key', json.dumps(result))

    def test_redirects_never_forward_credentials(self):
        start = len(self.requests)
        self.assertEqual(self.probe('/redirect')['status'], 'unavailable')
        self.assertEqual([path for path, _ in self.requests[start:]], ['/redirect/models'])

    def test_successful_empty_and_invalid_catalogs_are_distinct(self):
        self.assertEqual(self.probe('/empty')['status'], 'empty')
        self.assertEqual(self.probe('/invalid')['status'], 'unavailable')

    def test_credential_urls_are_rejected_before_network(self):
        result = helper['http_models']('https://user:pass@example.com', 'private-api-key', 'custom', '')
        self.assertEqual(result['status'], 'unavailable')

    def test_echoed_keys_control_characters_and_overflow_are_filtered(self):
        result = helper['catalog_result'](['private-api-key', 'bad\nmodel'] + ['model-' + str(i) for i in range(1100)], key='private-api-key')
        self.assertEqual(len(result['models']), 1000)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['models'][0], 'model-0')

    def test_custom_endpoint_change_does_not_reuse_unrelated_credentials(self):
        key = helper['resolve_key']({'provider':'custom', 'baseUrl':'http://new/v1'}, {'keyVars':[]}, None, {},
                                    {'OPENAI_API_KEY':'private-api-key'}, {'model':{'provider':'custom','base_url':'http://old/v1','api_key':'${OPENAI_API_KEY}'}})
        self.assertEqual(key, '')

    def test_native_endpoint_override_does_not_reuse_saved_explicit_key(self):
        key = helper['resolve_key']({'provider':'openai-api','baseUrl':'http://new/v1'}, {'keyVars':['OPENAI_API_KEY']}, None, {},
                                    {'OPENAI_API_KEY':'private-api-key'}, {'model':{'provider':'openai-api','base_url':'http://old/v1','api_key':'${OPENAI_API_KEY}'}})
        self.assertEqual(key, '')


if __name__ == '__main__':
    unittest.main()
