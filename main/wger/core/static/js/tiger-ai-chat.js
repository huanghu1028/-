/* tiger-减脂 · AI 健身助手（DeepSeek 流式对话，无构建步骤，原生 JS）
 * fetch + ReadableStream 解析 SSE，逐字渲染。
 * 密钥采用 BYOK：用户自己的 DeepSeek key 只存本浏览器 localStorage，
 * 每次请求经 X-DeepSeek-Key 头临时交给本站代理转发，服务器不保存。 */
(function () {
    'use strict';

    var configEl = document.getElementById('ai-chat-config');
    if (!configEl) { return; }
    var apiUrl = configEl.getAttribute('data-api-url');
    var csrf = configEl.getAttribute('data-csrf');
    var serverConfigured = configEl.getAttribute('data-configured') === '1';

    var messagesEl = document.getElementById('ai-messages');
    var emptyEl = document.getElementById('ai-empty');
    var formEl = document.getElementById('ai-input-form');
    var inputEl = document.getElementById('ai-input');
    var sendBtn = document.getElementById('ai-send');
    var stopBtn = document.getElementById('ai-stop');
    var newBtn = document.getElementById('ai-new-chat');
    var keyToggle = document.getElementById('ai-key-toggle');
    var keyPanel = document.getElementById('ai-key-panel');
    var keyInput = document.getElementById('ai-key-input');
    var keySave = document.getElementById('ai-key-save');
    var keyClear = document.getElementById('ai-key-clear');
    var keyStatus = document.getElementById('ai-key-status');
    var keyBanner = document.getElementById('ai-key-banner');
    if (!messagesEl || !formEl || !inputEl) { return; }

    var KEY_STORAGE = 'tiger-deepseek-key';
    var MAX_HISTORY = 20;
    var history = [];
    var streaming = false;
    var controller = null;
    var personalKey = readStoredKey();

    /* ---------- 个人密钥（BYOK） ---------- */
    function readStoredKey() {
        try { return window.localStorage.getItem(KEY_STORAGE) || ''; } catch (e) { return ''; }
    }
    function storeKey(value) {
        try {
            if (value) { window.localStorage.setItem(KEY_STORAGE, value); }
            else { window.localStorage.removeItem(KEY_STORAGE); }
        } catch (e) { /* 隐私模式下仅本次会话内存保存 */ }
    }
    function hasKey() { return !!personalKey || serverConfigured; }

    function refreshKeyUi() {
        if (keyStatus) {
            if (personalKey) {
                keyStatus.textContent = '个人密钥';
                keyStatus.className = 'badge ms-auto text-bg-success';
            } else if (serverConfigured) {
                keyStatus.textContent = '共享密钥';
                keyStatus.className = 'badge ms-auto text-bg-info';
            } else {
                keyStatus.textContent = '未设置';
                keyStatus.className = 'badge ms-auto text-bg-secondary';
            }
        }
        if (keyBanner) { keyBanner.classList.toggle('d-none', hasKey()); }
        updateButtons();
    }

    function openKeyPanel() {
        if (!keyPanel) { return; }
        keyPanel.classList.remove('d-none');
        if (keyInput) { keyInput.value = personalKey; keyInput.focus(); }
    }

    if (keyToggle) {
        keyToggle.addEventListener('click', function () {
            if (keyPanel.classList.contains('d-none')) { openKeyPanel(); }
            else { keyPanel.classList.add('d-none'); }
        });
    }
    if (keySave) {
        keySave.addEventListener('click', function () {
            var value = (keyInput.value || '').trim();
            if (!value) { keyInput.focus(); return; }
            if (value.length > 200 || /\s/.test(value)) {
                window.alert('密钥格式不正确：应为不含空格的一串字符（通常以 sk- 开头）。');
                return;
            }
            personalKey = value;
            storeKey(value);
            keyPanel.classList.add('d-none');
            refreshKeyUi();
            inputEl.focus();
        });
    }
    if (keyClear) {
        keyClear.addEventListener('click', function () {
            personalKey = '';
            storeKey('');
            if (keyInput) { keyInput.value = ''; }
            refreshKeyUi();
        });
    }

    /* ---------- 安全的轻量 Markdown 渲染：先转义，再只引入已知标签 ---------- */
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function inline(text) {
        return text
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    function renderMarkdown(text) {
        var lines = escapeHtml(text).split('\n');
        var html = '';
        var listType = null;
        var para = [];

        function flushPara() {
            if (para.length) {
                html += '<p>' + para.join('<br>') + '</p>';
                para = [];
            }
        }
        function closeList() {
            if (listType) { html += '</' + listType + '>'; listType = null; }
        }

        lines.forEach(function (line) {
            var trimmed = line.trim();
            var bullet = trimmed.match(/^[*-]\s+(.*)$/);
            var numbered = trimmed.match(/^\d+[.、)]\s+(.*)$/);
            var heading = trimmed.match(/^#{1,4}\s+(.*)$/);
            if (bullet || numbered) {
                flushPara();
                var type = bullet ? 'ul' : 'ol';
                if (listType !== type) { closeList(); html += '<' + type + '>'; listType = type; }
                html += '<li>' + inline(bullet ? bullet[1] : numbered[1]) + '</li>';
            } else if (heading) {
                flushPara(); closeList();
                html += '<p class="ai-md-heading">' + inline(heading[1]) + '</p>';
            } else if (trimmed === '') {
                flushPara(); closeList();
            } else {
                closeList();
                para.push(inline(line));
            }
        });
        flushPara(); closeList();
        return html;
    }

    /* ---------- 消息 DOM ---------- */
    function hideEmpty() {
        if (emptyEl) { emptyEl.classList.add('d-none'); }
    }

    function appendMessage(role, text) {
        hideEmpty();
        var wrap = document.createElement('div');
        wrap.className = 'ai-msg ai-msg-' + role;

        var avatar = document.createElement('span');
        avatar.className = 'ai-avatar';
        avatar.innerHTML = role === 'user'
            ? '<i class="fa-solid fa-user" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-robot" aria-hidden="true"></i>';

        var bubble = document.createElement('div');
        bubble.className = 'ai-bubble';
        if (role === 'user') {
            bubble.textContent = text;
        } else {
            bubble.innerHTML = text ? renderMarkdown(text) : '';
        }

        if (role === 'user') {
            wrap.appendChild(bubble);
            wrap.appendChild(avatar);
        } else {
            wrap.appendChild(avatar);
            wrap.appendChild(bubble);
        }
        messagesEl.appendChild(wrap);
        scrollDown(true);
        return bubble;
    }

    function nearBottom() {
        return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 90;
    }

    function scrollDown(force) {
        if (force || nearBottom()) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    /* ---------- 发送与流式接收 ---------- */
    function updateButtons() {
        var enabled = hasKey() && !streaming;
        sendBtn.classList.toggle('d-none', streaming);
        stopBtn.classList.toggle('d-none', !streaming);
        sendBtn.disabled = !enabled;
        inputEl.disabled = !enabled;
    }

    function autoResize() {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    }

    function send(text) {
        if (!hasKey() || streaming) { return; }
        text = (text || '').trim();
        if (!text) { return; }

        history.push({ role: 'user', content: text });
        appendMessage('user', text);
        inputEl.value = '';
        autoResize();

        var bubble = appendMessage('assistant', '');
        bubble.classList.add('ai-typing');
        var raw = '';
        var errored = false;
        var renderPending = false;

        function render() {
            renderPending = false;
            bubble.innerHTML = renderMarkdown(raw);
            scrollDown(false);
        }
        function scheduleRender() {
            if (!renderPending) {
                renderPending = true;
                window.requestAnimationFrame(render);
            }
        }

        streaming = true;
        updateButtons();
        controller = new AbortController();

        var headers = { 'Content-Type': 'application/json', 'X-CSRFToken': csrf };
        if (personalKey) { headers['X-DeepSeek-Key'] = personalKey; }

        fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
            signal: controller.signal
        }).then(function (resp) {
            if (!resp.ok) {
                return resp.json().catch(function () { return {}; }).then(function (data) {
                    if (data.error === 'not_configured') { openKeyPanel(); }
                    throw new Error(data.message || '请求失败（HTTP ' + resp.status + '）');
                });
            }
            var reader = resp.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';

            function handleEvent(part) {
                part.split('\n').forEach(function (line) {
                    if (line.indexOf('data:') !== 0) { return; }
                    var payload;
                    try { payload = JSON.parse(line.slice(5).trim()); } catch (e) { return; }
                    if (payload.type === 'delta' && payload.text) {
                        raw += payload.text;
                        scheduleRender();
                    } else if (payload.type === 'error') {
                        errored = true;
                        bubble.classList.remove('ai-typing');
                        bubble.innerHTML = renderMarkdown(raw)
                            + '<p class="ai-error mb-0"><i class="fa-solid fa-circle-exclamation me-1"></i>'
                            + escapeHtml(payload.message || '生成中断，请重试。') + '</p>';
                        scrollDown(false);
                    }
                });
            }

            function pump() {
                return reader.read().then(function (result) {
                    if (result.done) { return; }
                    buffer += decoder.decode(result.value, { stream: true });
                    var parts = buffer.split('\n\n');
                    buffer = parts.pop();
                    parts.forEach(handleEvent);
                    return pump();
                });
            }
            return pump();
        }).catch(function (err) {
            if (err && err.name === 'AbortError') { return; }
            errored = true;
            bubble.classList.remove('ai-typing');
            bubble.innerHTML = renderMarkdown(raw)
                + '<p class="ai-error mb-0"><i class="fa-solid fa-circle-exclamation me-1"></i>'
                + escapeHtml((err && err.message) || '网络错误，请重试。') + '</p>';
            scrollDown(false);
        }).finally(function () {
            streaming = false;
            controller = null;
            bubble.classList.remove('ai-typing');
            if (raw) {
                bubble.innerHTML = renderMarkdown(raw);
                history.push({ role: 'assistant', content: raw });
            } else if (!errored) {
                bubble.innerHTML = '<span class="ai-error">没有收到回复，请重试。</span>';
            }
            updateButtons();
            scrollDown(false);
            inputEl.focus();
        });
    }

    /* ---------- 事件绑定 ---------- */
    formEl.addEventListener('submit', function (e) {
        e.preventDefault();
        send(inputEl.value);
    });

    inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send(inputEl.value);
        }
    });
    inputEl.addEventListener('input', autoResize);

    if (stopBtn) {
        stopBtn.addEventListener('click', function () {
            if (controller) { controller.abort(); }
        });
    }

    if (newBtn) {
        newBtn.addEventListener('click', function () {
            if (controller) { controller.abort(); }
            history = [];
            messagesEl.querySelectorAll('.ai-msg').forEach(function (el) { el.remove(); });
            if (emptyEl) { emptyEl.classList.remove('d-none'); }
            inputEl.value = '';
            autoResize();
            inputEl.focus();
        });
    }

    messagesEl.addEventListener('click', function (e) {
        var chip = e.target.closest('.ai-chip');
        if (chip) { send(chip.getAttribute('data-question')); }
    });

    refreshKeyUi();
})();