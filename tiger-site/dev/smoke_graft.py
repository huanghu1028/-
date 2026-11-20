"""Smoke-test the grafted backend routes against the local harness (8002).

ASCII payloads only (Windows curl GBK pitfall avoided by using urllib + utf-8).
Uses a cookie jar for the app session. Prints PASS/FAIL per step; exit 1 on any fail.
"""
import json, sys, time, random, string, urllib.request, http.cookiejar

BASE = 'http://127.0.0.1:8002/functions/v1/app'
SESSION = '__Host-app_auth.session'
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
fails = []
# Secure cookie is not replayed by cookiejar over plain http; carry it manually.
COOKIE = None


def capture(headers):
    global COOKIE
    for c in (headers.get_all('Set-Cookie') or []):
        if c.startswith(SESSION + '='):
            pair = c.split(';')[0]
            if pair.split('=', 1)[1]:
                COOKIE = pair


def req(method, path, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header('content-type', 'application/json')
    r.add_header('origin', 'https://tiger-local.dev')
    if COOKIE:
        r.add_header('Cookie', COOKIE)
    try:
        with op.open(r, timeout=15) as resp:
            capture(resp.headers)
            return resp.status, json.loads(resp.read().decode('utf-8') or 'null')
    except urllib.error.HTTPError as e:
        capture(e.headers)
        try:
            return e.code, json.loads(e.read().decode('utf-8') or 'null')
        except Exception:
            return e.code, None


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


s, b = req('GET', '/api/health')
check('health', s == 200 and b and b.get('ok'), s)

user = 'graft' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
s, b = req('POST', '/api/register', {'username': user, 'password': 'graft-smoke-passphrase-2026'})
check('register', s == 201 and b.get('user'), s)

# measurements
s, cat = req('POST', '/api/measurements/categories', {'name': 'Waist', 'unit': 'cm'})
check('meas category create', s == 201 and cat.get('id'), s)
cid = cat.get('id')
s, ent = req('POST', '/api/measurements/entries', {'category_id': cid, 'entry_date': '2026-11-21', 'value': 80.5, 'note': ''})
check('meas entry create', s == 201 and ent.get('id'), s)
s, lst = req('GET', '/api/measurements/entries?category=' + cid)
check('meas entries list', s == 200 and isinstance(lst, list) and len(lst) == 1, s)
s, cats = req('GET', '/api/measurements/categories')
check('meas categories list', s == 200 and len(cats) == 1, s)

# gallery (1x1 png)
png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
s, img = req('POST', '/api/gallery', {'entry_date': '2026-11-21', 'caption': 'front', 'data_url': png})
check('gallery create', s == 201 and img.get('id'), s)
s, gal = req('GET', '/api/gallery')
check('gallery list', s == 200 and len(gal) == 1 and gal[0]['data_url'].startswith('data:image/'), s)
s, bad = req('POST', '/api/gallery', {'entry_date': '2026-11-21', 'caption': '', 'data_url': 'data:text/html;base64,xx'})
check('gallery rejects non-image', s == 400, s)

# nutrition plan -> meal -> item
s, np = req('POST', '/api/nutrition-plans', {'name': 'Cut', 'description': '', 'kcal_target': 1800, 'protein_target': 140, 'carb_target': 180, 'fat_target': 60})
check('nutrition plan create', s == 201 and np.get('id'), s)
npid = np.get('id')
s, meal = req('POST', f'/api/nutrition-plans/{npid}/meals', {'meal': 'breakfast', 'name': 'Morning'})
check('nutrition meal create', s == 201 and meal.get('id'), s)
mid = meal.get('id')
s, item = req('POST', f'/api/nutrition-meals/{mid}/items', {'food_name': 'Oats', 'grams': 60, 'kcal': 230, 'protein': 8, 'fat': 4, 'carb': 40})
check('nutrition item create', s == 201 and item.get('id'), s)
s, nps = req('GET', '/api/nutrition-plans')
check('nutrition assemble', s == 200 and len(nps) == 1 and len(nps[0]['meals']) == 1 and len(nps[0]['meals'][0]['items']) == 1, s)

# plan + meta(template/public) + templates + copy
s, plan = req('POST', '/api/plans', {'name': 'Base', 'goal': 'strength'})
check('plan create', s == 201 and plan.get('id'), s)
pid = plan.get('id')
s, day = req('POST', f'/api/plans/{pid}/days', {'name': 'Day A', 'day_index': 0})
check('plan day create', s == 201 and day.get('id'), s)
did = day.get('id')
s, it = req('POST', f'/api/days/{did}/items', {'exercise_id': 1, 'sets': 3, 'reps': 10, 'weight': 20})
check('plan item create', s == 201 and it.get('id'), s)
iid = it.get('id')
s, meta0 = req('GET', f'/api/plans/{pid}/meta')
check('plan meta get empty', s == 200 and meta0.get('meta') is None, s)
s, meta = req('PATCH', f'/api/plans/{pid}/meta', {
    'is_template': True, 'is_public': True,
    'day_extras': {did: {'day_type': 'tabata', 'rounds': 8, 'work_sec': 20, 'rest_sec': 10}},
    'item_extras': {iid: {'set_type': 'drop', 'superset_group': None, 'rpe': 8}},
})
check('plan meta patch', s == 200 and meta.get('is_template') is True and meta.get('is_public') is True, s)
s, meta1 = req('GET', f'/api/plans/{pid}/meta')
check('plan meta get roundtrip', s == 200 and meta1['meta']['day_extras'][did]['day_type'] == 'tabata'
      and meta1['meta']['item_extras'][iid]['set_type'] == 'drop', s)
s, tpls = req('GET', '/api/templates')
check('templates list own', s == 200 and any(t['id'] == pid and t['is_mine'] for t in tpls), s)
s, copied = req('POST', f'/api/templates/{pid}/copy')
check('template copy', s == 201 and copied.get('id') and copied['id'] != pid, s)
cpid = copied.get('id')
s, cmeta = req('GET', f'/api/plans/{cpid}/meta')
cday = copied['days'][0]['id'] if copied.get('days') else None
check('copy carries remapped extras', s == 200 and cmeta.get('meta') is not None and cday
      and cmeta['meta']['day_extras'].get(cday, {}).get('day_type') == 'tabata'
      and cmeta['meta']['is_public'] is False and len(cmeta['meta']['item_extras']) == 1, s)

# preferences
s, pr = req('PUT', '/api/preferences', {'weight_unit': 'lb', 'timezone': 'Asia/Shanghai', 'dashboard_layout': ['weight', 'logs']})
check('prefs put', s == 200 and pr['preferences']['weight_unit'] == 'lb', s)
s, pr2 = req('GET', '/api/preferences')
check('prefs get', s == 200 and pr2['preferences']['dashboard_layout'] == ['weight', 'logs'], s)
s, badp = req('PUT', '/api/preferences', {'weight_unit': 'stone', 'timezone': 'x', 'dashboard_layout': []})
check('prefs rejects bad unit', s == 400, s)

# owner isolation: a second user must NOT see first user's data
op2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
u2 = 'graft' + ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
r = urllib.request.Request(BASE + '/api/register', data=json.dumps({'username': u2, 'password': 'graft-smoke-passphrase-2026'}).encode(), method='POST')
r.add_header('content-type', 'application/json'); r.add_header('origin', 'https://tiger-local.dev')
with op2.open(r, timeout=15) as resp:
    sc = resp.headers.get_all('Set-Cookie') or []
    cookie2 = next((c.split(';')[0] for c in sc if c.startswith(SESSION + '=') and c.split(';')[0].split('=', 1)[1]), None)


def req2(path):
    r = urllib.request.Request(BASE + path, method='GET')
    r.add_header('origin', 'https://tiger-local.dev')
    if cookie2:
        r.add_header('Cookie', cookie2)
    with op2.open(r, timeout=15) as resp:
        return json.loads(resp.read().decode())


other = req2('/api/measurements/categories')
check('owner isolation categories', isinstance(other, list) and len(other) == 0, len(other))
ot = req2('/api/templates')
check('public template visible cross-owner', any(t['id'] == pid and not t['is_mine'] for t in ot), len(ot))

print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAIL: {fails}', flush=True)
sys.exit(1 if fails else 0)