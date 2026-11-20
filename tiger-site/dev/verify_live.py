# 线上验证：已发布的 tiger-减脂 Qoder Site（HTTPS）。
# 覆盖：静态根/SPA 路由/模型资产、health、鉴权门禁、注册登录会话、
# 体重写读往返、四张新表（测量/营养计划/模板/画廊）、虎教练 BYOK 错误路径。
# Windows 安全：urllib + 显式 utf-8 编码（避免 Git Bash curl 的 GBK 体）；
# 手动捕获 __Host- Secure Cookie；不安全方法带匹配 Origin 头。
import json
import ssl
import sys
import urllib.request
import urllib.error

HOST = "https://tiger-fatloss-7ryxdp3g07c.qoder.zone"
API = HOST + "/functions/v1/app"
ORIGIN = HOST
CTX = ssl.create_default_context()

results = []
cookie = None


def call(method, url, body=None, auth=False, origin=False, raw=False, headers=None):
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if origin:
        req.add_header("Origin", ORIGIN)
    if auth and cookie:
        req.add_header("Cookie", cookie)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
            payload = r.read()
            sc = r.headers.get_all("Set-Cookie") or []
            return r.status, dict(r.headers), payload, sc
    except urllib.error.HTTPError as e:
        payload = e.read()
        sc = e.headers.get_all("Set-Cookie") or []
        return e.code, dict(e.headers), payload, sc


def grab_cookie(sc):
    global cookie
    for c in sc:
        token = c.split(";", 1)[0].strip()
        if "app_auth.session=" in token and not token.endswith("="):
            cookie = token
            return True
    return False


def jbody(payload):
    try:
        return json.loads(payload.decode("utf-8"))
    except Exception:
        return {}


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ("  | " + detail if detail else ""))


def main():
    import random
    suffix = random.randint(100000, 999999)
    username = f"live{suffix}"
    password = "Passw0rd!live2026"  # >= PASSWORD_MIN_CHARS(15)

    # 1. 静态根
    st, hd, pl, _ = call("GET", HOST + "/")
    text = pl.decode("utf-8", "replace")
    check("static root 200", st == 200, f"status={st}")
    check("root is SPA shell", ('id="root"' in text) or ("tiger" in text), f"len={len(pl)}")

    # 2. SPA 深路由回退（/nutrition 应返回 index.html；导航请求需 Accept: text/html）
    st, hd, pl, _ = call("GET", HOST + "/nutrition", headers={"Accept": "text/html"})
    check("SPA route /nutrition 200", st == 200, f"status={st}")

    # 3. health 公开
    st, hd, pl, _ = call("GET", API + "/api/health")
    check("health 200 ok", st == 200 and jbody(pl).get("ok") is True, f"status={st} body={pl[:60]!r}")

    # 4. 受保护路由未登录 401
    st, hd, pl, _ = call("GET", API + "/api/weight")
    check("protected weight 401", st == 401, f"status={st} code={jbody(pl).get('error') or jbody(pl).get('code')}")

    # 5. 注册（写库 + 会话）
    st, hd, pl, sc = call("POST", API + "/api/register", {"username": username, "password": password}, origin=True)
    grab_cookie(sc)
    check("register 2xx", st in (200, 201), f"status={st} user={username} body={pl[:120]!r}")

    # 6. 登录（若注册未带会话）
    if not cookie:
        st, hd, pl, sc = call("POST", API + "/api/login", {"username": username, "password": password}, origin=True)
        grab_cookie(sc)
        check("login 2xx + cookie", st in (200, 201) and cookie is not None, f"status={st}")
    else:
        check("session cookie from register", cookie is not None, "captured")

    # 7. /api/me 会话有效
    st, hd, pl, _ = call("GET", API + "/api/me", auth=True)
    me = jbody(pl).get("user", {})
    check("me 200 + username", st == 200 and me.get("username") == username, f"status={st} user={me.get('username')}")

    # 8. 体重写入
    st, hd, pl, _ = call("PUT", API + "/api/weight", {"entry_date": "2026-11-21", "weight_kg": 72.5, "note": "live"}, auth=True, origin=True)
    check("weight PUT 2xx", st in (200, 201), f"status={st}")

    # 9. 体重读回（证明写读往返）
    st, hd, pl, _ = call("GET", API + "/api/weight", auth=True)
    wj = jbody(pl)
    if isinstance(wj, list):
        wlist = wj
    else:
        wlist = wj.get("entries") or wj.get("weights") or []
    found = any(str(e.get("weight_kg")) in ("72.5", "72.50") for e in wlist) if isinstance(wlist, list) else False
    check("weight read-back 72.5", st == 200 and found, f"status={st} n={len(wlist) if isinstance(wlist, list) else '?'}")

    # 10. 偏好（新表读）
    st, hd, pl, _ = call("GET", API + "/api/preferences", auth=True)
    check("preferences GET 200", st == 200, f"status={st}")

    # 11. 测量类别写 + 读（新表）
    st, hd, pl, _ = call("POST", API + "/api/measurements/categories", {"name": "腰围", "unit": "cm"}, auth=True, origin=True)
    check("measurement category POST 201", st == 201, f"status={st}")
    st, hd, pl, _ = call("GET", API + "/api/measurements/categories", auth=True)
    check("measurement categories GET 200", st == 200 and "腰围" in pl.decode("utf-8", "replace"), f"status={st}")

    # 12. 营养计划写 + 读（新表）
    st, hd, pl, _ = call("POST", API + "/api/nutrition-plans", {"name": "减脂餐", "kcal_target": 1800}, auth=True, origin=True)
    check("nutrition plan POST 201", st == 201, f"status={st}")
    st, hd, pl, _ = call("GET", API + "/api/nutrition-plans", auth=True)
    check("nutrition plans GET 200", st == 200, f"status={st}")

    # 13. 模板（新表读）
    st, hd, pl, _ = call("GET", API + "/api/templates", auth=True)
    check("templates GET 200", st == 200, f"status={st}")

    # 13b. 训练计划 join 读（plan_items limit 已修为 1000）
    st, hd, pl, _ = call("GET", API + "/api/plans", auth=True)
    check("plans GET 200 (join<=1000)", st == 200, f"status={st} body={pl[:60]!r}")

    # 13c. 测量记录 join 读（measurement_entries limit 已修为 1000）
    st, hd, pl, _ = call("GET", API + "/api/measurements/entries", auth=True)
    check("measurement entries GET 200 (<=1000)", st == 200, f"status={st} body={pl[:60]!r}")

    # 14. 画廊（新表读）
    st, hd, pl, _ = call("GET", API + "/api/gallery", auth=True)
    check("gallery GET 200", st == 200, f"status={st}")

    # 15. BYOK：缺密钥 400
    st, hd, pl, _ = call("POST", API + "/api/chat", {"message": "hi"}, auth=True, origin=True)
    check("coach no-key 400", st == 400 and "coach_key_required" in pl.decode("utf-8", "replace"), f"status={st}")

    # 16. BYOK：非法格式 400
    st, hd, pl, _ = call("POST", API + "/api/chat", {"message": "hi", "apiKey": "bad"}, auth=True, origin=True)
    check("coach bad-key 400", st == 400 and "invalid_coach_key" in pl.decode("utf-8", "replace"), f"status={st}")

    # 17. BYOK：假密钥（格式合法）→ 上游拒绝 → 503 失败关闭（密钥不落库）
    st, hd, pl, _ = call("POST", API + "/api/chat", {"message": "hi", "apiKey": "sk-fake000000000000000000"}, auth=True, origin=True)
    check("coach fake-key 503 fail-closed", st == 503 and "coach_unavailable" in pl.decode("utf-8", "replace"), f"status={st}")

    # 18. 模型静态资产可达（Range 避免下载 34MB）
    st, hd, pl, _ = call("GET", HOST + "/models/food101.onnx", headers={"Range": "bytes=0-1023"})
    check("food101.onnx reachable", st in (200, 206), f"status={st} bytes={len(pl)}")

    # 19. 识餐标签数据可达
    st, hd, pl, _ = call("GET", HOST + "/data/food101.json")
    check("food101.json reachable", st == 200, f"status={st} bytes={len(pl)}")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\nRESULT: {passed}/{total} " + ("ALL PASS" if passed == total else "HAS FAILURES"))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())