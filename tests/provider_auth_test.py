"""Verify callback validation, private transport and cancellation without contacting providers."""
import builtins
import io
import json
import logging
import os
from pathlib import Path
import runpy
import stat
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

helper = runpy.run_path('src/scripts/provider-auth-cli.py')
STATE = 'state-for-this-session-123456789'
URL = 'https://claude.ai/oauth/authorize?code_challenge=public-challenge&state=' + STATE


class ProviderAuthTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.patch = patch('pathlib.Path.home', return_value=self.home)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.session = 'a' * 32
        self.directory = self.home / '.hermes/companion-oauth' / self.session
        self.directory.mkdir(mode=0o700, parents=True)
        self.state = dict(provider='anthropic', session_id=self.session, flow='paste_code', status='pending',
                          verification_url=URL, expires_at=time.time() + 900, expires_in=900, poll_interval=2)
        helper['write_json'](self.directory / 'state.json', self.state)

    def request(self, action, **values):
        return helper['control'](dict(provider='anthropic', session=self.session, action=action, **values))

    def test_accepts_full_callback_or_code_with_matching_state(self):
        code = 'private-code#' + STATE
        self.assertEqual(helper['normalized_code']('anthropic', code, URL), code)
        self.assertEqual(helper['normalized_code']('anthropic', 'https://console.anthropic.com/oauth/code/callback?code=private-code&state=' + STATE, URL), code)

    def test_rejects_mismatched_state_wrong_hosts_and_duplicate_parameters(self):
        for value in ['private-code#other-state', 'https://attacker.example/oauth/code/callback?code=private-code&state=' + STATE,
                      'https://console.anthropic.com/other?code=private-code&state=' + STATE,
                      'https://console.anthropic.com/oauth/code/callback?code=one&code=two&state=' + STATE,
                      'https://console.anthropic.com:private-code/oauth/code/callback?code=private-code&state=' + STATE]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as caught:
                    helper['normalized_code']('anthropic', value, URL)
                self.assertNotIn('private-code', str(caught.exception))

    def test_submission_is_private_single_use_and_not_returned(self):
        result = self.request('submit', code='private-code#' + STATE)
        self.assertEqual(result['status'], 'exchanging')
        self.assertNotIn('private-code', json.dumps(result))
        self.assertEqual(stat.S_IMODE((self.directory / 'input.json').stat().st_mode), 0o600)
        self.assertEqual(helper['wait_for_code'](self.directory), 'private-code#' + STATE)
        self.assertFalse((self.directory / 'input.json').exists())
        with self.assertRaises(ValueError): self.request('submit', code='private-code#' + STATE)

    def test_provider_binding_prevents_submitting_to_another_provider(self):
        with self.assertRaises(ValueError):
            helper['control'](dict(provider='openrouter', session=self.session, action='submit', code='private-code'))
        self.assertFalse((self.directory / 'input.json').exists())

    def test_cancellation_removes_queued_code_and_expiry_rejects_submission(self):
        self.request('submit', code='private-code#' + STATE)
        self.assertEqual(self.request('cancel')['status'], 'cancelled')
        self.assertFalse((self.directory / 'input.json').exists())
        self.state.update(expires_at=time.time() - 1)
        helper['write_json'](self.directory / 'state.json', self.state)
        with self.assertRaises(ValueError): self.request('submit', code='private-code#' + STATE)

    def test_untrusted_private_file_symlinks_are_rejected(self):
        path = self.directory / 'untrusted.json'
        path.symlink_to(self.directory / 'state.json')
        with self.assertRaises(OSError): helper['read_json'](path)

    def test_expiration_removes_a_queued_callback(self):
        self.request('submit', code='private-code#' + STATE)
        self.state.update(status='exchanging', expires_at=time.time() - 1)
        helper['write_json'](self.directory / 'state.json', self.state)
        self.assertEqual(self.request('poll')['status'], 'expired')
        self.assertFalse((self.directory / 'input.json').exists())

    def test_native_worker_does_not_persist_a_grant_cancelled_during_exchange(self):
        entered = threading.Event()
        release = threading.Event()
        persisted = []
        module = types.ModuleType('agent.anthropic_credentials')
        def login():
            entered.set()
            release.wait(timeout=5)
            return {'access_token': 'private-access-token', 'refresh_token': 'private-refresh-token'}
        module.run_hermes_oauth_login_pure = login
        import webbrowser
        namespace = helper['worker'].__globals__
        with patch.dict(sys.modules, {'agent': types.ModuleType('agent'), 'agent.anthropic_credentials': module}), \
             patch.dict(namespace, {'persist_native_credential': lambda *values: persisted.append(values)}), \
             patch.object(builtins, 'input', builtins.input), patch.object(webbrowser, 'open', webbrowser.open), patch.object(logging, 'disable', lambda *_args: None):
            thread = threading.Thread(target=helper['worker'], args=(self.directory,))
            thread.start()
            self.assertTrue(entered.wait(timeout=3))
            self.request('cancel')
            release.set()
            thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(persisted)
        self.assertEqual(self.request('poll')['status'], 'cancelled')

    def test_openrouter_plain_codes_are_accepted_without_fetching_a_url(self):
        self.assertEqual(helper['normalized_code']('openrouter', 'router-code-123456', 'https://openrouter.ai/auth'), 'router-code-123456')
        with self.assertRaises(ValueError): helper['normalized_code']('openrouter', 'http://127.0.0.1/?code=router-code-123456', '')

    def test_google_code_and_exact_loopback_callback(self):
        url = 'https://accounts.google.com/o/oauth2/auth?redirect_uri=http%3A%2F%2Flocalhost%3A8085%2Fcallback&state=google-state'
        code = '4/private-google-code'
        self.assertEqual(helper['normalized_code']('antigravity-oauth', code, url), code)
        self.assertEqual(helper['normalized_code']('antigravity-oauth', 'http://localhost:8085/callback?code=4%2Fprivate-google-code&state=google-state', url), code)
        for callback in ['http://localhost:8086/callback?code=private-code&state=google-state', 'http://attacker.example:8085/callback?code=private-code&state=google-state', 'http://localhost:8085/callback?code=private-code&state=wrong']:
            with self.assertRaises(ValueError): helper['normalized_code']('antigravity-oauth', callback, url)

    def test_google_pty_polls_code_even_when_the_cli_is_silent(self):
        launcher = self.home / '.local/bin/hermes'
        launcher.parent.mkdir(parents=True)
        launcher.write_text('#!/usr/bin/env python3\nimport sys\nprint("https://accounts.google.com/o/oauth2/auth?state=test", flush=True)\nraise SystemExit(0 if sys.stdin.readline().strip() == "4/private-code" else 1)\n')
        launcher.chmod(0o700)
        self.state.update(provider='antigravity-oauth', status='starting')
        helper['write_json'](self.directory / 'state.json', self.state)
        outcome = []
        def drive():
            try:
                helper['run_antigravity_login'](self.directory)
                outcome.append('approved')
            except BaseException as error:
                outcome.append(type(error).__name__)
        thread = threading.Thread(target=drive)
        thread.start()
        for _ in range(100):
            if helper['read_json'](self.directory / 'state.json')['status'] == 'pending':
                break
            time.sleep(0.02)
        else:
            self.fail('The Google prompt was not relayed.')
        helper['control'](dict(provider='antigravity-oauth', session=self.session, action='submit', code='4/private-code'))
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome, ['approved'])
        self.assertFalse((self.directory / 'input.json').exists())
        self.assertNotIn('private-code', (self.directory / 'state.json').read_text())


if __name__ == '__main__':
    unittest.main()
