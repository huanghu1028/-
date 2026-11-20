"""Verify #66 (preferences / configurable dashboard / export / print) in a REAL
visible Edge via CDP 9222. Registers a throwaway user, seeds one weight + one
workout log, drives the Settings UI (Radix Select via real mouse events,
Checkbox/Button via DOM click), saves, then asserts the Dashboard reflects the
new unit / timezone / widget layout. Captures export blobs in-page (stubbing
createObjectURL + download-anchor click) and checks print CSS via emulated media.
No real credentials are used. Prints PASS/FAIL per step; exit 1 on any fail.
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
        EVENTS.append(msg)


def ev(expr):
    r = raw('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})
    if 'exceptionDetails' in r:
        raise RuntimeError(r['exceptionDetails'])
    return r['result'].get('value')


def mouse(x, y):
    raw('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': x, 'y': y})
    raw('Input.dispatchMouseEvent', {'type': 'mousePressed', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})
    raw('Input.dispatchMouseEvent', {'type': 'mouseReleased', 'x': x, 'y': y, 'button': 'left', 'clickCount': 1})


def box(sel):
    return ev("(()=>{const el=document.querySelector(%s); if(!el) return null;"
              "el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();"
              "return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};})()" % json.dumps(sel))


def click_sel(sel):
    b = box(sel)
    if not b or b['w'] == 0:
        return False
    mouse(b['x'], b['y'])
    return True


def click_option(text):
    b = ev("(()=>{const els=[...document.querySelectorAll('[role=option]')];"
           "const el=els.find(e=>e.textContent.includes(%s)); if(!el) return null;"
           "el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();"
           "return {x:r.x+r.width/2,y:r.y+r.height/2};})()" % json.dumps(text))
    if not b:
        return False
    mouse(b['x'], b['y'])
    return True


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


def wait_path(path, tries=40):
    for _ in range(tries):
        time.sleep(0.4)
        if ev("location.pathname") == path:
            return True
    return False


raw('Runtime.enable'); raw('Page.enable'); raw('Log.enable'); raw('Network.enable')
raw('Network.clearBrowserCookies')
raw('Page.bringToFront')
raw('Page.navigate', {'url': BASE + '/register'})
time.sleep(3)

user = 'setverify' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
pw = 'tiger-settings-verify-passphrase-2026'
fill = """(() => {
  const set = (id, v) => { const el = document.getElementById(id); if(!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); return true; };
  const ok = set('username', %s) && set('password', %s) && set('confirm', %s);
  const f = document.querySelector('form'); if (f && ok) f.requestSubmit();
  return ok && !!f;
})()""" % (json.dumps(user), json.dumps(pw), json.dumps(pw))
print('register submitted:', ev(fill), 'user:', user, flush=True)
check('register -> dashboard', wait_path('/dashboard'))

# seed one weight + one log so exports are non-empty
seed = ev("""(async()=>{
  const d=new Date(); const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const h={'content-type':'application/json'};
  const w=await fetch('/functions/v1/app/api/weight',{method:'PUT',credentials:'include',headers:h,body:JSON.stringify({entry_date:ds,weight_kg:72.5,note:'seed'})});
  const l=await fetch('/functions/v1/app/api/logs',{method:'POST',credentials:'include',headers:h,body:JSON.stringify({log_date:ds,plan_name:'Seed',day_name:'Day A',detail:[{exercise_id:1,name:'Bench',sets:3,reps:10,weight:20,done_sets:3}],duration_min:30,note:''})});
  return JSON.stringify({ds,w:w.status,l:l.status});
})()""")
seed = json.loads(seed)
check('seed weight+log', seed['w'] in (200, 201) and seed['l'] in (200, 201), seed)

# ---- Settings UI ----
raw('Page.navigate', {'url': BASE + '/settings'})
time.sleep(2.5)
check('settings renders', ev("document.querySelector('h1')?.textContent.includes('偏好设置')") is True)
ncomb = ev("document.querySelectorAll('[role=combobox]').length")
nchk = ev("document.querySelectorAll('[role=checkbox]').length")
check('settings has 2 selects + 6 widget checkboxes', ncomb == 2 and nchk == 6, {'combobox': ncomb, 'checkbox': nchk})
default_checked = ev("[...document.querySelectorAll('[role=checkbox]')].map(c=>c.getAttribute('data-state'))")
check('default layout = first 4 checked', default_checked == ['checked', 'checked', 'checked', 'checked', 'unchecked', 'unchecked'], default_checked)

# unit -> lb (first combobox)
click_sel("[role=combobox]")
time.sleep(0.5)
check('unit option lb clicked', click_option('磅 lb'))
time.sleep(0.4)
unit_txt = ev("document.querySelectorAll('[role=combobox]')[0].textContent")
check('unit select shows lb', 'lb' in (unit_txt or ''), unit_txt)

# timezone -> Asia/Tokyo (second combobox)
click_sel_all = ev("(()=>{const els=document.querySelectorAll('[role=combobox]');const el=els[1];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
mouse(click_sel_all['x'], click_sel_all['y'])
time.sleep(0.5)
check('tz option Tokyo clicked', click_option('日本标准时间'))
time.sleep(0.4)
tz_txt = ev("document.querySelectorAll('[role=combobox]')[1].textContent")
check('tz select shows Tokyo', '日本' in (tz_txt or ''), tz_txt)

# add diet_today (index 4) + meas_latest (index 5)
ev("document.querySelectorAll('[role=checkbox]')[4].click()")
ev("document.querySelectorAll('[role=checkbox]')[5].click()")
time.sleep(0.3)
after_checked = ev("[...document.querySelectorAll('[role=checkbox]')].map(c=>c.getAttribute('data-state'))")
check('all 6 widgets checked', after_checked == ['checked'] * 6, after_checked)

# save
ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('保存偏好'))?.click()")
time.sleep(1.5)
saved_prefs = ev("(async()=>{const r=await fetch('/functions/v1/app/api/preferences',{credentials:'include'});const j=await r.json();return JSON.stringify(j.preferences);})()")
saved_prefs = json.loads(saved_prefs)
check('saved prefs unit=lb', saved_prefs.get('weight_unit') == 'lb', saved_prefs.get('weight_unit'))
check('saved prefs tz=Tokyo', saved_prefs.get('timezone') == 'Asia/Tokyo', saved_prefs.get('timezone'))
check('saved layout has 6 widgets', saved_prefs.get('dashboard_layout') == ['stats', 'weight', 'quick', 'logs', 'diet_today', 'meas_latest'], saved_prefs.get('dashboard_layout'))

# ---- Dashboard reflects prefs ----
raw('Page.navigate', {'url': BASE + '/dashboard'})
time.sleep(3)
order = ev("""(()=>{
  const root=document.querySelector('main .space-y-5'); if(!root) return [];
  const ids=[];
  for(const div of root.children){
    const t=div.textContent||'';
    if(t.includes('最新体重')&&t.includes('本周训练')) ids.push('stats');
    else if(t.includes('体重趋势')) ids.push('weight');
    else if(t.includes('快速开始')) ids.push('quick');
    else if(t.includes('最近打卡')) ids.push('logs');
    else if(t.includes('今日饮食')) ids.push('diet_today');
    else if(t.includes('最新围度')) ids.push('meas_latest');
  }
  return ids;
})()""")
check('dashboard widget order matches saved layout', order == ['stats', 'weight', 'quick', 'logs', 'diet_today', 'meas_latest'], order)
body = ev("document.body.innerText")
check('dashboard shows lb unit', 'lb' in body)
disp_today = ev("document.querySelector('main .space-y-5 p')?.textContent?.trim().split(' ')[0]")
expect_today = ev("new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())")
check('dashboard today uses Tokyo tz', disp_today == expect_today, {'shown': disp_today, 'tokyo': expect_today})

# ---- Export blob capture ----
ev("""(()=>{
  window.__blob=null; window.__name=null;
  const oc=URL.createObjectURL.bind(URL);
  URL.createObjectURL=(b)=>{window.__blob=b; return oc(b);};
  const oclick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){ if(this.download){window.__name=this.download; return;} return oclick.call(this); };
})()""")
raw('Page.navigate', {'url': BASE + '/settings'})
time.sleep(2.5)
# re-install stubs after navigation (page context reset)
ev("""(()=>{
  window.__blob=null; window.__name=null;
  const oc=URL.createObjectURL.bind(URL);
  URL.createObjectURL=(b)=>{window.__blob=b; return oc(b);};
  const oclick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){ if(this.download){window.__name=this.download; return;} return oclick.call(this); };
})()""")


def export_and_read(btn_text):
    ev("window.__blob=null; window.__name=null;")
    ev("[...document.querySelectorAll('button')].find(b=>b.textContent.includes(%s))?.click()" % json.dumps(btn_text))
    time.sleep(1.2)
    return ev("(async()=>{ if(!window.__blob) return JSON.stringify({name:window.__name,text:null}); const t=await window.__blob.text(); return JSON.stringify({name:window.__name,text:t}); })()")


w = json.loads(export_and_read('体重 CSV'))
check('weight CSV filename', (w['name'] or '').startswith('tiger-weight-') and w['name'].endswith('.csv'), w['name'])
check('weight CSV content (lb column + seed row)', w['text'] and 'weight_lb' in w['text'] and '72.5' in w['text'] and '159.84' in w['text'], (w['text'] or '')[:120])
lg = json.loads(export_and_read('训练记录 CSV'))
check('logs CSV content', lg['text'] and 'exercise_name' in lg['text'] and 'Bench' in lg['text'], (lg['text'] or '')[:120])
ic = json.loads(export_and_read('训练日历 iCal'))
check('iCal content', ic['text'] and 'BEGIN:VCALENDAR' in ic['text'] and 'BEGIN:VEVENT' in ic['text'] and 'Seed' in ic['text'], (ic['text'] or '')[:120])
check('iCal filename .ics', (ic['name'] or '').endswith('.ics'), ic['name'])

# ---- Print CSS ----
raw('Emulation.setEmulatedMedia', {'media': 'print'})
time.sleep(0.4)
pr = ev("""(()=>{const a=document.querySelector('aside');const m=document.querySelector('main');
  return JSON.stringify({aside:a?getComputedStyle(a).display:'none', mainMargin:m?getComputedStyle(m).marginLeft:'?', bodyBg:getComputedStyle(document.body).backgroundColor});})()""")
pr = json.loads(pr)
check('print hides sidebar', pr['aside'] == 'none', pr)
check('print main margin 0', pr['mainMargin'] == '0px', pr)
raw('Emulation.setEmulatedMedia', {'media': ''})

# ---- screenshots ----
raw('Page.navigate', {'url': BASE + '/settings'})
time.sleep(2.5)
shot = raw('Page.captureScreenshot', {'format': 'png'})
open('dev/settings-verify.png', 'wb').write(base64.b64decode(shot['data']))
raw('Page.navigate', {'url': BASE + '/dashboard'})
time.sleep(3)
shot = raw('Page.captureScreenshot', {'format': 'png'})
open('dev/dashboard-verify.png', 'wb').write(base64.b64decode(shot['data']))
print('screenshots: dev/settings-verify.png dev/dashboard-verify.png', flush=True)

# ---- page errors ----
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
check('no page errors', len(errs) == 0, errs[:5])

print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}', flush=True)
ws.close()
sys.exit(1 if fails else 0)