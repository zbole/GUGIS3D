"""One large operation at a time on the 2 GiB demonstration server."""
import asyncio
import os


class ResourceBudget:
    def __init__(self, application):
        self.application = application
        self.lock = asyncio.Lock()
        self.waiting_reads = 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.application(scope, receive, send)
        path = scope.get('path', '')
        method = scope.get('method', 'GET')
        light = method in ('GET', 'HEAD', 'OPTIONS') and (
            path == '/health' or '/render/' in path or path.endswith('/schema'))
        if light:
            return await self.application(scope, receive, send)
        async def busy():
            body = '{"detail":"服务器正在处理另一项数据操作，请稍后重试；本次操作未执行。"}'.encode()
            await send({'type': 'http.response.start', 'status': 503, 'headers': [
                (b'content-type', b'application/json; charset=utf-8'),
                (b'content-length', str(len(body)).encode()), (b'retry-after', b'2'),
                (b'cache-control', b'no-store')]})
            return await send({'type': 'http.response.body', 'body': body})
        if self.lock.locked():
            if method not in ('GET', 'HEAD') or self.waiting_reads >= 2:
                return await busy()
            self.waiting_reads += 1
            try:
                await asyncio.wait_for(self.lock.acquire(), timeout=120)
            except asyncio.TimeoutError:
                return await busy()
            finally:
                self.waiting_reads -= 1
        else:
            await self.lock.acquire()
        task = asyncio.create_task(self.application(scope, receive, send))
        try:
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                # A disconnected client must not admit another large parser while
                # the shielded worker is still finishing the original operation.
                await asyncio.shield(task)
                raise
        finally:
            self.lock.release()


def application():
    from app.main import app
    from deploy.login import LoginGateway
    return LoginGateway(ResourceBudget(app), os.environ.get('GUGIS_LOGIN_HASH', ''),
                        os.environ.get('GUGIS_SESSION_KEY', ''))
