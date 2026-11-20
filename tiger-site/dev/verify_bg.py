"""Verify the restored tiger-site background in a REAL visible Edge (CDP 9222).

The in-app browser viewport is hidden, so Granim's isPausedWhenNotInView pauses
the nebula there. This drives a separate visible Edge profile to confirm the
nebula actually paints, captures a screenshot, and measures FPS (no regression).
Throwaway account is registered through the UI; no real credentials are used.
"""
import base64, json, subprocess, time, urllib.request, random, string, sys
import websocket

PORT = 9222
BASE = 'http://127.0.0.1:5173'
OUT = 'dev/bg-real.png'


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
                    '--new-window', BASE + '/register'])
    time.sleep(7)

p = pages()
if not p:
    raise SystemExit('FAIL: no debuggable 5173 page (Edge did not open?)')

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


def ev(expr):
    r = raw('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'])
    return r['result'].get('value')


raw('Runtime.enable'); raw('Page.enable')
raw('Page.bringToFront')
raw('Page.navigate', {'url': BASE + '/register'})
time.sleep(3)

user = 'bgverify' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
pw = 'tiger-bg-verify-passphrase-2026'
fill = """(() => {
  const set = (id, v) => { const el = document.getElementById(id); if(!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); return true; };
  const ok = set('username', %s) && set('password', %s) && set('confirm', %s);
  const f = document.querySelector('form'); if (f && ok) f.requestSubmit();
  return ok && !!f;
})()""" % (json.dumps(user), json.dumps(pw), json.dumps(pw))
print('register submitted:', ev(fill), 'user:', user, flush=True)

# wait for auto-login -> Dashboard with background
ok = False
for _ in range(30):
    time.sleep(0.5)
    st = ev("JSON.stringify({path:location.pathname, neb:!!document.querySelector('#tigerNebula')})")
    st = json.loads(st)
    if st['path'] == '/dashboard' and st['neb']:
        ok = True
        break
print('reached dashboard:', ok, flush=True)
if not ok:
    print('STATE:', ev("document.body.innerText.slice(0,200)"), flush=True)

time.sleep(4)  # let Granim/particles paint in the visible viewport

inv = ev("""(() => {
  const neb = document.querySelector('#tigerNebula');
  let nebPaint = {pct:0, center:[0,0,0,0]};
  if (neb) { const ctx = neb.getContext('2d');
    const d = ctx.getImageData(0,0,neb.width,neb.height).data; let n=0;
    for(let i=0;i<d.length;i+=4){ if(d[i]>8||d[i+1]>8||d[i+2]>8) n++; }
    const c = ctx.getImageData(neb.width>>1, neb.height>>1,1,1).data;
    nebPaint = {pct: Math.round(100*n/(neb.width*neb.height)), center:[c[0],c[1],c[2],c[3]], w:neb.width, h:neb.height}; }
  const emb = document.querySelector('#tigerEmbers canvas'); let embN=0;
  if (emb){ const d=emb.getContext('2d').getImageData(0,0,emb.width,emb.height).data;
    for(let i=3;i<d.length;i+=4){ if(d[i]>0) embN++; } }
  const sky = document.querySelector('night-sky');
  const stars = sky && sky.shadowRoot ? sky.shadowRoot.querySelectorAll('[id^=star_]').length : 0;
  const b=getComputedStyle(document.documentElement,'::before'), a=getComputedStyle(document.documentElement,'::after');
  return JSON.stringify({ vis:document.visibilityState, vp:[innerWidth,innerHeight], dpr:devicePixelRatio,
    nebula:nebPaint, emberPixels:embN, starLayers:stars,
    aurora:[b.animationName,a.animationName],
    watermark:getComputedStyle(document.body,'::before').backgroundImage.slice(0,50),
    baseGradients:(getComputedStyle(document.documentElement).backgroundImage.match(/gradient/g)||[]).length,
    backTop:!!document.querySelector('.tiger-back-top') });
})()""")
print('INVENTORY:', inv, flush=True)

shot = raw('Page.captureScreenshot', {'format': 'png'})
with open(OUT, 'wb') as f:
    f.write(base64.b64decode(shot['data']))
print('screenshot saved:', OUT, flush=True)

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
print('FPS idle:', ev('(' + FPS + ')(false)'), flush=True)
print('FPS scroll:', ev('(' + FPS + ')(true)'), flush=True)
print('DONE', flush=True)
ws.close()