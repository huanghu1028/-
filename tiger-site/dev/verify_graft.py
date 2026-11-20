"""Verify the grafted client pages in a REAL visible Edge (CDP 9222).

Checks: anonymous '/' shows Landing (no app sidebar); register auto-login lands
on /dashboard; grouped sidebar nav; /calculators /foods /calendar render;
/exercises/1 shows muscle figure + analytics link; /exercises/1/analytics renders.
Collects page errors via CDP Log/Runtime events. Throwaway account only.
"""
import base64, json, subprocess, time, urllib.request, random, string, sys
import websocket

PORT = 9222
BASE = 'http://127.0.0.1:5173'


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
    raise SystemExit('FAIL: no debuggable 5173 page (Edge did not open?)')

ws = websocket.create_connection(p[-1]['webSocketDebuggerUrl'], timeout=90)
_id = [0]
errors = []


def raw(method, params=None):
    _id[0] += 1
    ws.send(json.dumps({'id': _id[0], 'method': method, 'params': params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get('method') == 'Log.entryAdded' and msg['params']['entry'].get('level') == 'error':
            errors.append(msg['params']['entry'].get('text', '')[:160])
        if msg.get('method') == 'Runtime.exceptionThrown':
            d = msg['params']['exceptionDetails']
            errors.append((d.get('exception', {}).get('description') or d.get('text', ''))[:160])
        if msg.get('id') == _id[0]:
            if 'error' in msg:
                raise RuntimeError(msg['error'])
            return msg.get('result', {})


def drain():
    ws.settimeout(0.15)
    try:
        while True:
            msg = json.loads(ws.recv())
            if msg.get('method') == 'Log.entryAdded' and msg['params']['entry'].get('level') == 'error':
                errors.append(msg['params']['entry'].get('text', '')[:160])
            if msg.get('method') == 'Runtime.exceptionThrown':
                d = msg['params']['exceptionDetails']
                errors.append((d.get('exception', {}).get('description') or d.get('text', ''))[:160])
    except websocket.WebSocketTimeoutException:
        pass
    finally:
        ws.settimeout(90)


def ev(expr):
    r = raw('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'])
    return r['result'].get('value')


def goto(path, wait=2.5):
    raw('Page.navigate', {'url': BASE + path})
    time.sleep(wait)
    drain()


def shot(name):
    data = raw('Page.captureScreenshot', {'format': 'png'})['data']
    with open('dev/' + name, 'wb') as f:
        f.write(base64.b64decode(data))
    print('screenshot:', name, flush=True)


fails = []


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ((' ' + str(extra)) if extra != '' else ''), flush=True)
    if not cond:
        fails.append(name)


raw('Runtime.enable'); raw('Page.enable'); raw('Log.enable'); raw('Network.enable')
raw('Page.bringToFront')
# start anonymous: clear any previous session in this Edge profile
raw('Network.clearBrowserCookies')
errors.clear()

# 1. anonymous landing
goto('/', 3)
st = json.loads(ev("JSON.stringify({path:location.pathname, h1:document.querySelector('h1')?.textContent||'', features:!!document.getElementById('features'), faq:!!document.getElementById('faq'), sidebar:!!document.querySelector('aside'), typed:!!document.getElementById('tigerTyped')})"))
check('anonymous / shows Landing', st['path'] == '/' and 'tiger' in st['h1'] and st['features'] and st['faq'] and not st['sidebar'], st)
shot('graft-landing.png')

# 2. register -> dashboard
goto('/register', 2)
user = 'graftui' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
pw = 'tiger-graft-ui-passphrase-2026'
fill = """(() => {
  const set = (id, v) => { const el = document.getElementById(id); if(!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); return true; };
  const ok = set('username', %s) && set('password', %s) && set('confirm', %s);
  const f = document.querySelector('form'); if (f && ok) f.requestSubmit();
  return ok && !!f;
})()""" % (json.dumps(user), json.dumps(pw), json.dumps(pw))
print('register submitted:', ev(fill), 'user:', user, flush=True)
ok = False
for _ in range(30):
    time.sleep(0.5)
    if ev('location.pathname') == '/dashboard':
        ok = True
        break
check('register auto-login -> /dashboard', ok, ev('location.pathname'))
time.sleep(2); drain()

nav = json.loads(ev("JSON.stringify({groups:[...document.querySelectorAll('aside nav > div > div:first-child')].map(e=>e.textContent), links:[...document.querySelectorAll('aside nav a')].map(a=>a.getAttribute('href')), neb:!!document.querySelector('#tigerNebula')})"))
check('sidebar groups', nav['groups'] == ['训练', '饮食与身体', '工具'], nav['groups'])
expect_links = ['/dashboard', '/exercises', '/plans', '/train', '/calendar', '/diet', '/foods', '/weight', '/calculators', '/coach']
check('sidebar links complete', nav['links'] == expect_links, nav['links'])
check('background still mounted', nav['neb'])
shot('graft-dashboard.png')

# 3. calculators
goto('/calculators', 2)
txt = ev("document.body.innerText")
check('calculators renders', 'BMI' in txt and ('TDEE' in txt or '每日能量' in txt or '代谢' in txt), txt[:60].replace('\n', ' '))

# 4. foods
goto('/foods', 3)
st = json.loads(ev("JSON.stringify({rows:document.querySelectorAll('table tbody tr').length, txt:document.body.innerText.slice(0,80)})"))
check('foods table populated', st['rows'] > 5, st)

# 5. calendar
goto('/calendar', 3)
st = json.loads(ev("JSON.stringify({hasGrid:!!document.querySelector('table, [class*=grid]'), txt:document.body.innerText.slice(0,120)})"))
check('calendar renders', st['hasGrid'] and ('月' in st['txt'] or '今天' in st['txt'] or '训练' in st['txt']), st)

# 6. exercise detail: muscle figure + analytics link
goto('/exercises/1', 3)
st = json.loads(ev("""JSON.stringify({
  muscleCard: document.body.innerText.includes('目标肌群'),
  figures: [...document.querySelectorAll('figure div[role=img]')].map(e=>e.style.backgroundImage.slice(0,30)),
  fallbackImgs: document.querySelectorAll('figure img').length,
  analyticsLink: !!document.querySelector('a[href="/exercises/1/analytics"]')
})"""))
check('muscle figure present', st['muscleCard'] and (len(st['figures']) > 0 or st['fallbackImgs'] > 0), st)
check('analytics link present', st['analyticsLink'])

# 7. exercise analytics page
goto('/exercises/1/analytics', 3)
txt = ev("document.body.innerText.slice(0,150)")
check('analytics renders', ('分析' in txt or '暂无' in txt or '记录' in txt), txt.replace('\n', ' '))

# 8. mobile bottom bar exists in DOM (hidden at desktop width but present)
mb = ev("!!document.querySelector('nav.fixed.bottom-0')")
check('mobile tab bar in DOM', mb)

drain()
real_errors = [e for e in errors if 'favicon' not in e.lower() and '401' not in e]
check('no page errors', len(real_errors) == 0, real_errors[:5])
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}', flush=True)
ws.close()
sys.exit(1 if fails else 0)