"""Read model metadata only. Probe credentials stay in memory and never enter the config."""
import contextlib
import hashlib
import io
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

MAX_BYTES = 2 * 1024 * 1024
MAX_MODELS = 1000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def catalog_result(models=None, *, source='provider', status='ok', message='', key=''):
    result = []
    seen = set()
    for model in models or []:
        if not isinstance(model, str) or not model.strip() or len(model) > 200 or any(ord(char) < 32 for char in model):
            continue
        if key and key in model:
            continue
        if model not in seen:
            result.append(model)
            seen.add(model)
    return {'models': result[:MAX_MODELS], 'source': source, 'status': 'empty' if status == 'ok' and not result else status,
            'message': message, 'truncated': len(result) > MAX_MODELS}


def read_env():
    try:
        from hermes_cli import config
        return config.load_env(), config.read_raw_config()
    except ImportError:
        return {}, {}


def resolve_key(setup, provider, preset, supplied, existing, config):
    if setup['provider'] == 'custom':
        name = 'HERMES_CUSTOM_' + hashlib.sha256(setup.get('baseUrl', '').encode()).hexdigest()[:16].upper() + '_API_KEY'
        direct = supplied.get('COMPANION_CUSTOM_API_KEY', '')
        if preset and preset.get('keyVar'):
            direct = direct or supplied.get(preset['keyVar'], '')
        if direct:
            return direct
        key = existing.get(name, '')
        if preset and preset.get('keyVar') and setup.get('baseUrl', '').rstrip('/') == preset['baseUrl'].rstrip('/'):
            key = key or existing.get(preset['keyVar'], '')
        current = config.get('model', {})
        if isinstance(current, dict) and current.get('provider') == 'custom' and current.get('base_url') == setup.get('baseUrl'):
            reference = str(current.get('api_key') or '')
            key = key or (existing.get(reference[2:-1], '') if reference.startswith('${') and reference.endswith('}') else reference)
        return key
    names = [setup['credentialEnv']] if setup.get('credentialEnv') in provider['keyVars'] else provider['keyVars']
    direct = next((supplied[name] for name in names if supplied.get(name)), '')
    if direct:
        return direct
    current = config.get('model', {})
    if isinstance(current, dict) and current.get('provider') == setup['provider']:
        previous_url = str(current.get('base_url') or '').rstrip('/')
        requested_url = str(setup.get('baseUrl') or '').rstrip('/')
        if previous_url and previous_url != requested_url:
            return ''
        reference = str(current.get('api_key') or '')
        if reference:
            return existing.get(reference[2:-1], '') if reference.startswith('${') and reference.endswith('}') else reference
    return next((existing[name] for name in names if existing.get(name)), '')


def http_models(base_url, key, provider, api_mode):
    parsed = urlsplit(base_url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return catalog_result(status='unavailable', message='Enter a valid provider base URL before loading models.')
    headers = {'Accept': 'application/json', 'User-Agent': 'Hermes-Companion/0.1'}
    if provider == 'gemini':
        headers['x-goog-api-key'] = key
    elif api_mode == 'anthropic_messages' or provider == 'anthropic':
        headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
    elif key:
        headers['Authorization'] = 'Bearer ' + key
    base = base_url.rstrip('/')
    candidates = [base + '/models']
    if provider == 'anthropic' and not base.endswith('/v1'):
        candidates = [base + '/v1/models']
    elif provider != 'gemini':
        alternative = base[:-3].rstrip('/') if base.endswith('/v1') else base + '/v1'
        candidates.append(alternative + '/models')
    opener = urllib.request.build_opener(NoRedirect())
    for index, endpoint in enumerate(candidates):
        try:
            with opener.open(urllib.request.Request(endpoint, headers=headers), timeout=8) as response:
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    return catalog_result(status='unavailable', message='The model catalog is too large. Enter an exact model ID or use a filtered endpoint.')
            document = json.loads(data)
            entries = document.get('models' if provider == 'gemini' else 'data')
            if not isinstance(entries, list):
                return catalog_result(status='unavailable', message='The provider returned an unsupported model catalog format.')
            models = []
            for item in entries:
                if not isinstance(item, dict):
                    continue
                if provider == 'gemini':
                    methods = item.get('supportedGenerationMethods', [])
                    if methods and 'generateContent' not in methods:
                        continue
                    name = item.get('name', '')
                    models.append(name.removeprefix('models/') if isinstance(name, str) else '')
                else:
                    models.append(item.get('id', ''))
            result = catalog_result(models, key=key)
            result['truncated'] = result['truncated'] or bool(document.get('has_more') or document.get('nextPageToken'))
            return result
        except urllib.error.HTTPError as error:
            error.close()
            if error.code == 404 and index + 1 < len(candidates):
                continue
            return catalog_result(status='unauthorized' if error.code in {401, 403} else 'unavailable',
                                  message=f'Model listing failed (HTTP {error.code}). Check the provider credentials and endpoint.')
        except Exception:
            return catalog_result(status='unavailable', message='The provider model endpoint could not be reached. Check its address and availability.')
    return catalog_result(status='unavailable', message='This provider does not expose a model listing. Enter an exact model ID.')


def discover(request, catalog):
    setup = request['setup']
    provider = next(item for item in catalog['providers'] + catalog.get('additionalProviders', []) if item['id'] == setup['provider'])
    preset = next((item for item in catalog.get('compatibleProviders', []) if item['id'] == setup.get('providerPreset')), None)
    supplied = {entry['name']: entry['value'].strip() for entry in request.get('values', []) if entry['value'].strip()}
    existing, config = read_env()
    if setup.get('authMethod') == 'oauth' or provider['authType'] in {'aws_sdk', 'vertex', 'external_process'}:
        try:
            if setup['provider'] == 'antigravity-oauth':
                from providers import get_provider_profile
                profile = get_provider_profile(setup['provider'])
                models = profile.fetch_models(timeout=12) if profile else None
                return catalog_result(models, source='provider', status='ok' if models is not None else 'unavailable', message='' if models is not None else 'Sign in to Google Antigravity before loading its model catalog.')
            from hermes_cli.models import provider_model_ids
            for name, value in supplied.items():
                if not name.endswith('_JSON'):
                    os.environ[name] = value
            models = provider_model_ids(setup['provider'], force_refresh=True)
            return catalog_result(models, source='hermes')
        except Exception:
            return catalog_result(source='hermes', status='unavailable', message='Connect this account in Hermes before loading its models.')
    base_url = setup.get('baseUrl') or (preset or provider).get('baseUrl', '')
    key = resolve_key(setup, provider, preset, supplied, existing, config)
    if not key and provider['authType'] == 'api_key' and setup['provider'] not in {'custom', 'lmstudio'}:
        return catalog_result(status='unavailable', message='Enter the provider API key before loading models.')
    if setup['provider'] == 'custom' and not key and not setup.get('allowUnauthenticatedModel'):
        return catalog_result(status='unavailable', message='Enter an API key for this endpoint before loading models.')
    if not base_url and setup['provider'] == 'lmstudio':
        base_url = 'http://127.0.0.1:1234/v1'
    return http_models(base_url, key, setup['provider'], setup.get('apiMode', ''))


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    try:
        payload = json.load(sys.stdin)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = discover(payload['request'], payload['catalog'])
        print(json.dumps(result))
    except Exception:
        print(json.dumps(catalog_result(status='unavailable', message='Could not load this provider model catalog. Check the selected provider and its credentials.')))
