"""线上帧率 + 切页延迟归因探针（真实可见 Edge + CDP 9222）。

回答两个问题：
1) 滚动/背景掉帧是谁造成的 —— 逐层关掉星云 / 火星 / 星空 / 极光 / backdrop-blur 后复测 FPS；
   并用 Emulation.setCPUThrottlingRate 模拟中低配 CPU，看弱机上是否掉帧。
2) 页面切换卡在哪里 —— 记录 SPA 切页「点击 -> 内容稳定」耗时、期间的 long task 与 /api 请求耗时。

登录用一次性演示账号（urllib 注册 -> 把会话 Cookie 注入 Edge），不涉及真实凭据。
"""
import base64, json, subprocess, time, urllib.request, urllib.error, random, string, sys
import websocket

PORT = 9222
BASE = 'https://tiger-fatloss-7ryxdp3g07c.qoder.zone'
API = BASE + '/functions/v1/app'   # Sites Function 挂载前缀，与 src/lib/api.ts 一致
HOST = 'tiger-fatloss-7ryxdp3g07c.qoder.zone'
PROFILE = r'C:\Users\huanghu\tools\edgeperf'
OUT = 'dev/fps-live.png'


def register():
    """Log in as the fixed throwaway perf account (register it once), return the session cookie."""
    user, pw = 'fpsdemo01', 'tiger-fps-verify-passphrase-2026'
    body = json.dumps({'username': user, 'password': pw}).encode()

    def post(path):
        req = urllib.request.Request(API + path, data=body, method='POST', headers={
            'Content-Type': 'application/json', 'Origin': BASE})
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.headers.get('Set-Cookie', ''), r.status

    try:
        sc, status = post('/api/login')
        print('login:', user, status, flush=True)
    except urllib.error.HTTPError:
        sc, status = post('/api/register')
        print('registered:', user, status, flush=True)
    for part in sc.split(';'):
        part = part.strip()
        if 'app_auth.session=' in part:
            return part.split('=', 1)[1]
    raise SystemExit('FAIL: no session cookie in response: %r' % sc[:200])


def cdp_pages():
    try:
        targets = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=3))
    except Exception:
        return []
    return [t for t in targets if t['type'] == 'page']


if not cdp_pages():
    # 专用性能测试实例：关掉省内存/睡眠标签，否则后台标签 JS 与 rAF 会被冻结，测不出真东西。
    subprocess.Popen(['cmd', '/c', 'start', '', 'msedge',
                      '--remote-debugging-port=%d' % PORT,
                      '--user-data-dir=' + PROFILE,
                      '--disable-features=MemorySaver,HighEfficiencyModeAvailableByDefault,TabHoverCardImages,msEdgeShoppingUI',
                      '--no-first-run', '--new-window', BASE + '/'])
    for _ in range(20):
        time.sleep(1)
        if cdp_pages():
            break

p = cdp_pages()
if not p:
    raise SystemExit('FAIL: no debuggable page (Edge did not open?)')
cand = [t for t in p if HOST in t.get('url', '')] or p

ws = websocket.create_connection(cand[-1]['webSocketDebuggerUrl'], timeout=120)
_id = [0]


def raw(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == _id[0]:
            if 'error' in msg:
                raise RuntimeError('%s -> %s' % (method, msg['error']))
            return msg.get('result', {})


def ev(expr):
    r = raw('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in r:
        det = r['exceptionDetails']
        raise RuntimeError(det.get('exception', {}).get('description') or det.get('text', det))
    return r['result'].get('value')


raw('Runtime.enable')
raw('Page.enable')


def visible():
    return ev('document.visibilityState') == 'visible'


def show():
    """Edge 窗口最小化/后台睡眠时 rAF 与 JS 都会停摆：先用窗口 API 真正唤醒，再确认可见。"""
    try:
        win = raw('Browser.getWindowForTarget')
        for state in ('normal', 'maximized'):
            raw('Browser.setWindowBounds', {'windowId': win['windowId'], 'bounds': {'state': state}})
            time.sleep(0.6)
    except Exception as e:
        print('WARN setWindowBounds:', e, flush=True)
    for i in range(5):
        raw('Page.bringToFront')
        time.sleep(0.8)
        if visible():
            return True
        if i == 2:  # 窗口被彻底关闭时重新拉起
            subprocess.run(['cmd', '/c', 'start', '', 'msedge', BASE + '/'])
            time.sleep(4)
    return False


def page(url, settle=3.5):
    raw('Page.navigate', {'url': url})
    time.sleep(settle)
    show()
    wait_bg()


def wait_bg(timeout=12):
    """等三层动态背景真正挂载（Granim/particles 是异步 loadScript 后才建的）。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = ev("JSON.stringify({n:!!document.querySelector('#tigerNebula'),"
                "e:!!document.querySelector('#tigerEmbers canvas'),s:!!document.querySelector('night-sky')})")
        st = json.loads(st)
        if st['n'] and st['e'] and st['s']:
            return st
        time.sleep(0.7)
    return st


def throttle(rate):
    raw('Emulation.setCPUThrottlingRate', {'rate': rate})
    time.sleep(1)
    print('--- CPU throttle %dx ---' % rate, flush=True)


# --- 登录态注入（__Host- Cookie 必须 host-only：用 url 而非 domain）---------
token = None
try:
    token = register()
except Exception as e:
    print('WARN register failed, measuring anonymously:', e, flush=True)

if token:
    raw('Network.enable')
    raw('Network.setCookie', {'name': '__Host-app_auth.session', 'value': token,
                              'url': BASE + '/', 'path': '/', 'secure': True,
                              'httpOnly': True, 'sameSite': 'Lax'})
    page(BASE + '/dashboard', 4)
    print('auth probe /api/me:', ev("fetch('%s/api/me').then(r=>r.status)" % API),
          'path:', ev('location.pathname'), 'bg:', wait_bg(), flush=True)

# --- 度量原语 ---------------------------------------------------------------
FPS = """async ([ms, mode]) => {
  if (document.visibilityState !== 'visible') return {fps: null, reason: 'hidden'};
  const max = document.body.scrollHeight - innerHeight;
  const inst = (y) => window.scrollTo({top: y, behavior: 'instant'});
  if (mode === 'scroll') inst(0);
  await new Promise(r => setTimeout(r, 250));
  let n = 0, worst = 0, frames = 0, last = performance.now(), t0 = last;
  return await new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    setTimeout(() => finish({fps: null, reason: 'rAF stalled (hidden?)'}), ms + 5000);
    function f(t) {
      if (done) return;
      const d = t - last; last = t; n++; if (d > worst) worst = d;
      if (mode === 'scroll') inst(Math.min(max, (t - t0) * 0.5));
      if (t - t0 < ms) requestAnimationFrame(f);
      else { if (mode === 'scroll') inst(0);
             finish({fps: +(n / ((t - t0) / 1000)).toFixed(1), worst_ms: Math.round(worst)}); }
    }
    requestAnimationFrame(f);
  });
}"""


def fps(mode, ms=3000):
    for _ in range(2):
        if not show():
            return {'fps': None, 'reason': 'window hidden'}
        r = ev('(' + FPS + ')([%d,%s])' % (ms, json.dumps(mode)))
        if r.get('fps') is not None:
            return r
        time.sleep(1)
    return r


STYLE = """(css) => {
  let el = document.getElementById('fps-probe-style');
  if (!el) { el = document.createElement('style'); el.id = 'fps-probe-style'; document.head.appendChild(el); }
  el.textContent = css || '';
  return css ? 'applied' : 'cleared';
}"""


def css_off(rule):
    return ev('(' + STYLE + ')(' + json.dumps(rule or '') + ')')


TOGGLES = [
    ('nebula', '#tigerNebula{display:none!important}'),
    ('embers', '#tigerEmbers{display:none!important}'),
    ('starsky', '#tigerNightSky,night-sky{display:none!important}'),
    ('aurora', 'html::before,html::after{display:none!important}'),
    ('blur', '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'),
    ('allbg', '#tigerNebula,#tigerEmbers,#tigerNightSky,night-sky{display:none!important}'
              'html::before,html::after{display:none!important}'),
]

INVENTORY = """(() => {
  const sels = {nebula: '#tigerNebula', embers: '#tigerEmbers canvas', starsky: 'night-sky'};
  const present = Object.fromEntries(Object.entries(sels).map(([k, s]) => [k, !!document.querySelector(s)]));
  const sky = document.querySelector('night-sky');
  let filtered = 0, willChange = 0, animating = 0;
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.backdropFilter && s.backdropFilter !== 'none') filtered++;
    if (s.willChange && s.willChange !== 'auto') willChange++;
    if (s.animationName && s.animationName !== 'none' && s.animationIterationCount === 'infinite') animating++;
  }
  return JSON.stringify({
    path: location.pathname, vis: document.visibilityState,
    vp: [innerWidth, innerHeight], dpr: devicePixelRatio, nodes: document.querySelectorAll('*').length,
    bg: present, starLayers: sky && sky.shadowRoot ? sky.shadowRoot.querySelectorAll('[id^=star_]').length : 0,
    filtered, willChange, animating,
    scrollH: document.body.scrollHeight,
    heapMB: (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null),
  });
})()"""

# 点击导航 -> 等路径变化 -> 等 main 文本稳定；同时记录 longtask 与该请求窗口内的 /api 耗时
SWITCH = """async (hrefs) => {
  const out = [];
  const longs = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) longs.push(Math.round(e.duration)); })
        .observe({type: 'longtask', buffered: false}); } catch (e) {}
  const text = () => (document.querySelector('main') || document.body).innerText.length;
  for (const href of hrefs) {
    const a = document.querySelector('aside a[href="' + href + '"], a[href="' + href + '"]');
    if (!a) { out.push({href, error: 'no nav link'}); continue; }
    longs.length = 0;
    const t0 = performance.now(), base = text();
    let stable = 0, prev = -1, content = null, lt = 0;
    a.click();
    await new Promise((res) => {
      const guard = setTimeout(res, 8000);
      (function wait() {
        requestAnimationFrame(() => {
          const now = performance.now(), cur = text();
          if (location.pathname === href) {
            lt = Math.round(now - t0);
            if (cur === prev) stable++; else stable = 0;
            if (stable >= 8 && cur !== base) { content = Math.round(now - t0); clearTimeout(guard); res(); return; }
            if (stable >= 30) { content = Math.round(now - t0); clearTimeout(guard); res(); return; }
          }
          prev = cur;
          requestAnimationFrame(wait);
        });
      })();
    });
    const api = performance.getEntriesByType('resource')
      .filter(r => r.name.includes('/api/') && r.startTime >= t0 - 50)
      .map(r => r.name.replace(location.origin, '') + ' ' + Math.round(r.duration) + 'ms');
    out.push({href, route_ms: lt, content_ms: content, long_ms: longs.reduce((a, b) => a + b, 0), api});
    await new Promise(r => setTimeout(r, 600));
  }
  return JSON.stringify(out);
}"""

RESULTS = {}


def measure(label):
    idle = fps('idle')
    scroll = fps('scroll')
    RESULTS[label] = {'idle': idle, 'scroll': scroll}
    print('%-26s idle %s | scroll %s'
          % (label,
             ('%5.1f fps (worst %3dms)' % (idle['fps'], idle['worst_ms'])) if idle.get('fps') else idle.get('reason'),
             ('%5.1f fps (worst %3dms)' % (scroll['fps'], scroll['worst_ms'])) if scroll.get('fps') else scroll.get('reason')),
          flush=True)


ROUTES = ['/exercises', '/plans', '/diet', '/weight', '/coach', '/calculators', '/nutrition', '/dashboard']

# --- 1. 落地页 --------------------------------------------------------------
for rate in (1, 6):
    throttle(rate)
    page(BASE + '/')
    time.sleep(2)
    print('INVENTORY /:', ev(INVENTORY), flush=True)
    measure('landing')
    print('switch@%dx:' % rate, ev('(' + SWITCH + ')(["/exercises","/plans","/diet","/dashboard"])'), flush=True)

# --- 2. 仪表盘逐层归因（弱机下才有区分度）----------------------------------
throttle(6)
page(BASE + '/dashboard')
time.sleep(2)
print('INVENTORY /dashboard:', ev(INVENTORY), flush=True)
measure('dash6x all-on')
css_off('')
for name, rule in TOGGLES:
    css_off(rule)
    time.sleep(1)
    measure('dash6x -' + name)
css_off('')

# 反向验证：只留背景、不留内容成本不可能，改为「只关星云+火星+星空+极光」后看是否回到满帧
print('INVENTORY after allbg:', flush=True)
css_off(TOGGLES[-1][1]); time.sleep(1); measure('dash6x bg-off'); css_off('')

# --- 3. 重页面（长列表 / 图表 / 视频识别页）--------------------------------
for path in ['/exercises', '/diet', '/weight']:
    page(BASE + path)
    time.sleep(2.5)
    print('INVENTORY %s: %s' % (path, ev(INVENTORY)), flush=True)
    measure('page6x ' + path)

throttle(1)
page(BASE + '/dashboard')
measure('dash1x final')
print('switch@1x:', ev('(' + SWITCH + ')(%s)' % json.dumps(ROUTES)), flush=True)

shot = raw('Page.captureScreenshot', {'format': 'png'})
with open(OUT, 'wb') as f:
    f.write(base64.b64decode(shot['data']))
print('screenshot saved:', OUT, flush=True)
print('=== SUMMARY ===', flush=True)
print(json.dumps(RESULTS, ensure_ascii=False), flush=True)
print('DONE', flush=True)
ws.close()
