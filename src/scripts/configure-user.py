"""Merge Companion choices using the installed Hermes configuration writer, as hermes."""

import json
import hashlib
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlsplit


def config_section(config, name, *, create=False):
    """Native templates use empty YAML sections (None) to inherit defaults."""
    value = config.get(name)
    if value is None:
        value = {}
        if create:
            config[name] = value
    if not isinstance(value, dict):
        raise ValueError('A configuration section must contain a YAML mapping.')
    return value


def configuration_error(error):
    """Report a useful location without exception messages, source text or locals."""
    kind = type(error).__name__ if type(error).__module__ == 'builtins' else 'ConfigurationError'
    line = None
    source = globals().get('__file__', '<string>')
    trace = error.__traceback__
    while trace:
        if trace.tb_frame.f_code.co_filename in {source, '<string>'}:
            line = trace.tb_lineno
        trace = trace.tb_next
    location = f'; configure-user.py:{line}' if line is not None else ''
    return {'error': f'The installed Hermes configuration writer failed ({kind}{location}). No secret values were logged.'}


def combined_catalog(catalog):
    return {**catalog, 'providers': catalog['providers'] + [item for item in catalog.get('additionalProviders', []) if item['id'] not in {row['id'] for row in catalog['providers']} ]}


def antigravity_prepared():
    try:
        from providers import get_provider_profile
        return bool(get_provider_profile('antigravity-oauth') and os.access(Path.home() / '.local/bin/agy', os.X_OK))
    except Exception:
        return False


def settings_revision(config, env):
    # Only the digest crosses SSH. Environment values remain on the server.
    return hashlib.sha256(json.dumps([config, env], sort_keys=True, default=str).encode()).hexdigest()


def provider_oauth_ready(provider):
    """Return presence only; native pool entries and refresh credentials never leave the VPS."""
    try:
        if provider == 'antigravity-oauth':
            import importlib
            from providers import get_provider_profile
            profile = get_provider_profile(provider)
            if not profile:
                return False
            module = importlib.import_module(profile.__class__.__module__)
            process = importlib.import_module('.process', package=module.__package__ or module.__name__)
            return bool(process.is_authenticated())
        if provider in {'anthropic', 'openrouter'}:
            from agent.credential_pool import load_pool
            for entry in load_pool(provider).entries():
                source = str(entry.source or '')
                matching = entry.auth_type == 'oauth' if provider == 'anthropic' else source.startswith('manual:openrouter_pkce')
                if matching and entry.access_token:
                    return True
            return False
        from hermes_cli import auth
        function = {'nous': 'get_nous_auth_status_local', 'openai-codex': 'get_codex_auth_status',
                    'minimax-oauth': 'get_minimax_oauth_auth_status', 'xai-oauth': 'get_xai_oauth_auth_status',
                    'qwen-oauth': 'get_qwen_auth_status'}.get(provider)
        return bool(function and getattr(auth, function)().get('logged_in'))
    except Exception:
        return False


def read_settings(fallback, catalog, config_api):
    catalog = combined_catalog(catalog)
    config = config_api.read_raw_config()
    env = config_api.load_env()
    setup = dict(fallback)
    warnings = []
    model = config.get('model') or {}
    if isinstance(model, str):
        model = {'default': model}
    setup['deferModelSetup'] = (model.get('provider') == '' and not model.get('default')) or (not model and fallback.get('deferModelSetup', False))
    provider = model.get('provider', setup['provider'])
    provider = 'openrouter' if provider == 'openai' else provider
    if setup['deferModelSetup']:
        pass
    elif provider not in {item['id'] for item in catalog['providers']}:
        warnings.append('The server model provider is outside this catalog. It is preserved unless you edit the model section.')
    else:
        setup['provider'] = provider
    setup['model'] = str(model.get('default', setup['model']))
    base_url = str(model.get('base_url') or '')
    parsed = urlsplit(base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('The server model URL contains private parameters. Remove them through Hermes CLI before editing settings.')
    setup['baseUrl'] = base_url
    setup['apiMode'] = model.get('api_mode') or 'chat_completions'
    native_provider = next(item for item in catalog['providers'] if item['id'] == setup['provider'])
    key_env = model.get('key_env') or model.get('api_key_env') or ''
    setup['credentialEnv'] = key_env if key_env in native_provider['keyVars'] else ''
    authorized = [name for name in ['anthropic', 'openrouter', 'nous', 'openai-codex', 'minimax-oauth', 'xai-oauth', 'qwen-oauth', 'antigravity-oauth'] if provider_oauth_ready(name)]
    primary_oauth = setup['provider'] in {'nous', 'openai-codex', 'minimax-oauth', 'xai-oauth', 'qwen-oauth', 'antigravity-oauth'}
    explicit_key = bool(model.get('api_key') or key_env)
    setup['authMethod'] = 'oauth' if primary_oauth or (not explicit_key and (setup['provider'] in authorized or (fallback.get('provider') == setup['provider'] and fallback.get('authMethod') == 'oauth'))) else 'api_key'
    setup['providerPreset'] = ''
    if setup['provider'] == 'custom':
        preset = next((item for item in catalog.get('compatibleProviders', []) if item['baseUrl'].rstrip('/') == base_url.rstrip('/')), None)
        if preset:
            setup['providerPreset'] = preset['id']
    configured = {name for name, value in env.items() if value and str(value).strip()}
    custom_key = 'HERMES_CUSTOM_' + hashlib.sha256(base_url.encode()).hexdigest()[:16].upper() + '_API_KEY'
    api_key = str(model.get('api_key') or '')
    key_present = bool(env.get(custom_key))
    if api_key.startswith('${') and api_key.endswith('}'):
        key_present = key_present or bool(env.get(api_key[2:-1]))
    elif api_key:
        key_present = True
    if setup['provider'] == 'custom' and key_present:
        configured.add('COMPANION_CUSTOM_API_KEY')
    setup['allowUnauthenticatedModel'] = setup['provider'] == 'custom' and not key_present
    if api_key and (not api_key.startswith('${') or env.get(api_key[2:-1])) and setup['provider'] != 'custom' and native_provider['keyVars']:
        configured.add(setup['credentialEnv'] or native_provider['keyVars'][0])
    if (Path.home() / '.qwen/oauth_creds.json').is_file():
        configured.add('QWEN_AUTH_JSON')
    if env.get('GOOGLE_APPLICATION_CREDENTIALS'):
        configured.add('GOOGLE_SERVICE_ACCOUNT_JSON')
    channels = config_section(config, 'platforms')
    setup['channels'] = [item['id'] for item in catalog['channels'] if config_section(channels, item['id']).get('enabled', False)]
    setup['telegram'] = 'telegram' in setup['channels']
    known_tools = {item['id'] for item in catalog['tools']} - {'stt'}
    toolsets = config_section(config, 'platform_toolsets')
    selected = toolsets.get('api_server', toolsets.get('cli', list(known_tools)))
    if not isinstance(selected, list):
        selected = list(known_tools)
    disabled = set(config_section(config, 'agent').get('disabled_toolsets') or [])
    setup['tools'] = sorted((set(selected) & known_tools) - disabled)
    stt = config_section(config, 'stt')
    if stt.get('enabled', True):
        setup['tools'].append('stt')
    setup['browser'] = 'browser' in setup['tools']
    tts = config_section(config, 'tts')
    for key, value, options in [
        ('ttsProvider', tts.get('provider', 'edge'), catalog['ttsProviders']),
        ('sttProvider', stt.get('provider', 'groq'), catalog['sttProviders']),
    ]:
        if value in {item['id'] for item in options}:
            setup[key] = value
        else:
            warnings.append('A voice provider is outside this catalog. It is preserved unless you edit services.')
    voice = config_section(tts, setup['ttsProvider'])
    setup['ttsVoice'] = str(voice.get('voice_id', voice.get('voice', '')))
    web = config_section(config, 'web')
    for key, value, options in [
        ('searchBackend', web.get('search_backend', 'ddgs'), {'ddgs', 'brave-free'}),
        ('extractBackend', web.get('extract_backend', 'builtin'), {'builtin', 'companion-parser', 'firecrawl'}),
        ('imageProvider', config_section(config, 'image_gen').get('provider', 'fal'), {'fal', 'replicate', 'openai'}),
    ]:
        if value in options:
            setup[key] = 'builtin' if value == 'companion-parser' else value
        else:
            warnings.append('A service backend is outside this catalog. It is preserved unless you edit services.')
    moa = config.get('moa')
    if isinstance(moa, dict):
        def clean_slot(slot):
            return {key: slot[key] for key in ['provider', 'model', 'enabled'] if key in slot}
        setup['moaConfig'] = json.dumps({
            'aggregator': clean_slot(moa.get('aggregator', {})),
            'reference_models': [clean_slot(slot) for slot in moa.get('reference_models', [])],
        })
    # Do not expose arbitrary environment names, private endpoint hashes or account values.
    allowed = {name for item in catalog['providers'] for name in item['keyVars']}
    allowed |= {field['name'] for item in catalog['channels'] for field in item['fields']}
    allowed |= {item['keyVar'] for group in ['ttsProviders', 'sttProviders'] for item in catalog[group] if item.get('keyVar')}
    allowed |= {'COMPANION_CUSTOM_API_KEY', 'BRAVE_SEARCH_API_KEY', 'FIRECRAWL_API_KEY', 'FAL_KEY', 'REPLICATE_API_TOKEN', 'TOGETHER_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'QWEN_AUTH_JSON', 'COPILOT_GITHUB_TOKEN'}
    ready = any(name in configured for name in native_provider['keyVars'])
    if setup['provider'] in {'custom', 'lmstudio'}:
        ready = key_present or setup['allowUnauthenticatedModel'] or setup['provider'] == 'lmstudio'
    if setup['authMethod'] == 'oauth':
        ready = setup['provider'] in authorized
    return {'setup': setup, 'configuredCredentials': sorted(configured & allowed), 'modelConfigured': not setup['deferModelSetup'] and ready and bool(setup['model'].strip()),
            'authorizedProviders': authorized, 'preparedProviders': ['antigravity-oauth'] if antigravity_prepared() else [], 'revision': settings_revision(config, env), 'warnings': sorted(set(warnings))}


def write_account_json(target, document):
    write_account_text(target, json.dumps(document))


def write_account_text(target, content):
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = '.companion-' + secrets.token_hex(12)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target.name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def configure(payload, catalog, config_api, plugin_sources=None):
    catalog = combined_catalog(catalog)
    setup = payload['setup']
    deferred = setup.get('deferModelSetup', False)
    sections = set(payload.get('sections', ['model', 'channels', 'services', 'tools']))
    existing = config_api.load_env()
    config = config_api.read_raw_config()
    if payload.get('expectedRevision') and payload['expectedRevision'] != settings_revision(config, existing):
        raise ValueError('The server settings changed. Reload them before applying your changes.')
    previous = read_settings(setup, catalog, config_api)['setup'] if payload.get('sections') else None
    def service_changed(tool, *fields):
        return previous is None or (tool in setup['tools'] and tool not in previous['tools']) or any(setup.get(key) != previous.get(key) for key in fields)
    supplied = {entry['name']: entry['value'] for entry in payload['secrets'].get('values', []) if entry['value']}
    provider = next(item for item in catalog['providers'] if item['id'] == setup['provider'])
    preset = next((item for item in catalog.get('compatibleProviders', []) if item['id'] == setup.get('providerPreset')), None)
    custom_key = 'HERMES_CUSTOM_' + hashlib.sha256(setup.get('baseUrl', '').encode()).hexdigest()[:16].upper() + '_API_KEY'
    if not deferred and supplied.get('COMPANION_CUSTOM_API_KEY'):
        supplied[custom_key] = supplied.pop('COMPANION_CUSTOM_API_KEY')
    if not deferred and preset and preset['keyVar'] and supplied.get(preset['keyVar']):
        supplied[custom_key] = supplied[preset['keyVar']]
    legacy = payload['secrets']
    if not deferred and legacy.get('apiKey') and provider['keyVars']:
        supplied[provider['keyVars'][0]] = legacy['apiKey']
    for field, name in [('telegramToken', 'TELEGRAM_BOT_TOKEN'), ('telegramAllowedUsers', 'TELEGRAM_ALLOWED_USERS')]:
        if legacy.get(field):
            supplied[name] = legacy[field]
    merged_env = {**existing, **supplied}
    old_model = config.get('model', {})
    if not deferred and 'model' in sections and isinstance(old_model, dict) and old_model.get('provider') == provider['id']:
        old_key = str(old_model.get('api_key') or '')
        old_value = merged_env.get(old_key[2:-1], '') if old_key.startswith('${') and old_key.endswith('}') else old_key
        target = custom_key if provider['id'] == 'custom' and old_model.get('base_url') == setup.get('baseUrl') else (setup.get('credentialEnv') or next(iter(provider['keyVars']), ''))
        if target and old_value and not merged_env.get(target):
            supplied[target] = old_value
            merged_env[target] = old_value
    if not deferred and preset and preset['keyVar'] and merged_env.get(preset['keyVar']):
        merged_env[custom_key] = merged_env[preset['keyVar']]
        supplied[custom_key] = merged_env[custom_key]
    required_keys = []
    xai_voice_account = not deferred and setup['provider'] == 'xai-oauth'
    if not xai_voice_account and ('xai' in {setup.get('ttsProvider'), setup.get('sttProvider')}) and not merged_env.get('XAI_API_KEY'):
        try:
            from hermes_cli.auth import get_xai_oauth_auth_status
            xai_voice_account = bool(get_xai_oauth_auth_status().get('logged_in'))
        except Exception:
            pass
    oauth = not deferred and setup.get('authMethod') == 'oauth'
    if 'model' in sections and oauth and provider['id'] != 'qwen-oauth' and payload.get('sections') and not provider_oauth_ready(provider['id']):
        raise ValueError('Authorize the selected provider before applying these model settings.')
    if not deferred and 'model' in sections and provider['authType'] == 'api_key' and not oauth:
        if provider['id'] == 'custom':
            if not setup.get('allowUnauthenticatedModel'):
                required_keys.append(([custom_key], 'model API key'))
        elif provider['id'] != 'lmstudio':
            required_keys.append((provider['keyVars'], 'model API key'))
    if 'stt' in setup['tools'] and service_changed('stt', 'sttProvider'):
        option = next(item for item in catalog['sttProviders'] if item['id'] == setup['sttProvider'])
        if option.get('keyVar') and not (option['keyVar'] == 'XAI_API_KEY' and xai_voice_account):
            required_keys.append(([option['keyVar'], 'OPENAI_API_KEY'] if option['keyVar'] == 'VOICE_TOOLS_OPENAI_KEY' else [option['keyVar']], 'speech recognition API key'))
    if 'tts' in setup['tools'] and service_changed('tts', 'ttsProvider'):
        option = next(item for item in catalog['ttsProviders'] if item['id'] == setup['ttsProvider'])
        if option.get('keyVar') and not (option['keyVar'] == 'XAI_API_KEY' and xai_voice_account):
            required_keys.append(([option['keyVar'], 'OPENAI_API_KEY'] if option['keyVar'] == 'VOICE_TOOLS_OPENAI_KEY' else [option['keyVar']], 'speech synthesis API key'))
    if 'web' in setup['tools'] and setup.get('searchBackend') == 'brave-free' and service_changed('web', 'searchBackend'):
        required_keys.append((['BRAVE_SEARCH_API_KEY'], 'Brave Search API key'))
    if 'web' in setup['tools'] and setup.get('extractBackend') == 'firecrawl' and service_changed('web', 'extractBackend'):
        required_keys.append((['FIRECRAWL_API_KEY'], 'Firecrawl API key'))
    if 'image_gen' in setup['tools'] and service_changed('image_gen', 'imageProvider'):
        required_keys.append(([{'fal': 'FAL_KEY', 'replicate': 'REPLICATE_API_TOKEN', 'openai': 'OPENAI_API_KEY'}[setup.get('imageProvider', 'fal')]], 'image generation API key'))
    # Older draft payloads predate mandatory model credentials; new service payloads are strict.
    if 'searchBackend' in setup:
        for names, label in required_keys:
            if not any(merged_env.get(name, '').strip() for name in names):
                raise ValueError('Missing required connection setting: ' + label)
    selected_channels = set(setup['channels'])
    if 'channels' in sections and 'telegram' in selected_channels:
        import re
        if not re.fullmatch(r'\d+:[A-Za-z0-9_-]{20,}', merged_env.get('TELEGRAM_BOT_TOKEN', '')):
            raise ValueError('Missing required connection setting: valid Telegram bot token')
        if not re.fullmatch(r'\d+(?:\s*,\s*\d+)*', merged_env.get('TELEGRAM_ALLOWED_USERS', '')):
            raise ValueError('Missing required connection setting: numeric Telegram user ID')
    for channel in catalog['channels']:
        if 'channels' not in sections or channel['id'] not in selected_channels:
            continue
        for field in channel['fields']:
            if field['required'] and not merged_env.get(field['name']):
                raise ValueError('Missing required connection setting: ' + field['name'])
        # Public messengers must have an explicit allowlist; Companion never enables open access.
        allowlists = [field['name'] for field in channel['fields'] if field['name'].endswith('ALLOWED_USERS')]
        if allowlists and not any(merged_env.get(name, '').strip() for name in allowlists):
            raise ValueError('Set an allowed-user list before enabling channel: ' + channel['id'])

    for name, target in [('QWEN_AUTH_JSON', Path.home() / '.qwen/oauth_creds.json'),
                         ('GOOGLE_SERVICE_ACCOUNT_JSON', Path.home() / '.hermes/companion-google-account.json')]:
        if name in supplied:
            document = json.loads(supplied.pop(name))
            if not isinstance(document, dict):
                raise ValueError('The account file must contain a JSON object.')
            write_account_json(target, document)
            if name == 'GOOGLE_SERVICE_ACCOUNT_JSON':
                supplied['GOOGLE_APPLICATION_CREDENTIALS'] = str(target)

    supplied.update(API_SERVER_HOST='127.0.0.1', API_SERVER_PORT='8642', GATEWAY_ALLOW_ALL_USERS='false')
    if not existing.get('API_SERVER_KEY'):
        supplied['API_SERVER_KEY'] = secrets.token_urlsafe(32)
    for channel in catalog['channels']:
        supplied[channel['id'].upper().replace('-', '_') + '_ALLOW_ALL_USERS'] = 'false'
        for field in channel['fields']:
            if field['name'].endswith('_ALLOWED_USERS'):
                supplied[field['name'].removesuffix('_ALLOWED_USERS') + '_ALLOW_ALL_USERS'] = 'false'
    for name, value in supplied.items():
        config_api.save_env_value(name, value)

    if 'model' in sections:
        if isinstance(config.get('model'), str):
            config['model'] = {'default': config['model']}
        model = config_section(config, 'model', create=True)
        for name in ['base_url', 'api_mode', 'api_key', 'key_env', 'api_key_env']:
            model.pop(name, None)
        if deferred:
            # Native canonicalization must not restore a skipped provider from legacy aliases.
            for name in ['model', 'name', 'api_base', 'api']:
                model.pop(name, None)
            for name in ['provider', 'base_url', 'api_base']:
                config.pop(name, None)
        model.update(provider='' if deferred else provider['id'], default='' if deferred else setup['model'])
        if not deferred and not oauth and setup.get('credentialEnv') in provider['keyVars']:
            model['key_env'] = setup['credentialEnv']
        if not deferred and not oauth and provider['id'] in {'anthropic', 'openrouter'}:
            key_name = setup.get('credentialEnv') or next(iter(provider['keyVars']), '')
            if key_name and merged_env.get(key_name):
                model['api_key'] = '${' + key_name + '}'
        if not deferred and setup.get('baseUrl'):
            model['base_url'] = setup['baseUrl']
        if not deferred and provider['id'] in {'custom', 'lmstudio', 'azure-foundry'}:
            model['api_mode'] = setup['apiMode']
        if not deferred and provider['id'] == 'custom' and merged_env.get(custom_key):
            model['api_key'] = '${' + custom_key + '}'
    config_section(config, 'gateway', create=True)['allow_all_users'] = False
    if not payload.get('sections'):
        config['max_live_sessions'] = 2
    platforms = config_section(config, 'platforms', create=True)
    if 'channels' in sections:
        for channel in catalog['channels']:
            config_section(platforms, channel['id'], create=True)['enabled'] = channel['id'] in selected_channels
    config_section(platforms, 'api_server', create=True).update(enabled=True, host='127.0.0.1', port=8642)
    if 'tools' in sections or 'channels' in sections:
        all_tools = {item['id'] for item in catalog['tools']} - {'stt'}
        selected_tools = set(setup['tools']) - {'stt'}
        previous_disabled = set(config_section(config, 'agent', create=True).get('disabled_toolsets') or [])
        config['agent']['disabled_toolsets'] = sorted((previous_disabled - all_tools) | (all_tools - selected_tools))
        for platform in ['cli', 'api_server', *selected_channels]:
            existing_tools = config_section(config, 'platform_toolsets', create=True).get(platform, [])
            unknown_tools = set(existing_tools) - all_tools if isinstance(existing_tools, list) else set()
            config['platform_toolsets'][platform] = sorted(selected_tools | unknown_tools)
            config_section(config, 'known_builtin_toolsets', create=True)[platform] = sorted(all_tools)
    if 'services' in sections:
        tts = config_section(config, 'tts', create=True)
        tts['provider'] = 'openai' if setup['ttsProvider'] == 'nous' else setup['ttsProvider']
        config_section(tts, tts['provider'], create=True)
        voice_key = 'voice_id' if tts['provider'] in {'elevenlabs', 'xai', 'minimax', 'mistral'} else 'voice'
        if setup.get('ttsVoice'):
            tts[tts['provider']][voice_key] = setup['ttsVoice']
        else:
            tts[tts['provider']].pop(voice_key, None)
        if setup['ttsProvider'] == 'nous':
            from hermes_cli.nous_subscription import apply_gateway_defaults
            apply_gateway_defaults(config, ['tts'])
        config_section(config, 'stt', create=True).update(enabled='stt' in setup['tools'], provider=setup['sttProvider'])
        if setup.get('searchBackend'):
            config_section(config, 'web', create=True)['search_backend'] = setup['searchBackend']
        if setup.get('extractBackend'):
            config_section(config, 'web', create=True)['extract_backend'] = 'companion-parser' if setup['extractBackend'] == 'builtin' else setup['extractBackend']
        if 'image_gen' in setup['tools']:
            config_section(config, 'image_gen', create=True)['provider'] = setup.get('imageProvider', 'fal')
    if 'tools' in sections:
        config_section(config, 'stt', create=True)['enabled'] = 'stt' in setup['tools']
    if plugin_sources and ('services' in sections or 'tools' in sections):
        plugins = config_section(config, 'plugins', create=True)
        if plugins.get('enabled') is None:
            plugins['enabled'] = []
        enabled = plugins['enabled']
        if not isinstance(enabled, list):
            raise ValueError('The plugins enabled setting must contain a YAML list.')
        for kind, name, key, needed in [
            ('web', 'web-companion-parser', 'parser', setup.get('extractBackend') == 'builtin'),
            ('image_gen', 'companion-replicate', 'replicate', 'image_gen' in setup['tools'] and setup.get('imageProvider') == 'replicate'),
        ]:
            if not needed:
                continue
            directory = Path.home() / '.hermes/plugins' / kind / name
            write_account_text(directory / '__init__.py', plugin_sources[key])
            manifest = 'name: ' + name + '\nversion: 1.0.0\nkind: backend\ndescription: Hermes Companion service backend\nauthor: buldozercode\n'
            if kind == 'web':
                manifest += 'provides_web_providers:\n  - companion-parser\n'
            write_account_text(directory / 'plugin.yaml', manifest)
            if name not in enabled:
                enabled.append(name)
    if not deferred and 'model' in sections and provider['id'] == 'moa' and setup.get('moaConfig'):
        from hermes_cli.moa_config import normalize_moa_config, validate_moa_payload
        moa = json.loads(setup['moaConfig'])
        if validate_moa_payload(moa):
            raise ValueError('The Mixture of Agents preset is invalid.')
        config['moa'] = normalize_moa_config(moa)
    config_api.save_config(config, strip_defaults=False)
    # A configured credential is distinct from a successful inference request.
    ready = any(merged_env.get(name) for name in provider['keyVars'])
    ready = ready or (provider['id'] == 'custom' and bool(merged_env.get(custom_key) or setup.get('allowUnauthenticatedModel'))) or provider['id'] == 'lmstudio'
    if oauth or provider['id'] in {'nous', 'openai-codex', 'minimax-oauth', 'xai-oauth', 'qwen-oauth'}:
        ready = provider_oauth_ready(provider['id'])
    if provider['id'] == 'bedrock':
        ready = bool(merged_env.get('AWS_ACCESS_KEY_ID') and merged_env.get('AWS_SECRET_ACCESS_KEY'))
    if provider['id'] == 'vertex':
        ready = bool(merged_env.get('GOOGLE_APPLICATION_CREDENTIALS') or supplied.get('GOOGLE_APPLICATION_CREDENTIALS'))
    if provider['id'] == 'copilot-acp':
        ready = bool(merged_env.get('COPILOT_GITHUB_TOKEN'))
    return {'modelConfigured': not deferred and ready and bool(setup['model'].strip())}


if __name__ == '__main__':
    try:
        from hermes_cli import config as config_api
        data = json.load(sys.stdin)
        if data.get('action') == 'read':
            print(json.dumps(read_settings(data['setup'], data['catalog'], config_api)))
        else:
            print(json.dumps(configure(data['payload'], data['catalog'], config_api, data.get('pluginSources'))))
    except ValueError as error:
        # Validation messages contain setting names, never their values.
        if str(error).startswith(('Missing required connection setting:', 'Set an allowed-user list', 'The account file', 'The Mixture', 'The server settings changed.', 'The server model URL', 'Authorize the selected provider')):
            print(json.dumps({'error': str(error)}))
        else:
            print(json.dumps({'error': 'Invalid configuration or account file.'}))
        sys.exit(1)
    except Exception as error:
        print(json.dumps(configuration_error(error)))
        sys.exit(1)
