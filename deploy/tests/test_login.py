import hashlib
import unittest
from deploy.login import COOKIE, ORIGIN, LoginGateway


class LoginTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls = []
        async def app(scope, receive, send): self.calls.append(scope['path'])
        self.gateway = LoginGateway(app, hashlib.sha256(b'test-password').hexdigest(), 'a'*64)

    async def request(self, path, method='GET', body=b'', headers=()):
        out = []
        async def receive(): return {'type': 'http.request', 'body': body, 'more_body': False}
        async def send(event): out.append(event)
        await self.gateway({'type': 'http', 'path': path, 'method': method, 'headers': headers}, receive, send)
        return out

    async def test_password_login_sets_secure_signed_cookie_and_tampering_is_rejected(self):
        out = await self.request('/login', 'POST', b'username=gugis&password=test-password',
            [(b'content-type', b'application/x-www-form-urlencoded'), (b'origin', ORIGIN.encode())])
        self.assertEqual(out[0]['status'], 303)
        cookie = dict(out[0]['headers'])[b'set-cookie']
        for flag in (b'Secure', b'HttpOnly', b'SameSite=Lax', b'Max-Age=28800'): self.assertIn(flag, cookie)
        self.assertNotIn(b'test-password', cookie)
        cookie = cookie.split(b';')[0]
        self.assertEqual((await self.request('/_auth/check', headers=[(b'cookie', cookie)]))[0]['status'], 204)
        altered = cookie[:-1]+(b'0' if cookie[-1:]!=b'0' else b'1')
        self.assertEqual((await self.request('/_auth/check', headers=[(b'cookie', altered)]))[0]['status'], 401)
        await self.request('/cities/exeter/render/manifest', headers=[(b'cookie', cookie)])
        self.assertIn('/cities/exeter/render/manifest', self.calls)

    async def test_other_port_cannot_login_or_write_and_unauthorized_requests_never_reach_app(self):
        self.assertEqual((await self.request('/city/current'))[0]['status'], 401)
        self.assertEqual((await self.request('/login', 'POST', headers=[(b'origin', b'https://123.56.47.218')]))[0]['status'], 403)
        cookie = (COOKIE+'='+self.gateway.signed_cookie()).encode()
        out = await self.request('/city/current', 'POST', headers=[(b'cookie', cookie),
            (b'origin', b'https://123.56.47.218')])
        self.assertEqual(out[0]['status'], 403)
        self.assertEqual(self.calls, [])

    async def test_bad_password_duplicate_fields_and_oversized_form_are_rejected(self):
        headers = [(b'content-type', b'application/x-www-form-urlencoded')]
        for body in (b'username=gugis&password=wrong', b'username=gugis&password=test-password&password=other'):
            self.assertEqual((await self.request('/login', 'POST', body, headers))[0]['status'], 401)
        self.assertEqual((await self.request('/login', 'POST', b'x'*4097, headers))[0]['status'], 413)
        self.assertEqual(self.calls, [])


if __name__ == '__main__': unittest.main()
