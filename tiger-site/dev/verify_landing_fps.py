"""落地页掉帧归因（真实可见 Edge + CDP 9222，用户机器原速 1x）。

用户反馈「只有落地页卡」。落地页独有的成本：18 个 .tiger-glass 实时 backdrop-blur、
hero 的 blur(30px)/blur(64px) 光晕、vanilla-tilt(7)+glare、rellax 视差(2)、AOS/countUp/
typewriter/Waves，再叠加三层动态星空背景。本脚本逐层关掉复测滚动帧率，找出主要成本。
"""
import base64, json, subprocess, time, sys
import websocket

PORT = 9222
BASE = 'https://tiger-fatloss-7ryxdp3g07c.qoder.zone'
HOST = 'tiger-fatloss-7ryxdp3g07c.qoder.zone'
PROFILE = r'C:\Users\huanghu\tools\edgeperf'
OUT = 'dev/landing-fps.png'


def cdp_pages():
    try:
        t = urllib_open('http://127.0.0.1:%d/json/list' % PORT)
    except Exception:
        return []
    return [x for x in t if x['type'] == 'page']


def urllib_open(url):
    import urllib.request
    return json.load(urllib.request.urlopen(url, timeout=3))


if not cdp_pages():
    subprocess.Popen(['cmd', '/c', 'start', '', 'msedge',
                      '--remote-debugging-port=%d' % PORT,
                      '--user-data-dir=' + PROFILE,
                      '--disable-features=MemorySaver,HighEfficiencyModeAvailableByDefault',
                      '--no-first-run', '--new-window', BASE + '/'])
    for _ in range(20):
        time.sleep(1)
        if cdp_pages():
            break

p = cdp_pages()
if not p:
    raise SystemExit('FAIL: no debuggable Edge page')
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
        d = r['exceptionDetails']
        raise RuntimeError(d.get('exception', {}).get('description') or d.get('text', d))
    return r['result'].get('value')


raw('Runtime.enable')
raw('Page.enable')


def show():
    try:
        win = raw('Browser.getWindowForTarget')
        for state in ('normal', 'maximized'):
            raw('Browser.setWindowBounds', {'windowId': win['windowId'], 'bounds': {'state': state}})
            time.sleep(0.5)
    except Exception as e:
        print('WARN bounds:', e, flush=True)
    for _ in range(4):
        raw('Page.bringToFront')
        time.sleep(0.7)
        if ev('document.visibilityState') == 'visible':
            return True
    return False


FPS = """async ([ms, mode]) => {
  if (document.visibilityState !== 'visible') return {fps:null, reason:'hidden'};
  const max = document.body.scrollHeight - innerHeight;
  const inst = (y) => window.scrollTo({top: y, behavior: 'instant'});
  if (mode !== 'idle') inst(0);
  await new Promise(r => setTimeout(r, 200));
  let n = 0, worst = 0, long = 0, last = performance.now(), t0 = last;
  return await new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    setTimeout(() => finish({fps: null, reason: 'rAF stalled'}), ms + 4000);
    function f(t) {
      if (done) return;
      const d = t - last; last = t; n++;
      if (d > worst) worst = d;
      if (d > 33) long++;
      if (mode === 'scroll') inst(Math.min(max, (t - t0) * 0.5));
      if (mode === 'fast') inst((Math.sin((t - t0) / 260) * 0.5 + 0.5) * max);
      if (t - t0 < ms) requestAnimationFrame(f);
      else { inst(0); finish({fps: +(n / ((t - t0) / 1000)).toFixed(1),
                              worst_ms: Math.round(worst), dropped: long}); }
    }
    requestAnimationFrame(f);
  });
}"""


def fps(mode, ms=2600):
    if not show():
        return {'fps': None, 'reason': 'window hidden'}
    return ev('(' + FPS + ')([%d,%s])' % (ms, json.dumps(mode)))


STYLE = """(css) => {
  let el = document.getElementById('probe-style');
  if (!el) { el = document.createElement('style'); el.id='probe-style'; document.head.appendChild(el); }
  el.textContent = css || '';
  return css ? css.length : 0;
}"""


def apply(css):
    return ev('(' + STYLE + ')(' + json.dumps(css or '') + ')')


COUNTS = """(() => JSON.stringify({
  glass: document.querySelectorAll('.tiger-glass').length,
  tilt: document.querySelectorAll('[data-tilt]').length,
  rellax: document.querySelectorAll('[data-rellax-speed]').length,
  aos: document.querySelectorAll('[data-aos]').length,
  blurEls: [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return (s.filter && s.filter.includes('blur')) || (s.backdropFilter && s.backdropFilter !== 'none');
  }).length,
  nodes: document.querySelectorAll('*').length,
  scrollH: document.body.scrollHeight,
  stars: (() => { const s = document.querySelector('night-sky');
                   return s && s.shadowRoot ? s.shadowRoot.querySelectorAll('*').length : 0; })(),
}))()"""

GLASS = '.tiger-glass{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'
HEROBLOB = '[class*="blur-3xl"]{filter:none!important}.tiger-hero-wrap::before{filter:none!important}'
WILLCHANGE = '[data-tilt],[data-rellax-speed]{will-change:auto!important;transform-style:flat!important}'
NEBULA = '#tigerNebula{display:none!important}'
EMBERS = '#tigerEmbers{display:none!important}'
SKY = '#tigerNightSky,night-sky{display:none!important}'
AURORA = 'html::before,html::after{display:none!important}'

print('=== 落地页归因（线上，CPU 原速）===', flush=True)
# 这个 profile 里可能残留上一轮的会话 Cookie：登录态下 "/" 会跳进应用外壳，量到的就不是落地页。
raw('Network.enable')
raw('Network.clearBrowserCookies')
raw('Network.clearBrowserCache')
raw('Page.navigate', {'url': BASE + '/'})
time.sleep(5)
show()
counts = json.loads(ev(COUNTS))
print('COUNTS:', json.dumps(counts), flush=True)
if counts['glass'] == 0:
    print('WARN: 不是落地页（path=%s），重新导航' % ev('location.pathname'), flush=True)
    raw('Page.navigate', {'url': BASE + '/?fresh=1'})
    time.sleep(5)
    show()
    print('COUNTS retry:', ev(COUNTS), 'path:', ev('location.pathname'), flush=True)

SCENARIOS = [
    ('baseline 全开', ''),
    ('-glass blur', GLASS),
    ('-hero 光晕 blur', HEROBLOB),
    ('-glass -hero', GLASS + HEROBLOB),
    ('-will-change', WILLCHANGE),
    ('-星云', NEBULA),
    ('-火星', EMBERS),
    ('-星空', SKY),
    ('-极光', AURORA),
    ('-全部背景', NEBULA + EMBERS + SKY + AURORA),
    ('-glass -hero -全部背景', GLASS + HEROBLOB + NEBULA + EMBERS + SKY + AURORA),
    ('恢复（再测一次基线）', ''),
]

rows = []
for label, css in SCENARIOS:
    apply(css)
    time.sleep(1.0)
    idle = fps('idle')
    scroll = fps('scroll')
    rows.append((label, idle, scroll))
    fmt = lambda r: ('%5.1ffps worst%3dms drop%2d' % (r['fps'], r['worst_ms'], r['dropped'])) if r.get('fps') else r.get('reason')
    print('%-26s idle %s | scroll %s' % (label, fmt(idle), fmt(scroll)), flush=True)

apply('')
shot = raw('Page.captureScreenshot', {'format': 'png'})
with open(OUT, 'wb') as f:
    f.write(base64.b64decode(shot['data']))
print('screenshot:', OUT, '| counts:', ev(COUNTS), flush=True)
print('DONE', flush=True)
ws.close()
