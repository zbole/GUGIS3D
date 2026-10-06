"""Small HTTPS login gateway for the shared demonstration server."""
import hashlib
import hmac
import html
from http.cookies import SimpleCookie
import re
import secrets
import time
from urllib.parse import parse_qs

COOKIE = 'gugis_demo_session'
ORIGIN = 'https://123.56.47.218:8443'


class LoginGateway:
    def __init__(self, app, password_hash, signing_key):
        if not re.fullmatch('[0-9a-f]{64}', password_hash) or not re.fullmatch('[0-9a-f]{64}', signing_key):
            raise ValueError('A separate website password hash and session key are required')
        self.app, self.password_hash, self.key = app, password_hash, bytes.fromhex(signing_key)

    def signed_cookie(self):
        payload = str(int(time.time())+28800)+'.'+secrets.token_hex(16)
        return payload+'.'+hmac.new(self.key, payload.encode(), 'sha256').hexdigest()

    def authorized(self, headers):
        try:
            cookies = SimpleCookie()
            cookies.load(headers.get(b'cookie', b'').decode('ascii'))
            value = cookies[COOKIE].value
            expiry, nonce, signature = value.split('.')
            if not re.fullmatch('[0-9a-f]{32}', nonce) or not re.fullmatch('[0-9a-f]{64}', signature):
                return False
            seconds = int(expiry)-time.time()
            expected = hmac.new(self.key, (expiry+'.'+nonce).encode(), 'sha256').hexdigest()
            return 0 < seconds <= 28801 and hmac.compare_digest(signature, expected)
        except (ValueError, KeyError, UnicodeError):
            return False

    async def reply(self, send, status, body=b'', headers=()):
        await send({'type': 'http.response.start', 'status': status, 'headers': [
            (b'content-type', b'text/html; charset=utf-8'), (b'cache-control', b'no-store'),
            (b'content-length', str(len(body)).encode()), *headers]})
        await send({'type': 'http.response.body', 'body': body})

    def page(self, error=''):
        return ('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GUGIS3D · 网站登录</title>
<style>body{margin:0;background:#f4f6f3;color:#203d33;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{background:white;width:min(360px,80vw);padding:36px;border:1px solid #dce5df;border-radius:20px}h1{font-size:32px;letter-spacing:-1px;margin:12px 0}p{color:#657b70;line-height:1.7}label{display:block;margin:20px 0 8px}input{box-sizing:border-box;width:100%;padding:13px;font:inherit;border:1px solid #cbd8d0;border-radius:9px}button{width:100%;margin-top:24px;border:0;border-radius:9px;padding:14px;background:#235d4a;color:white;font:inherit;cursor:pointer}.error{color:#a13e31}</style>
<main><span>GUGIS · 3D CITY WORKSPACE</span><h1>探索城市的结构。</h1><p>登录后查看英国城市、直纹面带地形和可复核的研究结果。</p><form method="post" action="/login"><label for="username">用户名</label><input id="username" name="username" autocomplete="username" value="gugis" required><label for="password">网站访问口令</label><input id="password" name="password" type="password" autocomplete="current-password" required><p class="error" role="alert">'''+html.escape(error)+'''</p><button type="submit">进入 GUGIS3D</button></form></main></html>''').encode()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path, method = scope.get('path', ''), scope.get('method', 'GET')
        headers = {k.lower(): v for k, v in scope.get('headers', [])}
        if path == '/health':
            return await self.app(scope, receive, send)
        if path == '/login':
            if method == 'GET':
                return await self.reply(send, 200, self.page())
            if method != 'POST' or headers.get(b'origin', ORIGIN.encode()) != ORIGIN.encode():
                return await self.reply(send, 403, self.page('请从本站登录。'))
            if not headers.get(b'content-type', b'').startswith(b'application/x-www-form-urlencoded'):
                return await self.reply(send, 415, self.page('登录请求格式无效。'))
            data = bytearray()
            while True:
                event = await receive()
                if event['type'] == 'http.disconnect': return
                data.extend(event.get('body', b''))
                if len(data)>4096: return await self.reply(send, 413, self.page('登录信息过长。'))
                if not event.get('more_body'): break
            try: fields = parse_qs(data.decode('utf-8'), max_num_fields=4)
            except (ValueError, UnicodeError): return await self.reply(send, 400, self.page('登录信息无效。'))
            password = fields.get('password', [])
            username = fields.get('username', [])
            if (username != ['gugis'] or len(password)!=1 or
                    not hmac.compare_digest(hashlib.sha256(password[0].encode()).hexdigest(), self.password_hash)):
                return await self.reply(send, 401, self.page('用户名或网站访问口令不正确。'))
            cookie = (COOKIE+'='+self.signed_cookie()+'; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax').encode()
            return await self.reply(send, 303, headers=[(b'location', b'/'), (b'set-cookie', cookie)])
        if not self.authorized(headers):
            return await self.reply(send, 401)
        # Cookies are shared across ports. Explicit Origin checks also isolate
        # writes from the other application hosted at the same public IP.
        if method not in ('GET','HEAD','OPTIONS') and headers.get(b'origin', ORIGIN.encode()) != ORIGIN.encode():
            return await self.reply(send, 403)
        if path == '/_auth/check':
            return await self.reply(send, 204)
        return await self.app(scope, receive, send)
