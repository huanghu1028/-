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
Tests for the DeepSeek AI assistant: SSE parsing and error mapping in the
client, access control, payload validation and the streaming proxy view.
"""

# Standard Library
import json
from unittest.mock import (
    MagicMock,
    patch,
)

# Django
from django.contrib.auth.models import User
from django.test import (
    TestCase,
    override_settings,
)
from django.urls import reverse

# Third Party
import requests

# wger
from wger.core.ai_assistant import client
from wger.core.tests.base_testcase import WgerTestCase
from wger.core.views import ai_assistant


def sse_line(payload: dict) -> bytes:
    return f'data: {json.dumps(payload, ensure_ascii=False)}'.encode('utf-8')


def chunk(content: str) -> bytes:
    return sse_line({'choices': [{'delta': {'content': content}}]})


class ClientStreamTest(TestCase):
    """The client parses DeepSeek SSE chunks and maps failures to Chinese messages"""

    def setUp(self):
        self.response = MagicMock()
        self.response.status_code = 200
        self.response.iter_lines.return_value = [
            chunk('你好'),
            b'',
            chunk('，世界'),
            b'data: [DONE]',
        ]

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_yields_content_deltas(self):
        with patch.object(client.requests, 'post', return_value=self.response) as post:
            deltas = list(client.stream_chat([{'role': 'user', 'content': 'hi'}]))
        self.assertEqual(deltas, ['你好', '，世界'])
        self.response.close.assert_called_once()
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer test-key')
        self.assertTrue(kwargs['json']['stream'])
        self.assertEqual(kwargs['json']['thinking'], {'type': 'disabled'})
        self.assertEqual(kwargs['json']['model'], 'deepseek-flash')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_explicit_personal_key_wins(self):
        with patch.object(client.requests, 'post', return_value=self.response) as post:
            list(client.stream_chat([], api_key='sk-personal'))
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer sk-personal')

    @override_settings(DEEPSEEK_API_KEY='')
    def test_missing_key(self):
        with self.assertRaises(client.DeepSeekError):
            list(client.stream_chat([]))

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_skips_reasoning_and_malformed_chunks(self):
        self.response.iter_lines.return_value = [
            sse_line({'choices': [{'delta': {'reasoning_content': 'thinking...'}}]}),
            b'data: not-json',
            sse_line({'choices': []}),
            chunk('答案'),
            b'data: [DONE]',
        ]
        with patch.object(client.requests, 'post', return_value=self.response):
            self.assertEqual(list(client.stream_chat([])), ['答案'])

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_error_status_mapping(self):
        for status, expected in ((401, '无效'), (402, '余额'), (429, '频繁'), (503, '不可用')):
            self.response.status_code = status
            self.response.text = '{"error": {"message": "x"}}'
            with patch.object(client.requests, 'post', return_value=self.response):
                with self.assertRaises(client.DeepSeekError) as ctx:
                    list(client.stream_chat([]))
            self.assertIn(expected, ctx.exception.message)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_network_error(self):
        with patch.object(client.requests, 'post', side_effect=requests.ConnectionError('x')):
            with self.assertRaises(client.DeepSeekError) as ctx:
                list(client.stream_chat([]))
        self.assertIn('无法连接', ctx.exception.message)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_stream_interrupted(self):
        self.response.iter_lines.side_effect = requests.exceptions.ChunkedEncodingError('x')
        with patch.object(client.requests, 'post', return_value=self.response):
            with self.assertRaises(client.DeepSeekError) as ctx:
                list(client.stream_chat([]))
        self.assertIn('中断', ctx.exception.message)
        self.response.close.assert_called_once()


class ChatViewTest(WgerTestCase):
    """Page access, payload validation and the streaming proxy"""

    def setUp(self):
        self.chat_url = reverse('core:ai_assistant:chat')
        self.api_url = reverse('core:ai_assistant:api')

    def post_messages(self, messages, **extra):
        return self.client.post(
            self.api_url,
            data=json.dumps({'messages': messages}),
            content_type='application/json',
            **extra,
        )

    def test_anonymous_redirect(self):
        self.assertEqual(self.client.get(self.chat_url).status_code, 302)
        self.assertEqual(self.client.post(self.api_url).status_code, 302)

    def test_page(self):
        self.user_login('admin')
        response = self.client.get(self.chat_url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'AI 健身助手')
        self.assertContains(response, 'DeepSeek')

    def test_api_rejects_get(self):
        self.user_login('admin')
        self.assertEqual(self.client.get(self.api_url).status_code, 405)

    def test_api_invalid_json(self):
        self.user_login('admin')
        response = self.client.post(self.api_url, data='not json', content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_api_invalid_messages(self):
        self.user_login('admin')
        cases = [
            [],
            [{'role': 'system', 'content': 'x'}],
            [{'role': 'user', 'content': '   '}],
            [{'role': 'user', 'content': 'x' * 4001}],
            [{'role': 'assistant', 'content': 'x'}],
            [{'role': 'user', 'content': 'x'}] * 21,
            'not-a-list',
        ]
        for messages in cases:
            response = self.post_messages(messages)
            self.assertEqual(response.status_code, 400, messages)

    @override_settings(DEEPSEEK_API_KEY='')
    def test_api_not_configured(self):
        self.user_login('admin')
        response = self.post_messages([{'role': 'user', 'content': '你好'}])
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error'], 'not_configured')

    @override_settings(DEEPSEEK_API_KEY='')
    def test_api_personal_key_enables_chat(self):
        self.user_login('admin')
        with patch.object(ai_assistant, 'stream_chat', return_value=iter(['好'])) as stream:
            response = self.post_messages(
                [{'role': 'user', 'content': '你好'}], HTTP_X_DEEPSEEK_KEY='sk-user'
            )
            self.assertEqual(response.status_code, 200)
            b''.join(response.streaming_content)
        self.assertEqual(stream.call_args.kwargs['api_key'], 'sk-user')

    @override_settings(DEEPSEEK_API_KEY='server-key')
    def test_api_personal_key_overrides_server(self):
        self.user_login('admin')
        with patch.object(ai_assistant, 'stream_chat', return_value=iter([])) as stream:
            response = self.post_messages(
                [{'role': 'user', 'content': 'hi'}], HTTP_X_DEEPSEEK_KEY='sk-user'
            )
            b''.join(response.streaming_content)
        self.assertEqual(stream.call_args.kwargs['api_key'], 'sk-user')

    @override_settings(DEEPSEEK_API_KEY='server-key')
    def test_api_falls_back_to_server_key(self):
        self.user_login('admin')
        with patch.object(ai_assistant, 'stream_chat', return_value=iter([])) as stream:
            response = self.post_messages([{'role': 'user', 'content': 'hi'}])
            b''.join(response.streaming_content)
        self.assertEqual(stream.call_args.kwargs['api_key'], '')

    @override_settings(DEEPSEEK_API_KEY='server-key')
    def test_api_invalid_personal_key(self):
        self.user_login('admin')
        for bad in ('sk- bad', 'x' * 201, '   '):
            response = self.post_messages(
                [{'role': 'user', 'content': 'hi'}], HTTP_X_DEEPSEEK_KEY=bad
            )
            self.assertEqual(response.status_code, 400, bad)
            self.assertEqual(response.json()['error'], 'invalid_key')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_api_streams(self):
        self.user_login('admin')
        with patch.object(ai_assistant, 'stream_chat', return_value=iter(['你好', '！'])) as stream:
            response = self.post_messages([{'role': 'user', 'content': '你好'}])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'text/event-stream')
            body = b''.join(response.streaming_content).decode('utf-8')
        self.assertIn('data: {"type": "delta", "text": "你好"}', body)
        self.assertIn('"type": "done"', body)
        upstream = stream.call_args.args[0]
        self.assertEqual(upstream[0]['role'], 'system')
        self.assertEqual(upstream[-1], {'role': 'user', 'content': '你好'})

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_api_system_prompt_includes_calorie_goal(self):
        self.user_login('admin')
        user = User.objects.get(username='admin')
        user.userprofile.calories = 1800
        user.userprofile.save()
        with patch.object(ai_assistant, 'stream_chat', return_value=iter([])) as stream:
            response = self.post_messages([{'role': 'user', 'content': 'hi'}])
            b''.join(response.streaming_content)
        prompt = stream.call_args.args[0][0]['content']
        self.assertIn('1800', prompt)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    def test_api_upstream_error(self):
        self.user_login('admin')

        def boom(*args, **kwargs):
            raise client.DeepSeekError('余额不足')

        with patch.object(ai_assistant, 'stream_chat', side_effect=boom):
            response = self.post_messages([{'role': 'user', 'content': 'hi'}])
            body = b''.join(response.streaming_content).decode('utf-8')
        self.assertIn('"type": "error"', body)
        self.assertIn('余额不足', body)
        self.assertIn('"type": "done"', body)
