#  This file is part of wger Workout Manager <https://github.com/wger-project>.
#  Copyright (C) 2013 - 2021 wger Team
#
#  wger Workout Manager is free software: you can redistribute it and/or modify
#  it under the terms of the GNU Affero General Public License as published by
#  the Free Software Foundation, either version 3 of the License, or
#  (at your option) any later version.
#
#  wger Workout Manager is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU Affero General Public License for more details.
#
#  You should have received a copy of the GNU Affero General Public License
#  along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""
Minimal DeepSeek chat client (OpenAI-compatible API, https://api-docs.deepseek.com).

Only the streaming chat completions endpoint is needed. The API key is read
from settings and never leaves the server.
"""

# Standard Library
import json
import logging
from collections.abc import Iterator

# Django
from django.conf import settings

# Third Party
import requests


logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 10
READ_TIMEOUT = 120
MAX_TOKENS = 2048


class DeepSeekError(Exception):
    """Configuration or upstream problem, with a user-facing Chinese message"""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def is_configured() -> bool:
    return bool(getattr(settings, 'DEEPSEEK_API_KEY', ''))


def _error_message(status_code: int) -> str:
    if status_code == 401:
        return 'DeepSeek API key 无效，请检查服务器配置。'
    if status_code == 402:
        return 'DeepSeek 账户余额不足，请充值后重试。'
    if status_code == 429:
        return '请求过于频繁，请稍后再试。'
    if status_code in (500, 502, 503):
        return 'DeepSeek 服务暂时不可用，请稍后再试。'
    return f'DeepSeek 服务返回错误（HTTP {status_code}），请稍后再试。'


def stream_chat(messages: list[dict], api_key: str = '') -> Iterator[str]:
    """Yield the content deltas of a DeepSeek chat completions SSE stream.

    ``api_key`` is the caller's personal key (bring-your-own-key); when empty
    the server-wide DEEPSEEK_API_KEY is used as a fallback.
    """
    key = api_key or getattr(settings, 'DEEPSEEK_API_KEY', '')
    if not key:
        raise DeepSeekError('尚未配置 API key：请先在页面里设置你的 DeepSeek 密钥。')

    base_url = getattr(settings, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com').rstrip('/')
    model = getattr(settings, 'DEEPSEEK_MODEL', 'deepseek-flash')
    payload = {
        'model': model,
        'messages': messages,
        'stream': True,
        # Thinking mode is on by default upstream: skip the reasoning phase so
        # the chat answers start streaming immediately.
        'thinking': {'type': 'disabled'},
        'max_tokens': MAX_TOKENS,
    }

    try:
        response = requests.post(
            f'{base_url}/chat/completions',
            headers={'Authorization': f'Bearer {key}'},
            json=payload,
            stream=True,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
        )
    except requests.RequestException:
        logger.exception('Could not reach the DeepSeek API')
        raise DeepSeekError('无法连接 DeepSeek 服务，请检查网络后重试。')

    try:
        if response.status_code != 200:
            logger.warning('DeepSeek API error %s: %s', response.status_code, response.text[:500])
            raise DeepSeekError(_error_message(response.status_code))

        for raw_line in response.iter_lines():
            if not raw_line:
                continue
            line = raw_line.decode('utf-8', errors='replace')
            if not line.startswith('data:'):
                continue
            data = line[len('data:') :].strip()
            if data == '[DONE]':
                return
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                logger.warning('Skipping malformed DeepSeek SSE chunk')
                continue
            choices = chunk.get('choices') or []
            if not choices:
                continue
            delta = choices[0].get('delta') or {}
            content = delta.get('content')
            if content:
                yield content
    except requests.RequestException:
        logger.exception('DeepSeek stream interrupted')
        raise DeepSeekError('与 DeepSeek 的连接中断，请重试。')
    finally:
        response.close()
