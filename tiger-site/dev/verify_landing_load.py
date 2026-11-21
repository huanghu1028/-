"""落地页「感觉卡」的第二轮归因：合成滚动帧率之外，量主线程负载与首屏阻塞。

帧率(rAF)只反映合成器是否跟上；滚动时的 JS/样式/布局开销、首屏 long task、
视差与揭示动画造成的位移，都会让人觉得卡但帧率依然满格。
本脚本对比：落地页 vs 应用页；落地页再分别关掉视差位移 / AOS 揭示 / 玻璃模糊。
"""
import json, subprocess, time, urllib.request
import websocket

PORT = 9222
BASE = 'https://tiger-fatloss-7ryxdp3g07c.qoder.zone'
HOST = 'tiger-fatloss-7ryxdp3g07c.qoder.zone'
PROFILE = r'C:\Users\huanghu\tools\edgeperf'


def targets():
    try:
        return [t for t in json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=3))
                if t['type'] == 'page']
    except Exception:
        return []


if not targets():
    subprocess.Popen(['cmd', '/c', 'start', '', 'msedge', '--remote-debugging-port=%d' % PORT,
                      '--user-data-dir=' + PROFILE,
                      '--disable-features=MemorySaver,HighEfficiencyModeAvailableByDefault',
                      '--no-first-run', '--new-window', BASE + '/'])
    for _ in range(25):
        time.sleep(1)
        if targets():
            break

t = [x for x in targets() if HOST in x.get('url', '')] or targets()
if not t:
    raise SystemExit('FAIL: no Edge page')
ws = websocket.create_connection(t[-1]['webSocketDebuggerUrl'], timeout=120)
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


raw('Runtime.enable'); raw('Page.enable'); raw('Network.enable'); raw('Performance.enable')


def show():
    try:
        win = raw('Browser.getWindowForTarget')
        raw('Browser.setWindowBounds', {'windowId': win['windowId'], 'bounds': {'state': 'maximized'}})
        time.sleep(0.5)
    except Exception as e:
        print('WARN bounds:', e, flush=True)
    for _ in range(4):
        raw('Page.bringToFront')
        time.sleep(0.6)
        if ev('document.visibilityState') == 'visible':
            return True
    return False


def metrics():
    return {m['name']: m['value'] for m in raw('Performance.getMetrics')['metrics']}


# 一次脚本化滚动：JS 只负责滚并回报帧率；主线程指标由 CDP Performance 域在前后取差值
SCROLL = """async ([ms]) => {
  const max = document.body.scrollHeight - innerHeight;
  const inst = (y) => window.scrollTo({top: y, behavior: 'instant'});
  inst(0);
  await new Promise(r => setTimeout(r, 200));
  let n = 0, worst = 0, last = performance.now(), t0 = last;
  const secs = await new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    setTimeout(() => finish((performance.now() - t0) / 1000), ms + 4000);
    function f(t) {
      if (done) return;
      const d = t - last; last = t; n++; if (d > worst) worst = d;
      inst(Math.min(max, (t - t0) * 0.55));
      if (t - t0 < ms) requestAnimationFrame(f); else finish((t - t0) / 1000);
    }
    requestAnimationFrame(f);
  });
  inst(0);
  return JSON.stringify({fps: +(n / secs).toFixed(1), worst_ms: Math.round(worst), sec: +secs.toFixed(2)});
}"""


def load(ms=3000):
    if not show():
        return 'WINDOW HIDDEN'
    m0 = metrics()
    r = json.loads(ev('(' + SCROLL + ')([%d])' % ms))
    m1 = metrics()
    d = lambda k: round(((m1.get(k, 0) - m0.get(k, 0)) * 1000))
    sec = max(r.get('sec', 1) or 1, 0.5)
    r.update(task_ms=d('TaskDuration'), style_ms=d('RecalcStyleDuration'), layout_ms=d('LayoutDuration'),
             script_ms=d('ScriptDuration'), layouts=int(m1.get('LayoutCount', 0) - m0.get('LayoutCount', 0)),
             styleUpdates=int(m1.get('RecalcStyleCount', 0) - m0.get('RecalcStyleCount', 0)),
             task_per_frame=round(((m1.get('TaskDuration', 0) - m0.get('TaskDuration', 0)) * 1000) / (r['fps'] * sec), 2),
             heapMB=round(m1.get('JSHeapUsedSize', 0) / 1048576, 1))
    return json.dumps(r)


STYLE = """(css) => {
  let el = document.getElementById('probe-style');
  if (!el) { el = document.createElement('style'); el.id='probe-style'; document.head.appendChild(el); }
  el.textContent = css || '';
}"""
KILL_AOS = """(() => {
  document.querySelectorAll('[data-aos]').forEach(e => e.removeAttribute('data-aos'));
  document.querySelectorAll('.aos-init,.aos-animate').forEach(e => e.classList.remove('aos-init','aos-animate'));
  return document.querySelectorAll('[data-aos]').length;
})()"""
CHECK = """(() => {
  const g = document.querySelector('.tiger-glass');
  const s = g ? getComputedStyle(g) : null;
  const sky = document.querySelector('night-sky');
  return JSON.stringify({
    glassBackdrop: s ? s.backdropFilter : null,
    glassBg: s ? s.backgroundColor : null,
    skyDefined: !!sky && !!customElements.get('night-sky'),
    skyShadowKids: sky && sky.shadowRoot ? sky.shadowRoot.querySelectorAll('*').length : -1,
    skyStyle: sky ? getComputedStyle(sky).animationName + '/' + sky.style.display : null,
    tiltGlare: document.querySelectorAll('.js-tilt-glare').length,
    rellaxTransforms: [...document.querySelectorAll('[data-rellax-speed]')].map(e => e.style.transform || 'none'),
    typewriter: !!document.querySelector('.Typewriter__cursor'),
    aosLeft: document.querySelectorAll('[data-aos]').length,
  });
})()"""

TOGGLE = {
    'baseline': '',
    'no-parallax-motion': '[data-rellax-speed]{transform:none!important}',
    'no-aos': '',   # 用 JS 移除 data-aos
    'no-glass-blur': '.tiger-glass{backdrop-filter:none!important}',
    'no-tilt-glare': '.js-tilt-glare{display:none!important}',
    'no-bg': '#tigerNebula,#tigerEmbers,night-sky{display:none!important}html::before,html::after{display:none!important}',
    'all-off': ('[data-rellax-speed]{transform:none!important}'
                '.tiger-glass{backdrop-filter:none!important}'
                '.js-tilt-glare{display:none!important}'),
}

print('=== 首屏（禁用缓存硬刷新）===', flush=True)
raw('Network.setCacheDisabled', {'cacheDisabled': True})
raw('Network.clearBrowserCookies')
raw('Page.navigate', {'url': BASE + '/login'})   # 先让窗口真正前台，否则首屏 paint 时间会被后台节流污染
time.sleep(4)
show()
raw('Page.navigate', {'url': BASE + '/'})
time.sleep(7)
show()
print('CHECK:', ev(CHECK), flush=True)
print('FIRST LOAD:', ev("""(async () => {
  const longs = await new Promise((res) => {
    const out = [];
    try { new PerformanceObserver(l => out.push(...l.getEntries())).observe({type:'longtask', buffered:true}); }
    catch (e) { return res(out); }
    setTimeout(() => res(out), 900);
  });
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
  const lcp = performance.getEntriesByType('largest-contentful-paint').map(e => Math.round(e.startTime));
  const res = performance.getEntriesByType('resource');
  const slow = res.map(r => [Math.round(r.duration), r.name.replace(location.origin, '')]).sort((a,b)=>b[0]-a[0]).slice(0, 8);
  const by = {};
  res.forEach(r => { by[r.initiatorType] = (by[r.initiatorType]||0) + Math.round(r.duration); });
  const tbt = longs.reduce((a, e) => a + Math.max(0, e.duration - 50), 0);
  return JSON.stringify({dcl: Math.round(nav.domContentLoadedEventEnd||0), load: Math.round(nav.loadEventEnd||0),
    paint, lcp, resources: res.length, byType: by, slowest: slow,
    longTasks: longs.map(l => Math.round(l.duration)).slice(0, 12), tbt_ms: Math.round(tbt),
    cls: +((performance.getEntriesByType('layout-shift')||[]).reduce((a,e)=>a+(e.value||0),0)).toFixed(4)});
})()"""), flush=True)

print('=== 落地页滚动负载（3s 脚本滚动）===', flush=True)
for name in ['baseline', 'no-parallax-motion', 'no-glass-blur', 'no-tilt-glare', 'no-bg', 'all-off']:
    ev('(' + STYLE + ')(' + json.dumps(TOGGLE[name]) + ')')
    print('%-20s %s' % (name, load()), flush=True)
ev('(' + STYLE + ')("")')
removed = ev(KILL_AOS)
print('%-20s %s (data-aos 剩余: %s)' % ('no-aos', load(), removed), flush=True)
print('CHECK after:', ev(CHECK), flush=True)

print('=== 对照：应用页 /dashboard ===', flush=True)
raw('Network.setCookie', {'name': '__Host-app_auth.session', 'value': '', 'url': BASE + '/'})
raw('Page.navigate', {'url': BASE + '/login'})
time.sleep(4)
show()
print('login page scroll:', load(), flush=True)

raw('Network.setCacheDisabled', {'cacheDisabled': False})
print('DONE', flush=True)
ws.close()
