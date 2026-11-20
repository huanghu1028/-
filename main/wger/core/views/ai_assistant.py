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
Views for the AI fitness assistant: the chat page and a streaming proxy to
the DeepSeek API. The API key stays on the server, the browser only talks to
this endpoint.
"""

# Standard Library
import json
import logging

# Django
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import (
    JsonResponse,
    StreamingHttpResponse,
)
from django.shortcuts import render
from django.views.decorators.http import require_POST

# wger
from wger.core.ai_assistant.client import (
    DeepSeekError,
    is_configured,
    stream_chat,
)


logger = logging.getLogger(__name__)

MAX_MESSAGES = 20
"""History cap sent upstream, keeps the prompt (and the cost) bounded"""

MAX_CONTENT_LENGTH = 4000
"""Per-message character cap"""

SYSTEM_PROMPT = (
    '你是 tiger-减脂 网站的 AI 健身助手，一名专业、友善的减脂教练与营养师。'
    '用简体中文回答，围绕减脂、训练、饮食、热量与营养话题，给出具体、可执行、安全的建议。'
    '回答简洁清晰，善用短列表与分点；涉及数字时给出合理范围而非绝对值。'
    '不要编造网站数据；不知道的信息就直说。'
    '涉及疾病、用药、孕期等医疗问题时，提醒用户咨询医生或注册营养师。'
    '网站功能：训练计划、动作库、拍照识餐、饮食日记、体重与围度记录、BMI 与每日热量计算器，'
    '适当引导用户使用这些功能。'
)


def build_system_prompt(user) -> str:
    """Base prompt plus the user's daily calorie goal as personal context"""
    prompt = SYSTEM_PROMPT
    calories = getattr(user.userprofile, 'calories', None)
    if calories:
        prompt += f'用户当前设置的每日热量目标约为 {calories} 千卡，制定饮食建议时参考该目标。'
    return prompt


def clean_messages(raw) -> list[dict] | None:
    """Validate the client history: roles, lengths and caps. None when invalid."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_MESSAGES:
        return None
    cleaned = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        role = item.get('role')
        content = item.get('content')
        if role not in ('user', 'assistant'):
            return None
        if not isinstance(content, str) or not content.strip():
            return None
        if len(content) > MAX_CONTENT_LENGTH:
            return None
        cleaned.append({'role': role, 'content': content.strip()})
    if cleaned[-1]['role'] != 'user':
        return None
    return cleaned


@login_required
def chat(request):
    """The assistant page"""
    return render(
        request,
        'ai_assistant/chat.html',
        {
            'ai_configured': is_configured(),
            'ai_model': getattr(settings, 'DEEPSEEK_MODEL', 'deepseek-flash'),
        },
    )


def sse(payload: dict) -> str:
    return f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'


def personal_key(request) -> str | None:
    """The caller's own DeepSeek key from the X-DeepSeek-Key header.

    Returns '' when absent, None when present but malformed. The key is used
    for this request only: it is never stored or logged.
    """
    raw = request.headers.get('X-DeepSeek-Key', '')
    if not raw:
        return ''
    key = raw.strip()
    if not key or len(key) > 200 or any(c.isspace() for c in key):
        return None
    return key


@login_required
@require_POST
def chat_api(request):
    """Streaming chat proxy: validates the history, then relays DeepSeek's SSE"""
    try:
        body = json.loads(request.body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'error': 'invalid_json', 'message': '请求格式错误。'}, status=400)

    messages = clean_messages(body.get('messages') if isinstance(body, dict) else None)
    if messages is None:
        return JsonResponse(
            {'error': 'invalid_messages', 'message': '对话内容无效或过长。'}, status=400
        )

    key = personal_key(request)
    if key is None:
        return JsonResponse(
            {'error': 'invalid_key', 'message': 'API key 格式不正确，请重新设置。'}, status=400
        )
    if not key and not is_configured():
        return JsonResponse(
            {
                'error': 'not_configured',
                'message': '请先设置你的 DeepSeek API key，再开始对话。',
            },
            status=503,
        )

    upstream = [{'role': 'system', 'content': build_system_prompt(request.user)}, *messages]

    def event_stream():
        try:
            for delta in stream_chat(upstream, api_key=key):
                yield sse({'type': 'delta', 'text': delta})
        except DeepSeekError as error:
            yield sse({'type': 'error', 'message': error.message})
        except Exception:
            logger.exception('AI assistant stream failed')
            yield sse({'type': 'error', 'message': 'AI 助手出现异常，请稍后重试。'})
        yield sse({'type': 'done'})

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
