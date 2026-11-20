"""Full-site browser sweep (#68) in a REAL visible Edge via CDP 9222.
Registers a throwaway user, then visits EVERY route asserting it renders (h1 present,
no NotFound), checks grouped nav completeness, background layers, Coach BYOK field,
a Measurements quick-create, the Diet photo-scanner dialog opening, and FPS (no
regression). Collects console/page errors. Prints PASS/FAIL; exit 1 on any fail.
"""
import base64, json, subprocess, time, urllib.request, random, string, sys
import websocket

PORT = 9222
BASE = 'http://127.0.0.1:5173'
EVENTS = []
fails = []


def pages():
    try:
        targets = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=3))
    except Exception:
        return []
    return [t for t in targets if t['type'] == 'page' and '5173' in t.get('url', '')]


if not pages():
    subprocess.run(['cmd', '/c', 'start', '', 'msedge',
                    '--remote-debugging-port=%d' % PORT,
                    '--user-data-dir=C:\\Users\\huanghu\\tools\\edgeperf',
                    '--new-window', BASE + '/'])
    time.sleep(7)
p = pages()
if not p:
    raise SystemExit('FAIL: no debuggable 5173 page')
ws = websocket.create_connection(p[-1]['webSocketDebuggerUrl'], timeout=90)
_id = [0]


def raw(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('id') == _id[0]:
            if 'error' in msg:
                raise RuntimeError(msg['error'])
            return msg.get('result', {})
        EVENTS.append(msg)


def ev(expr):
    r = raw('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'])
    return r['result'].get('value')


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


def go(path, wait=1.6):
    raw('Page.navigate', {'url': BASE + path})
    time.sleep(wait)
    return ev("JSON.stringify({path:location.pathname,h1:document.querySelector('h1')?.textContent||'',nf:document.body.innerText.includes('页面不存在')})")


raw('Runtime.enable'); raw('Page.enable'); raw('Log.enable'); raw('Network.enable')
raw('Network.clearBrowserCookies')
raw('Page.bringToFront')

# anonymous landing
st = json.loads(go('/', 2.5))
check('anonymous landing renders', st['h1'] != '' and not st['nf'], st['h1'][:40])
check('landing has nebula', ev("!!document.querySelector('#tigerNebula')") is True)

# register
raw('Page.navigate', {'url': BASE + '/register'})
time.sleep(2.5)
user = 'allverify' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
pw = 'tiger-all-verify-passphrase-2026'
fill = """(() => {
  const set = (id, v) => { const el = document.getElementById(id); if(!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); return true; };
  const ok = set('username', %s) && set('password', %s) && set('confirm', %s);
  const f = document.querySelector('form'); if (f && ok) f.requestSubmit();
  return ok && !!f;
})()""" % (json.dumps(user), json.dumps(pw), json.dumps(pw))
ev(fill)
ok = False
for _ in range(30):
    time.sleep(0.4)
    if ev("location.pathname") == '/dashboard':
        ok = True
        break
check('register -> dashboard', ok, user)

ROUTES = [
    ('/dashboard', '你好'),
    ('/exercises', '动作'),
    ('/exercises/1', ''),
    ('/exercises/1/analytics', '分析'),
    ('/plans', '计划'),
    ('/templates', '模板'),
    ('/train', '打卡'),
    ('/calendar', '日历'),
    ('/diet', '饮食记录'),
    ('/nutrition', '营养'),
    ('/foods', '食物'),
    ('/weight', '体重记录'),
    ('/measurements', '围度'),
    ('/gallery', '画廊'),
    ('/calculators', '计算'),
    ('/coach', '虎教练'),
    ('/settings', '偏好设置'),
]
for path, marker in ROUTES:
    st = json.loads(go(path))
    good = (not st['nf']) and st['h1'] != '' and (marker == '' or marker in st['h1'] or marker in ev("document.body.innerText.slice(0,400)"))
    check('route ' + path, good, st['h1'][:30])

# nav completeness
nav = ev("[...document.querySelectorAll('aside a')].map(a=>a.getAttribute('href'))")
expect = ['/dashboard', '/exercises', '/plans', '/templates', '/train', '/calendar',
          '/diet', '/nutrition', '/foods', '/weight', '/measurements', '/gallery',
          '/calculators', '/coach', '/settings']
missing = [h for h in expect if h not in nav]
check('sidebar nav has all 15 entries', not missing, missing)

# background layers on dashboard
go('/dashboard', 2.5)
bg = ev("JSON.stringify({neb:!!document.querySelector('#tigerNebula'),emb:!!document.querySelector('#tigerEmbers canvas'),sky:!!document.querySelector('night-sky')})")
bg = json.loads(bg)
check('background 3 dynamic layers', bg['neb'] and bg['emb'] and bg['sky'], bg)

# Coach BYOK field
go('/coach', 2)
byok = ev("document.body.innerText.includes('密钥')||document.body.innerText.includes('API')||!!document.querySelector('input[type=password]')")
check('coach BYOK key field present', byok is True)

# Measurements quick-create
go('/measurements', 2)
qc = ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/腰围/.test(x.textContent)); if(!b) return false; b.click(); return true;})()")
time.sleep(1.2)
cat = ev("document.body.innerText.includes('腰围')")
check('measurements quick-create 腰围', qc is True and cat is True)

# Diet scanner dialog opens
go('/diet', 2)
sc = ev("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('拍照')); if(!b) return false; b.click(); return true;})()")
time.sleep(1.0)
dlg = ev("!!([...document.querySelectorAll('[role=dialog]')].find(d=>d.textContent.includes('拍照识餐')))")
check('diet photo-scanner dialog opens', sc is True and dlg is True)
raw('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27})
raw('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': 'Escape', 'code': 'Escape', 'windowsVirtualKeyCode': 27})
time.sleep(0.5)

# FPS on dashboard (no regression)
go('/dashboard', 2.5)
FPS = """(scroll) => new Promise(res => {
  const max = document.body.scrollHeight - innerHeight;
  let n=0, worst=0, last=performance.now(), t0=last;
  function f(t){ const d=t-last; last=t; n++; if(d>worst) worst=d;
    if(scroll) window.scrollTo(0, Math.min(max,(t-t0)*0.4));
    if(t-t0<3000) requestAnimationFrame(f);
    else { if(scroll) window.scrollTo(0,0);
      res({fps:+(n/((t-t0)/1000)).toFixed(1), worst_ms:Math.round(worst)}); } }
  requestAnimationFrame(f);
})"""
idle = ev('(' + FPS + ')(false)')
scroll = ev('(' + FPS + ')(true)')
check('FPS idle >= 50', idle['fps'] >= 50, idle)
check('FPS scroll >= 40', scroll['fps'] >= 40, scroll)

# screenshots
for path, name in [('/dashboard', 'all-dashboard'), ('/measurements', 'all-measurements'), ('/gallery', 'all-gallery'), ('/nutrition', 'all-nutrition'), ('/templates', 'all-templates')]:
    go(path, 2.2)
    shot = raw('Page.captureScreenshot', {'format': 'png'})
    open('dev/%s.png' % name, 'wb').write(base64.b64decode(shot['data']))
print('screenshots saved', flush=True)

# errors
time.sleep(0.5)
ws.settimeout(0.6)
try:
    while True:
        EVENTS.append(json.loads(ws.recv()))
except Exception:
    pass
errs = []
for m in EVENTS:
    if m.get('method') == 'Log.entryAdded' and m['params']['entry'].get('level') == 'error':
        errs.append(m['params']['entry'].get('text', ''))
    elif m.get('method') == 'Runtime.exceptionThrown':
        d = m['params']['exceptionDetails']
        errs.append(d.get('text', '') + ' ' + str(d.get('exception', {}).get('description', ''))[:120])
errs = [e for e in errs if 'favicon' not in e.lower() and '401' not in e]
check('no page errors across sweep', len(errs) == 0, errs[:6])

print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}', flush=True)
ws.close()
sys.exit(1 if fails else 0)