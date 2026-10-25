"""Exercise the configuration boundary without network requests or real credentials."""
import copy
import json
import runpy
import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path

helper = runpy.run_path('src/scripts/configure-user.py')
configure = helper['configure']
read_settings = helper['read_settings']
catalog = json.loads(Path('catalog/hermes-options.json').read_text())


class ConfigStore:
    def __init__(self, config=None, env=None):
        self.config = config or {}
        self.env = env or {}
        self.writes = 0

    def load_env(self):
        return self.env.copy()

    def read_raw_config(self):
        return copy.deepcopy(self.config)

    def save_env_value(self, name, value):
        self.env[name] = value
        self.writes += 1

    def save_config(self, config, **kwargs):
        self.config = copy.deepcopy(config)


def payload(**overrides):
    setup = dict(provider='openrouter', model='test-model', baseUrl='', apiMode='chat_completions',
                 channels=[], tools=['file', 'memory'], ttsProvider='edge', ttsVoice='', sttProvider='groq')
    setup.update(overrides)
    return {'setup': setup, 'secrets': {'values': []}}


def credentials(data, **values):
    data['secrets']['values'] = [{'name': name, 'value': value} for name, value in values.items()]


class ConfigurationTest(unittest.TestCase):
    def test_empty_native_yaml_sections_are_initialized_without_losing_other_options(self):
        # Hermes v0.22.5 seeds gateway: with comments only, which YAML reads as None.
        store = ConfigStore({name: None for name in ['gateway', 'platforms', 'agent', 'platform_toolsets', 'known_builtin_toolsets', 'tts', 'stt', 'web', 'image_gen']})
        store.config.update(model={'provider': 'auto', 'default': 'native-default'}, plugins={'enabled': None, 'clone_timeout_seconds': 300}, untouched=None)
        data = payload(deferModelSetup=True, model='', searchBackend='ddgs', extractBackend='builtin', tools=['terminal', 'file', 'memory', 'web', 'browser', 'tts'])
        with tempfile.TemporaryDirectory() as temporary, patch('pathlib.Path.home', return_value=Path(temporary)):
            configure(data, catalog, store, {'parser': '# parser', 'replicate': '# replicate'})
        self.assertFalse(store.config['gateway']['allow_all_users'])
        self.assertTrue(store.config['platforms']['api_server']['enabled'])
        self.assertEqual(store.config['plugins']['enabled'], ['web-companion-parser'])
        self.assertEqual(store.config['plugins']['clone_timeout_seconds'], 300)
        self.assertIsNone(store.config['untouched'])
        self.assertFalse(read_settings(data['setup'], catalog, store)['modelConfigured'])

    def test_reading_empty_native_sections_preserves_the_revision(self):
        store = ConfigStore({name: None for name in ['model', 'platforms', 'platform_toolsets', 'agent', 'tts', 'stt', 'web', 'image_gen']})
        before = copy.deepcopy(store.config)
        result = read_settings(payload(deferModelSetup=True, model='')['setup'], catalog, store)
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(result['revision'], helper['settings_revision'](before, {}))
        self.assertEqual(store.config, before)

    def test_diagnostic_reports_type_and_location_without_private_exception_content(self):
        try:
            raise TypeError('private-api-key-or-account-data')
        except TypeError as error:
            result = helper['configuration_error'](error)
        self.assertIn('TypeError', result['error'])
        self.assertNotIn('private-api-key', result['error'])

    def test_diagnostics_work_under_the_native_python_c_launcher_without_file(self):
        namespace = {'__name__': 'test_native_launcher'}
        exec(compile(Path('src/scripts/configure-user.py').read_text(), '<string>', 'exec'), namespace)
        try:
            exec(compile("raise TypeError('private-launcher-data')", '<string>', 'exec'), {})
        except TypeError as error:
            result = namespace['configuration_error'](error)
        self.assertIn('configure-user.py:1', result['error'])
        self.assertIn('TypeError', result['error'])
        self.assertNotIn('private-launcher-data', result['error'])

    def test_deferred_model_needs_no_fake_key_and_does_not_write_openrouter_defaults(self):
        store = ConfigStore({'provider': 'openrouter', 'model': {'provider': 'openrouter', 'default': 'anthropic/claude-sonnet-4.6', 'name': 'legacy-model'}})
        data = payload(deferModelSetup=True, model='')
        result = configure(data, catalog, store)
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(store.config['model']['provider'], '')
        self.assertEqual(store.config['model']['default'], '')
        self.assertNotIn('provider', store.config)
        self.assertNotIn('name', store.config['model'])
        self.assertNotIn('OPENROUTER_API_KEY', store.env)
        snapshot = read_settings(data['setup'], catalog, store)
        self.assertTrue(snapshot['setup']['deferModelSetup'])
        self.assertFalse(snapshot['modelConfigured'])
        self.assertEqual(snapshot['warnings'], [])

    def test_cli_model_selection_is_visible_after_deferred_installation(self):
        store = ConfigStore({'model': {'provider': 'anthropic', 'default': 'cli-model'}}, {'ANTHROPIC_API_KEY': 'private-key'})
        snapshot = read_settings(payload(deferModelSetup=True, model='')['setup'], catalog, store)
        self.assertFalse(snapshot['setup']['deferModelSetup'])
        self.assertEqual(snapshot['setup']['provider'], 'anthropic')
        self.assertEqual(snapshot['setup']['model'], 'cli-model')
        self.assertTrue(snapshot['modelConfigured'])

    def test_services_can_be_changed_while_model_connection_is_pending(self):
        store = ConfigStore()
        data = payload(deferModelSetup=True, model='', searchBackend='ddgs', extractBackend='builtin')
        configure(data, catalog, store)
        data.update(sections=['services', 'tools'], expectedRevision=helper['settings_revision'](store.config, store.env))
        data['setup']['tools'] = ['file', 'tts']
        result = configure(data, catalog, store)
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(store.config['model'], {'provider': '', 'default': ''})
        self.assertEqual(store.config['tts']['provider'], 'edge')
        self.assertNotIn('OPENROUTER_API_KEY', store.env)

    def test_model_can_be_connected_after_deferred_installation(self):
        store = ConfigStore()
        data = payload(deferModelSetup=True, model='')
        configure(data, catalog, store)
        data['setup'].update(deferModelSetup=False, model='chosen-model')
        data.update(sections=['model'], expectedRevision=helper['settings_revision'](store.config, store.env))
        credentials(data, OPENROUTER_API_KEY='private-real-key')
        result = configure(data, catalog, store)
        self.assertTrue(result['modelConfigured'])
        self.assertEqual(store.config['model']['default'], 'chosen-model')
        self.assertFalse(read_settings(data['setup'], catalog, store)['setup']['deferModelSetup'])

    def test_antigravity_installs_without_inventing_a_model_or_api_key(self):
        store = ConfigStore()
        data = payload(provider='antigravity-oauth', authMethod='oauth', model='')
        with patch.dict(configure.__globals__, {'provider_oauth_ready': lambda _provider: False}):
            result = configure(data, catalog, store)
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(store.config['model']['provider'], 'antigravity-oauth')
        self.assertEqual(store.config['model']['default'], '')
        self.assertNotIn('api_key', store.config['model'])

    def test_initial_oauth_selection_does_not_require_an_api_key(self):
        data = payload(provider='anthropic', authMethod='oauth', searchBackend='ddgs', extractBackend='builtin')
        store = ConfigStore()
        result = configure(data, catalog, store)
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(store.config['model']['provider'], 'anthropic')
        self.assertNotIn('api_key', store.config['model'])

    def test_managed_oauth_requires_native_authorization_before_writing(self):
        store = ConfigStore()
        data = self.managed(store, ['model'], provider='anthropic', authMethod='oauth')
        with self.assertRaisesRegex(ValueError, 'Authorize the selected provider'):
            configure(data, catalog, store)
        self.assertEqual(store.writes, 0)

    def test_oauth_clears_old_explicit_key_routing_and_snapshot_reports_the_account(self):
        store = ConfigStore({'model': {'provider': 'anthropic', 'default': 'old-model', 'api_key': '${ANTHROPIC_API_KEY}', 'key_env': 'ANTHROPIC_API_KEY'}}, {'ANTHROPIC_API_KEY': 'existing-private-key'})
        namespace = configure.__globals__
        with patch.dict(namespace, {'provider_oauth_ready': lambda name: name == 'anthropic'}):
            data = self.managed(store, ['model'], authMethod='oauth')
            configure(data, catalog, store)
            result = read_settings(data['setup'], catalog, store)
        self.assertNotIn('api_key', store.config['model'])
        self.assertNotIn('key_env', store.config['model'])
        self.assertEqual(result['setup']['authMethod'], 'oauth')
        self.assertIn('anthropic', result['authorizedProviders'])
        self.assertNotIn('existing-private-key', json.dumps(result))

    def managed(self, store, sections, **overrides):
        data = self.services()
        data['setup'].update(read_settings(data['setup'], catalog, store)['setup'])
        data['setup'].update(overrides)
        data['sections'] = sections
        data['expectedRevision'] = helper['settings_revision'](store.config, store.env)
        credentials(data)
        return data

    def test_snapshot_uses_server_configuration_without_returning_secret_values(self):
        store = ConfigStore({'model': {'provider': 'deepseek', 'default': 'server-model'},
                             'platforms': {'telegram': {'enabled': True}}, 'stt': {'enabled': False},
                             'platform_toolsets': {'api_server': ['file', 'memory']}},
                            {'DEEPSEEK_API_KEY': 'private-model-key', 'TELEGRAM_BOT_TOKEN': 'private-bot-token',
                             'UNRELATED_SECRET': 'private-unrelated'})
        result = read_settings(self.services()['setup'], catalog, store)
        self.assertEqual(result['setup']['model'], 'server-model')
        self.assertEqual(result['setup']['tools'], ['file', 'memory'])
        self.assertEqual(result['setup']['channels'], ['telegram'])
        self.assertIn('DEEPSEEK_API_KEY', result['configuredCredentials'])
        self.assertNotIn('UNRELATED_SECRET', result['configuredCredentials'])
        self.assertNotIn('private-', json.dumps(result))

    def test_tools_only_changes_preserve_model_channels_and_services_even_without_their_keys(self):
        original = {'max_live_sessions': 7, 'model': {'provider': 'openrouter', 'default': 'cli-model', 'private_option': 'keep'},
                    'tts': {'provider': 'elevenlabs', 'elevenlabs': {'voice_id': 'cli-voice'}},
                    'stt': {'enabled': True, 'provider': 'groq'}, 'platforms': {'telegram': {'enabled': True}},
                    'platform_toolsets': {'api_server': ['file', 'memory', 'user_plugin']},
                    'web': {'search_backend': 'brave-free', 'extract_backend': 'firecrawl'}}
        store = ConfigStore(copy.deepcopy(original))
        data = self.managed(store, ['tools'], tools=['file', 'stt'])
        configure(data, catalog, store)
        for section in ['model', 'tts', 'web']:
            self.assertEqual(store.config[section], original[section])
        self.assertEqual(store.config['max_live_sessions'], 7)
        self.assertTrue(store.config['platforms']['telegram']['enabled'])
        self.assertEqual(store.config['platform_toolsets']['api_server'], ['file', 'user_plugin'])

    def test_model_change_preserves_channel_tokens_and_cli_service_settings(self):
        store = ConfigStore({'model': {'provider': 'openrouter', 'default': 'old-model'},
                             'tts': {'provider': 'elevenlabs'}, 'web': {'extract_backend': 'native-plugin'},
                             'platforms': {'telegram': {'enabled': True}}}, {'OPENROUTER_API_KEY': 'existing-key'})
        data = self.managed(store, ['model'], model='new-model')
        configure(data, catalog, store)
        self.assertEqual(store.config['model']['default'], 'new-model')
        self.assertEqual(store.config['web']['extract_backend'], 'native-plugin')
        self.assertEqual(store.config['tts']['provider'], 'elevenlabs')
        self.assertTrue(store.config['platforms']['telegram']['enabled'])

    def test_enabling_a_paid_service_requires_its_key_before_any_writes(self):
        store = ConfigStore({'model': {'provider': 'openrouter', 'default': 'old-model'},
                             'platform_toolsets': {'api_server': ['file']}, 'stt': {'enabled': False}})
        data = self.managed(store, ['tools'], tools=['file', 'stt'])
        with self.assertRaises(ValueError): configure(data, catalog, store)
        self.assertEqual(store.writes, 0)

    def test_concurrent_cli_changes_are_rejected_before_any_writes(self):
        store = ConfigStore()
        data = self.managed(store, ['tools'], tools=['file'])
        store.config['external_change'] = True
        with self.assertRaisesRegex(ValueError, 'server settings changed'): configure(data, catalog, store)
        self.assertEqual(store.writes, 0)

    def test_native_inline_key_is_migrated_privately_when_changing_model(self):
        store = ConfigStore({'model': {'provider': 'openai-api', 'default': 'old-model', 'api_key': 'inline-private-key'}})
        data = self.managed(store, ['model'], model='new-model')
        configure(data, catalog, store)
        self.assertEqual(store.env['OPENAI_API_KEY'], 'inline-private-key')
        self.assertNotIn('inline-private-key', json.dumps(store.config))

    def test_custom_inline_key_stays_scoped_to_the_current_endpoint(self):
        store = ConfigStore({'model': {'provider': 'custom', 'default': 'old-model', 'base_url': 'http://localhost:8000/v1', 'api_key': 'inline-private-key'}})
        result = read_settings(self.services()['setup'], catalog, store)
        self.assertIn('COMPANION_CUSTOM_API_KEY', result['configuredCredentials'])
        data = self.managed(store, ['model'], model='new-model')
        configure(data, catalog, store)
        self.assertTrue(store.config['model']['api_key'].startswith('${HERMES_CUSTOM_'))
        data = self.managed(store, ['model'], baseUrl='http://localhost:9000/v1')
        with self.assertRaises(ValueError): configure(data, catalog, store)

    def services(self, **overrides):
        data=payload(provider='custom',baseUrl='http://localhost:8000/v1',allowUnauthenticatedModel=True,
                     searchBackend='ddgs',extractBackend='builtin',imageProvider='fal',tools=['terminal','file','code_execution','memory','web','tts','stt'])
        data['setup'].update(overrides)
        credentials(data,GROQ_API_KEY='test-groq')
        return data

    def test_keyless_services_and_full_core_tools_are_written_with_explicit_backends(self):
        data=self.services();store=ConfigStore()
        with tempfile.TemporaryDirectory() as temporary, patch('pathlib.Path.home',return_value=Path(temporary)):
            configure(data,catalog,store,{'parser':'# parser source','replicate':'# replica source'})
            self.assertEqual(store.config['web'],{'search_backend':'ddgs','extract_backend':'companion-parser'})
            self.assertEqual(store.config['tts']['provider'],'edge')
            self.assertEqual(store.config['stt'],{'enabled':True,'provider':'groq'})
            self.assertEqual(store.config['platform_toolsets']['api_server'],sorted(['terminal','file','code_execution','memory','web','tts']))
            self.assertTrue((Path(temporary)/'.hermes/plugins/web/web-companion-parser/__init__.py').exists())
            self.assertIn('web-companion-parser',store.config['plugins']['enabled'])

    def test_missing_model_or_selected_service_key_fails_before_writing_any_credentials(self):
        for options in [dict(provider='openrouter'),dict(searchBackend='brave-free'),dict(extractBackend='firecrawl'),dict(tools=['image_gen'],imageProvider='replicate')]:
            data=self.services(**options);store=ConfigStore()
            with self.assertRaises(ValueError):configure(data,catalog,store)
            self.assertEqual(store.writes,0)

    def test_paid_service_selections_are_applied_without_inline_keys(self):
        data=self.services(searchBackend='brave-free',extractBackend='firecrawl',tools=['web','image_gen'],imageProvider='replicate')
        credentials(data,BRAVE_SEARCH_API_KEY='test-brave',FIRECRAWL_API_KEY='test-firecrawl',REPLICATE_API_TOKEN='test-replicate')
        store=ConfigStore()
        with tempfile.TemporaryDirectory() as temporary, patch('pathlib.Path.home',return_value=Path(temporary)):
            configure(data,catalog,store,{'parser':'# parser source','replicate':'# replica source'})
        self.assertEqual(store.config['web'],{'search_backend':'brave-free','extract_backend':'firecrawl'})
        self.assertEqual(store.config['image_gen']['provider'],'replicate')
        self.assertNotIn('test-replicate',json.dumps(store.config))

    def test_compatible_groq_model_and_transcription_share_one_private_key(self):
        data=self.services(providerPreset='groq',allowUnauthenticatedModel=False,baseUrl='https://api.groq.com/openai/v1')
        store=ConfigStore();configure(data,catalog,store)
        reference=store.config['model']['api_key']
        self.assertTrue(reference.startswith('${HERMES_CUSTOM_'))
        self.assertEqual(store.env[reference[2:-1]],'test-groq')
        self.assertEqual(store.env['GROQ_API_KEY'],'test-groq')

    def test_malformed_telegram_ownership_data_cannot_be_applied(self):
        data=payload(channels=['telegram']);credentials(data,TELEGRAM_BOT_TOKEN='123456789:AA_test_token_12345678901234567890',TELEGRAM_ALLOWED_USERS='@username');store=ConfigStore()
        with self.assertRaises(ValueError):configure(data,catalog,store)
        self.assertEqual(store.writes,0)

    def test_public_channel_requires_credentials_and_an_allowlist_before_any_writes(self):
        data = payload(channels=['discord'])
        for values in [{}, {'DISCORD_BOT_TOKEN': 'test-only'}]:
            credentials(data, **values)
            store = ConfigStore()
            with self.assertRaises(ValueError):
                configure(data, catalog, store)
            self.assertEqual(store.writes, 0)

    def test_channel_choices_and_tool_restrictions_are_enforced(self):
        data = payload(channels=['discord'], tools=['file', 'stt'])
        credentials(data, DISCORD_BOT_TOKEN='test-only', DISCORD_ALLOWED_USERS='123456')
        store = ConfigStore()
        configure(data, catalog, store)
        self.assertTrue(store.config['platforms']['discord']['enabled'])
        self.assertFalse(store.config['platforms']['telegram']['enabled'])
        self.assertEqual(store.config['platform_toolsets']['discord'], ['file'])
        self.assertIn('browser', store.config['agent']['disabled_toolsets'])
        self.assertTrue(store.config['stt']['enabled'])
        self.assertEqual(store.env['DISCORD_ALLOW_ALL_USERS'], 'false')

    def test_blank_fields_preserve_existing_secrets_and_unknown_user_settings(self):
        data = payload(channels=['telegram'])
        credentials(data, TELEGRAM_BOT_TOKEN='', TELEGRAM_ALLOWED_USERS='')
        store = ConfigStore({'user_extension': {'keep': True}},
                            {'TELEGRAM_BOT_TOKEN': '123456789:AA_test_token_12345678901234567890', 'TELEGRAM_ALLOWED_USERS': '123456', 'API_SERVER_KEY': 'existing-api-key'})
        configure(data, catalog, store)
        self.assertEqual(store.env['TELEGRAM_BOT_TOKEN'], '123456789:AA_test_token_12345678901234567890')
        self.assertEqual(store.env['API_SERVER_KEY'], 'existing-api-key')
        self.assertEqual(store.config['user_extension'], {'keep': True})

    def test_provider_switch_drops_endpoint_and_secret_routing_from_the_old_provider(self):
        store = ConfigStore({'model': {'provider': 'custom', 'base_url': 'https://old.example',
                                      'api_key': '${OLD_KEY}', 'key_env': 'OLD_KEY', 'api_mode': 'anthropic_messages'}})
        configure(payload(provider='openai-api'), catalog, store)
        self.assertEqual(store.config['model'], {'provider': 'openai-api', 'default': 'test-model'})

    def test_selected_account_token_has_an_explicit_pointer_over_an_existing_api_key(self):
        data = payload(provider='anthropic', credentialEnv='ANTHROPIC_TOKEN')
        store = ConfigStore(env={'ANTHROPIC_API_KEY': 'old-test-key', 'ANTHROPIC_TOKEN': 'selected-test-token'})
        configure(data, catalog, store)
        self.assertEqual(store.config['model']['key_env'], 'ANTHROPIC_TOKEN')
        self.assertNotIn('selected-test-token', json.dumps(store.config))

    def test_custom_endpoint_secrets_are_referenced_and_scoped_to_the_endpoint(self):
        data = payload(provider='custom', baseUrl='http://127.0.0.1:11434/v1', apiMode='codex_responses')
        credentials(data, COMPANION_CUSTOM_API_KEY="test-'quoted-secret")
        store = ConfigStore()
        configure(data, catalog, store)
        reference = store.config['model']['api_key']
        self.assertTrue(reference.startswith('${HERMES_CUSTOM_'))
        self.assertNotIn('quoted-secret', json.dumps(store.config))
        self.assertEqual(store.config['model']['api_mode'], 'codex_responses')
        credentials(data)
        configure(data, catalog, store)
        self.assertEqual(store.config['model']['api_key'], reference)
        data['setup']['baseUrl'] = 'https://another.example/v1'
        configure(data, catalog, store)
        self.assertNotIn('api_key', store.config['model'])

    def test_custom_protocol_uses_a_named_transport_and_round_trips_to_the_gui(self):
        data = payload(provider='custom', baseUrl='https://gateway.example/v1', model='gpt-6.1-sol', apiMode='codex_responses')
        credentials(data, COMPANION_CUSTOM_API_KEY='private-custom-key')
        store = ConfigStore({'providers': {'unrelated': {'base_url': 'https://other.example/v1', 'transport': 'anthropic_messages'}}})
        configure(data, catalog, store)
        name = store.config['model']['provider']
        self.assertTrue(name.startswith('companion-custom-'))
        route = store.config['providers'][name]
        self.assertEqual(route['transport'], 'codex_responses')
        self.assertEqual(store.env[route['key_env']], 'private-custom-key')
        self.assertNotIn('private-custom-key', json.dumps(store.config))
        snapshot = read_settings(data['setup'], catalog, store)
        self.assertEqual(snapshot['setup']['provider'], 'custom')
        self.assertEqual(snapshot['setup']['apiMode'], 'codex_responses')
        self.assertFalse(snapshot['modelTransportNeedsUpdate'])
        self.assertEqual(snapshot['warnings'], [])
        self.assertTrue(snapshot['modelConfigured'])
        self.assertEqual(store.config['providers']['unrelated']['transport'], 'anthropic_messages')
        store.config['providers'][name]['api_mode'] = 'anthropic_messages'
        store.config['model']['openai_runtime'] = 'codex_app_server'
        data['setup']['apiMode'] = 'chat_completions'
        credentials(data)
        configure(data, catalog, store)
        self.assertEqual(store.config['providers'][name]['transport'], 'chat_completions')
        self.assertNotIn('api_mode', store.config['providers'][name])
        self.assertNotIn('openai_runtime', store.config['model'])

    def test_editing_tools_preserves_the_named_custom_route_and_its_transport(self):
        data = payload(provider='custom', baseUrl='https://gateway.example/v1', model='gpt-6-astra', apiMode='codex_responses')
        credentials(data, COMPANION_CUSTOM_API_KEY='private-custom-key')
        store = ConfigStore()
        configure(data, catalog, store)
        route = copy.deepcopy(store.config['providers'])
        data['sections'] = ['tools']
        data['expectedRevision'] = helper['settings_revision'](store.config, store.env)
        data['setup']['tools'] = ['file']
        credentials(data)
        configure(data, catalog, store)
        self.assertEqual(store.config['providers'], route)
        self.assertEqual(read_settings(data['setup'], catalog, store)['setup']['apiMode'], 'codex_responses')

    def test_existing_anonymous_responses_connection_can_be_repaired_without_new_values(self):
        store = ConfigStore({'model': {'provider': 'custom', 'default': 'gpt-6.1-sol', 'base_url': 'https://gateway.example/v1', 'api_mode': 'codex_responses', 'api_key': 'private-inline-key'}})
        data = payload(provider='custom', baseUrl='https://gateway.example/v1', model='gpt-6.1-sol', apiMode='codex_responses')
        snapshot = read_settings(data['setup'], catalog, store)
        self.assertTrue(snapshot['modelTransportNeedsUpdate'])
        self.assertIn('COMPANION_CUSTOM_API_KEY', snapshot['configuredCredentials'])
        data.update(setup=snapshot['setup'], sections=['model'], expectedRevision=snapshot['revision'])
        credentials(data)
        configure(data, catalog, store)
        repaired = read_settings(data['setup'], catalog, store)
        self.assertFalse(repaired['modelTransportNeedsUpdate'])
        self.assertTrue(repaired['modelConfigured'])
        self.assertEqual(repaired['setup']['model'], 'gpt-6.1-sol')
        self.assertEqual(repaired['setup']['baseUrl'], 'https://gateway.example/v1')
        self.assertNotIn('private-inline-key', json.dumps(store.config))
        route = store.config['providers'][store.config['model']['provider']]
        self.assertEqual(store.env[route['key_env']], 'private-inline-key')

    def test_voice_choices_apply_and_disabled_transcription_stays_disabled(self):
        data = payload(tools=['tts'], ttsProvider='elevenlabs', ttsVoice='voice-id', sttProvider='mistral')
        store = ConfigStore()
        configure(data, catalog, store)
        self.assertEqual(store.config['tts']['elevenlabs']['voice_id'], 'voice-id')
        self.assertFalse(store.config['stt']['enabled'])
        self.assertEqual(store.config['stt']['provider'], 'mistral')
        self.assertEqual(store.config['platforms']['api_server']['host'], '127.0.0.1')


if __name__ == '__main__':
    unittest.main()
