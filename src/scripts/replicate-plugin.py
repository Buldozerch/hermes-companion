"""Replicate image backend using the documented Hermes provider contract."""

import time
from urllib.parse import urlparse

from agent.image_gen_provider import ImageGenProvider, error_response, save_url_image, success_response


class ReplicateImages(ImageGenProvider):
    name = 'replicate'
    display_name = 'Replicate'

    def is_available(self):
        from agent.web_search_provider import get_provider_env
        return bool(get_provider_env('REPLICATE_API_TOKEN'))

    def default_model(self):
        return 'black-forest-labs/flux-schnell'

    def capabilities(self):
        return {'modalities': ['text'], 'max_reference_images': 0}

    def get_setup_schema(self):
        return {'name': self.display_name, 'badge': 'paid', 'env_vars': [{'key': 'REPLICATE_API_TOKEN', 'prompt': 'Replicate API token', 'url': 'https://replicate.com/account/api-tokens'}]}

    def generate(self, prompt, aspect_ratio='landscape', *, image_url=None, reference_image_urls=None, **kwargs):
        import httpx
        from agent.web_search_provider import get_provider_env

        if image_url or reference_image_urls:
            return error_response(error='This Replicate model supports text-to-image generation.', provider=self.name)
        key = get_provider_env('REPLICATE_API_TOKEN')
        if not key:
            return error_response(error='Add a Replicate API token in the Hermes settings.', provider=self.name, error_type='auth_required')
        try:
            with httpx.Client(timeout=65, headers={'Authorization': 'Bearer ' + key}) as client:
                response = client.post('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', headers={'Prefer': 'wait=60'}, json={'input': {'prompt': prompt, 'aspect_ratio': {'landscape': '16:9', 'portrait': '9:16', 'square': '1:1'}.get(aspect_ratio, '1:1')}})
                response.raise_for_status()
                prediction = response.json()
                deadline = time.monotonic() + 90
                while prediction.get('status') in {'starting', 'processing'} and time.monotonic() < deadline:
                    poll = prediction.get('urls', {}).get('get', '')
                    parsed = urlparse(poll)
                    if parsed.scheme != 'https' or parsed.netloc != 'api.replicate.com' or not parsed.path.startswith('/v1/predictions/'):
                        raise ValueError('Unexpected prediction status URL.')
                    time.sleep(2)
                    response = client.get(poll)
                    response.raise_for_status()
                    prediction = response.json()
                output = prediction.get('output')
                image = output[0] if isinstance(output, list) and output else output
                if prediction.get('status') != 'succeeded' or not isinstance(image, str):
                    raise ValueError('Image generation did not complete.')
                path = save_url_image(image, prefix='replicate')
                return success_response(image=str(path), model=self.default_model(), prompt=prompt, aspect_ratio=aspect_ratio, provider=self.name)
        except Exception:
            return error_response(error='Replicate image generation failed. Check the API token, billing and service availability.', provider=self.name)


def register(ctx):
    ctx.register_image_gen_provider(ReplicateImages())
