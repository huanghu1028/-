"""性能改造前后对照验证（真实可见 Edge + CDP 9222）。

用法：
  python dev/verify_perf.py                 # 默认打本地 preview（127.0.0.1:4174）
  BASE=https://<host> python dev/verify_perf.py   # 打线上

测四件事，全部有改造前的基线数字可对比：
1) 首屏：主 JS 体积与 FCP（改造前 index.js 1,073,482 B / FCP 928ms，另有两个阻塞的第三方 CSS）；
2) 落地页 DOM：背景三层是否真的挂上（改造后线上曾因为 dist 过期而完全没有背景）、
   rellax 是否已清零、AOS 元素数量；
3) 滚动负载：CDP Performance 域取 TaskDuration/Style*，算每帧主线程毫秒；
   同时断言滚动中 particles.js 的 move.enable 被我们的「动画节流器」关掉；
4) 切页：导航悬停预热 + 路由级拆包后，点击到内容稳定的耗时。
"""
import base64, json, os, subprocess, sys, time, urllib.request
import websocket

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('BASE', 'http://127.0.0.1:4174')).rstrip('/')
PORT = 9222
PROFILE = r'C:\Users\huanghu\tools\edgeperf'
OUT = 'dev/perf-after.png'
IS_LOCAL = '127.0.0.1' in BASE
HOST = BASE.split('//')[-1].split('/')[0]
API = BASE + '/functions/v1/app'   # Sites Function 挂载前缀；本地 preview 用同一条代理


def cdp_pages():
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=3) as r:
            return [t for t in json.load(r) if t['type'] == 'page']
    except Exception:
        return []


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

pages = cdp_pages()
if not pages:
    raise SystemExit('FAIL: no debuggable Edge page')
cand = [t for t in pages if HOST in t.get('url', '')] or pages
ws = websocket.create_connection(cand[-1]['webSocketDebuggerUrl'], timeout=180)
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
raw('Network.enable')
raw('Performance.enable')
# 页面报错用文档内钩子收集（不靠 CDP 事件流，避免和请求-响应循环抢同一个 socket）。
raw('Page.addScriptToEvaluateOnNewDocument', {'source': """
  window.__errs = [];
  addEventListener('error', e => window.__errs.push(String(e.message).slice(0, 200)));
  addEventListener('unhandledrejection', e => window.__errs.push('promise: ' + String(e.reason).slice(0, 200)));
  window.__lcp = -1;
  try { new PerformanceObserver(l => { const es = l.getEntries(); window.__lcp = Math.round(es[es.length-1].startTime); })
        .observe({type: 'largest-contentful-paint', buffered: true}); } catch (e) {}
"""})
ERRORS = []


def collect_errors():
    try:
        for e in (ev('window.__errs || []') or []):
            if e not in ERRORS:
                ERRORS.append(e)
        raw('Runtime.evaluate', {'expression': 'window.__errs = []'})
    except Exception:
        pass


def show():
    try:
        win = raw('Browser.getWindowForTarget')
        for state in ('normal', 'maximized'):
            raw('Browser.setWindowBounds', {'windowId': win['windowId'], 'bounds': {'state': state}})
            time.sleep(0.5)
    except Exception as e:
        print('WARN bounds:', e, flush=True)
    for _ in range(5):
        raw('Page.bringToFront')
        time.sleep(0.7)
        collect_errors()
        if ev('document.visibilityState') == 'visible':
            return True
    return False


def page(url, settle=4.0):
    """先确认窗口真的可见，再导航——否则「不可见 -> 唤醒」会把首绘时间算成好几秒。"""
    show()
    raw('Page.navigate', {'url': url})
    time.sleep(settle)
    show()
    collect_errors()


def metrics():
    return {m['name']: m['value'] for m in raw('Performance.getMetrics')['metrics']}


# --- 演示账号：确保存在（urllib 注册），随后在页面里同域 fetch 登录拿会话 ---
def ensure_demo_account():
    """一次性演示账号，只为进应用页量切页；注册成功或已存在都算通过。"""
    user, pw = 'fpsdemo01', 'tiger-fps-verify-passphrase-2026'
    body = json.dumps({'username': user, 'password': pw}).encode()
    req = urllib.request.Request(API + '/api/register', data=body, method='POST',
                                 headers={'Content-Type': 'application/json', 'Origin': BASE})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            print('demo account:', r.status, flush=True)
    except urllib.error.HTTPError as e:
        print('demo account exists:', e.code, flush=True)


import urllib.error  # noqa: E402  (ensure_demo_account 里用到)


COOKIES = """(() => {
  const sky = document.querySelector('night-sky');
  const js = performance.getEntriesByType('resource').filter(r => r.name.endsWith('.js'));
  return JSON.stringify({
    path: location.pathname, vis: document.visibilityState, dpr: devicePixelRatio,
    nodes: document.querySelectorAll('*').length,
    nebula: !!document.querySelector('#tigerNebula'),
    nebulaPx: (() => { const c = document.querySelector('#tigerNebula'); return c ? c.width + 'x' + c.height : null; })(),
    embers: !!document.querySelector('#tigerEmbers canvas'),
    sky: !!sky, skyKids: sky && sky.shadowRoot ? sky.shadowRoot.querySelectorAll('*').length : 0,
    backTop: !!document.querySelector('.tiger-back-top'),
    rellax: document.querySelectorAll('[data-rellax-speed]').length,
    reregex: [...document.querySelectorAll('[data-rellax-speed]')].filter(e => e.style.transform).length,
    aos: document.querySelectorAll('[data-aos]').length,
    aosVisible: [...document.querySelectorAll('[data-aos]')].filter(e => +getComputedStyle(e).opacity > 0.5).length,
    glass: document.querySelectorAll('.tiger-glass').length,
    motionPausedCanvas: !!window.pJSDom && window.pJSDom.length > 0,
    blockingCSS: [...document.querySelectorAll('link[rel=stylesheet]')].length,
    jsCount: js.length,
    jsBytes: js.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0),
    imgs: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'img' || /\\.(png|jpe?g|webp)/.test(r.name))
      .map(r => [r.transferSize || r.encodedBodySize || 0, r.name.replace(location.origin, '')]).sort((a,b)=>b[0]-a[0]).slice(0, 3),
    lcp: window.__lcp,
    fcp: Math.round((performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime || -1),
    dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
  });
})()"""

print('=== 1. 落地页（未登录）===', BASE, flush=True)
raw('Network.clearBrowserCookies')
raw('Network.clearBrowserCache')
page(BASE + '/', 6)
c = json.loads(ev(COOKIES))
print('DOM:', json.dumps(c, ensure_ascii=False), flush=True)
ok_bg = c['nebula'] and c['embers'] and c['sky']
print('CHECK 背景三层:', 'OK' if ok_bg else 'FAIL（落地页没有背景）',
      '| rellax 已移除:', 'OK' if c['rellax'] == 0 else 'FAIL(%d)' % c['rellax'],
      '| AOS 初态隐藏:', 'OK' if c['aosVisible'] < c['aos'] else 'WARN 全部可见（aos.css 规则没生效？）',
      '(%d/%d)' % (c['aosVisible'], c['aos']), flush=True)
print('CHECK 阻塞 CSS 数量:', c['blockingCSS'], '| 首屏 JS:', c['jsCount'], '个 /',
      round((c['jsBytes'] or 0) / 1024), 'KB | FCP', c['fcp'], 'ms | DCL', c['dcl'], 'ms', flush=True)

SCROLL = """async (ms) => {
  const pjs = () => { const d = window.pJSDom && window.pJSDom[0]; return d ? (d.pJS || d) : null; };
  const before = (() => { const p = pjs(); return p ? p.particles.move.enable : 'no-pjs'; })();
  const max = document.body.scrollHeight - innerHeight;
  const t0 = performance.now();
  let n = 0, worst = 0, long = 0, last = t0, pausedSeen = null, resumed = null;
  await new Promise((res) => {
    (function f(t) {
      const d = t - last; last = t; n++;
      if (d > worst) worst = d;
      if (d > 33) long++;
      // 与改造前基线（verify_landing_fps.py 的 scroll 模式）完全同款：匀速下滚 0.5px/ms。
      window.scrollTo({ top: Math.min(max, (t - t0) * 0.5), behavior: 'instant' });
      if (t - t0 > 700 && pausedSeen === null) {
        const p = pjs();
        pausedSeen = p ? !p.particles.move.enable : 'no-pjs';
      }
      if (t - t0 < ms) requestAnimationFrame(f);
      else { window.scrollTo({ top: 0, behavior: 'instant' }); res(); }
    })(t0);
  });
  await new Promise(r => setTimeout(r, 900));
  const p = pjs();
  resumed = p ? p.particles.move.enable : 'no-pjs';
  return JSON.stringify({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
                          worst_ms: Math.round(worst), dropped: long,
                          move_before: before, paused_during_scroll: pausedSeen, resumed_after: resumed });
}"""

time.sleep(2)
show()
m0 = metrics()
r = json.loads(ev('(' + SCROLL + ')(3000)'))
m1 = metrics()
dur = m1['Timestamp'] - m0['Timestamp']
task = m1['TaskDuration'] - m0['TaskDuration']
# 与改造前的基线口径保持一致：每「实际帧」的主线程毫秒（本机 165Hz，用实测 fps 归一）。
tpf = task / (r['fps'] * dur) * 1000 if r.get('fps') else None
print('滚动 3s:', json.dumps(r, ensure_ascii=False), flush=True)
print('  主线程 TaskDuration %.3fs / %.2fs => %s ms/frame（改造前 1.22）| style %.3fs layout %.3fs script %.3fs'
      % (task, dur, ('%.3f' % tpf) if tpf is not None else 'n/a',
         m1['RecalcStyleDuration'] - m0['RecalcStyleDuration'],
         m1['LayoutDuration'] - m0['LayoutDuration'],
         m1['ScriptDuration'] - m0['ScriptDuration']), flush=True)
print('CHECK 滚动中暂停背景动画:', 'OK' if r.get('paused_during_scroll') is True else 'FAIL(%r)' % r.get('paused_during_scroll'),
      '| 停手后恢复:', 'OK' if r.get('resumed_after') is True else 'FAIL(%r)' % r.get('resumed_after'), flush=True)

# 打字机：离开视口应当停住（不再每 80ms 改 DOM），回到 hero 继续跑。
TYPED = """async () => {
  const txt = () => (document.getElementById('tigerTyped') || {}).innerText || '';
  scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  await new Promise(r => setTimeout(r, 1300));
  const a = txt();
  await new Promise(r => setTimeout(r, 1800));
  const b = txt();
  scrollTo({ top: 0, behavior: 'instant' });
  await new Promise(r => setTimeout(r, 1800));
  const c = txt();
  return JSON.stringify({ offscreen_static: a === b && a.length > 0, sample: [a.slice(0, 14), b.slice(0, 14), c.slice(0, 14)] });
}"""
page(BASE + '/', 5)
print('打字机离屏暂停:', ev('(' + TYPED + ')()'), flush=True)

# --- 2. 登录后的切页（拆包 + 悬停预热）---
try:
    ensure_demo_account()
except Exception as e:
    print('WARN ensure account:', e, flush=True)
page(BASE + '/', 3)
logged_in = ev("""fetch(%r, {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username:'fpsdemo01', password:'tiger-fps-verify-passphrase-2026'}),
    credentials:'include'}).then(r=>r.status).catch(e=>'err:'+e)""" % (API + '/api/login'))
print('页面内登录:', logged_in, flush=True)
if logged_in == 200:
    page(BASE + '/dashboard', 6)
    print('=== 2. 切页（/dashboard 起）===', 'path:', ev('location.pathname'), flush=True)
    SWITCH = """async (hrefs) => {
      const out = [];
      const text = () => (document.querySelector('main') || document.body).innerText.length;
      for (const href of hrefs) {
        const a = document.querySelector('aside a[href="' + href + '"]');
        if (!a) { out.push({ href, error: 'no nav link' }); continue; }
        a.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
        await new Promise(r => setTimeout(r, 450));           // 让 prefetch 有时间跑完
        const t0 = performance.now();
        let base = text(), stable = 0, prev = -1, content = null, route = null;
        a.click();
        await new Promise((res) => {
          const guard = setTimeout(res, 8000);
          (function wait() {
            requestAnimationFrame(() => {
              const now = performance.now(), cur = text();
              if (location.pathname === href && route === null) route = Math.round(now - t0);
              if (location.pathname === href) {
                if (cur === prev) stable++; else stable = 0;
                if ((stable >= 8 && cur !== base) || stable >= 30) {
                  content = Math.round(now - t0); clearTimeout(guard); res(); return;
                }
              }
              prev = cur;
              requestAnimationFrame(wait);
            });
          })();
        });
        out.push({ href, route_ms: route, content_ms: content });
        await new Promise(r => setTimeout(r, 500));
      }
      return JSON.stringify(out);
    }"""
    print('悬停预热后点击:', ev('(' + SWITCH + ')(["/weight","/exercises","/diet","/measurements","/coach","/dashboard"])'), flush=True)
    print('未预热（新标签直接进 /calendar 的代价见下）:', flush=True)
    page(BASE + '/calendar', 6)
    print('  /calendar path:', ev('location.pathname'), 'nodes:', ev('document.querySelectorAll("*").length'), flush=True)
else:
    print('跳过切页测试（拿不到会话）', flush=True)

shot = raw('Page.captureScreenshot', {'format': 'png'})
with open(OUT, 'wb') as f:
    f.write(base64.b64decode(shot['data']))
collect_errors()
print('screenshot:', OUT, flush=True)
print('页面报错:', json.dumps(ERRORS[:8], ensure_ascii=False) if ERRORS else '无', flush=True)
print('DONE', flush=True)
ws.close()
