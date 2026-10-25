"""Opt-in compatibility check against a real, separately checked-out Hermes release."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('HERMES_NATIVE_CHECKOUT'), 'Set HERMES_NATIVE_CHECKOUT to a trusted Hermes checkout.')
class NativeConfigurationTest(unittest.TestCase):
    def test_fresh_installer_template_and_native_writer_need_no_model_or_telegram_keys(self):
        with tempfile.TemporaryDirectory(prefix='companion-native-config-') as temporary:
            # A subprocess isolates Hermes module caches, profile paths and environment mutations.
            result = subprocess.run([sys.executable, __file__, '--native-profile', temporary],
                                    capture_output=True, text=True, env=os.environ.copy())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Native configuration write/read passed.', result.stdout)


def exercise_native_profile(directory):
    checkout = Path(os.environ['HERMES_NATIVE_CHECKOUT']).resolve()
    if not (checkout / 'hermes_cli/config.py').is_file():
        raise RuntimeError('The Hermes checkout is missing its native configuration module.')
    sys.path.insert(0, str(checkout))
    home = Path(directory)
    os.environ['HERMES_HOME'] = str(home / '.hermes')
    from hermes_cli import config
    from unittest.mock import patch
    namespace = runpy.run_path('tests/configuration_test.py')
    data = namespace['payload'](deferModelSetup=True, model='', searchBackend='ddgs',
                                extractBackend='builtin', tools=['terminal', 'file', 'memory', 'code_execution', 'browser', 'web', 'tts'])
    config.get_hermes_home().mkdir(parents=True, exist_ok=True)
    config.seed_config_file(config.get_config_path())
    with patch('pathlib.Path.home', return_value=home):
        response = namespace['configure'](data, namespace['catalog'], config,
                                          {'parser': '# isolated parser', 'replicate': '# isolated replicate'})
        snapshot = namespace['read_settings'](data['setup'], namespace['catalog'], config)
    raw = config.read_raw_config()
    assert response == {'modelConfigured': False}
    assert snapshot['setup']['deferModelSetup'] and not snapshot['modelConfigured']
    assert raw['model']['provider'] == '' and raw['model']['default'] == ''
    assert raw['platforms']['api_server']['enabled']
    assert not raw['platforms']['telegram']['enabled']
    assert not raw['gateway']['allow_all_users']
    assert raw['agent']['disabled_toolsets'] == sorted(set(item['id'] for item in namespace['catalog']['tools']) - {'stt'} - set(data['setup']['tools']))
    assert 'API_SERVER_KEY' in config.load_env()
    assert not config.load_env().get('OPENROUTER_API_KEY')
    assert not config.load_env().get('TELEGRAM_BOT_TOKEN')
    assert (home / '.hermes/plugins/web/web-companion-parser/plugin.yaml').is_file()
    assert 'API_SERVER_KEY' not in json.dumps(snapshot)
    # Check the resolved runtime, not only YAML: anonymous custom Responses is downgraded
    # by Hermes on foreign hosts, while named providers honor their explicit transport.
    from hermes_cli.runtime_provider import resolve_runtime_provider
    for mode in ['codex_responses', 'chat_completions', 'anthropic_messages']:
        data['setup'].update(deferModelSetup=False, provider='custom', model='gpt-6.1-sol',
                             baseUrl='https://gateway.example/v1', apiMode=mode)
        namespace['credentials'](data, COMPANION_CUSTOM_API_KEY='isolated-test-key')
        namespace['configure'](data, namespace['catalog'], config)
        raw = config.read_raw_config()
        name = raw['model']['provider']
        assert raw['providers'][name]['transport'] == mode
        with patch('socket.socket.connect', side_effect=RuntimeError('Unexpected network access during routing')):
            for arguments in [{}, {'requested': name}, {'requested': name, 'explicit_base_url': data['setup']['baseUrl'], 'explicit_api_key': 'isolated-test-key'}]:
                runtime = resolve_runtime_provider(**arguments)
                assert runtime['provider'] == 'custom'
                assert runtime['api_mode'] == mode
                assert runtime['base_url'] == data['setup']['baseUrl']
                assert runtime['api_key'] == 'isolated-test-key'
        snapshot = namespace['read_settings'](data['setup'], namespace['catalog'], config)
        assert snapshot['setup']['provider'] == 'custom' and snapshot['setup']['apiMode'] == mode
        assert not snapshot['modelTransportNeedsUpdate']
        assert snapshot['modelConfigured']
        assert 'isolated-test-key' not in json.dumps(raw) and 'isolated-test-key' not in json.dumps(snapshot)
    print('Native configuration write/read passed.')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--native-profile':
        exercise_native_profile(sys.argv[2])
    else:
        unittest.main()
