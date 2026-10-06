import asyncio
import unittest
from unittest.mock import patch
from deploy.server import ResourceBudget


class BudgetTests(unittest.IsolatedAsyncioTestCase):
    async def test_queued_read_timeout_rejects_without_releasing_another_operation(self):
        async def app(scope, receive, send):
            self.fail('A timed-out read must not start the application')
        guarded = ResourceBudget(app)
        await guarded.lock.acquire()
        original_wait = asyncio.wait_for
        async def short_wait(awaitable, timeout):
            return await original_wait(awaitable, timeout=0.01)
        output = []
        async def send(value): output.append(value)
        with patch('deploy.server.asyncio.wait_for', short_wait):
            await guarded({'type': 'http', 'path': '/city/current', 'method': 'GET'}, None, send)
        self.assertEqual(output[0]['status'], 503)
        self.assertEqual(guarded.waiting_reads, 0)
        self.assertTrue(guarded.lock.locked())
        guarded.lock.release()

    async def test_busy_request_never_reads_body_or_runs_mutation_and_health_stays_available(self):
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []
        async def app(scope, receive, send):
            calls.append(scope['path'])
            if scope['path'] == '/city/current':
                entered.set()
                await release.wait()
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'ok'})
        guarded = ResourceBudget(app)
        async def no_body():
            self.fail('Rejected mutation must not read or parse its body')
        out = []
        async def send(value): out.append(value)
        first = asyncio.create_task(guarded({'type': 'http', 'path': '/city/current', 'method': 'GET'}, no_body, send))
        await entered.wait()
        await guarded({'type': 'http', 'path': '/city/current', 'method': 'POST'}, no_body, send)
        self.assertEqual(out[-2]['status'], 503)
        self.assertIn((b'retry-after', b'2'), out[-2]['headers'])
        await guarded({'type': 'http', 'path': '/health', 'method': 'GET'}, no_body, send)
        await guarded({'type': 'http', 'path': '/cities/exeter/render/x/tiles/0-0', 'method': 'GET'}, no_body, send)
        self.assertEqual(calls.count('/city/current'), 1)
        release.set()
        await first
        self.assertFalse(guarded.lock.locked())

    async def test_cancelled_client_cannot_admit_another_parser_until_original_finishes(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def app(scope, receive, send): entered.set(); await release.wait()
        guarded = ResourceBudget(app)
        async def receive(): return {'type': 'http.disconnect'}
        out = []
        async def send(v): out.append(v)
        first = asyncio.create_task(guarded({'type': 'http', 'path': '/city/validate', 'method': 'POST'}, receive, send))
        await entered.wait()
        first.cancel()
        await asyncio.sleep(0)
        await guarded({'type': 'http', 'path': '/city/current', 'method': 'POST'}, receive, send)
        self.assertEqual(out[0]['status'], 503)
        release.set()
        with self.assertRaises(asyncio.CancelledError): await first
        self.assertFalse(guarded.lock.locked())

    async def test_failed_operation_releases_budget(self):
        async def app(scope, receive, send): raise RuntimeError('Invalid input')
        guarded = ResourceBudget(app)
        with self.assertRaises(RuntimeError): await guarded({'type': 'http', 'path': '/city/validate'}, None, None)
        self.assertFalse(guarded.lock.locked())

    async def test_parallel_initial_reads_queue_with_a_finite_limit_and_execute_serially(self):
        entered, release = asyncio.Event(), asyncio.Event()
        active, maximum = 0, 0
        async def app(scope, receive, send):
            nonlocal active, maximum
            active += 1; maximum = max(maximum, active)
            entered.set(); await release.wait(); active -= 1
        guarded = ResourceBudget(app)
        async def receive(): self.fail('Test request body is not needed')
        output = []
        async def send(value): output.append(value)
        scope = {'type': 'http', 'path': '/city/current', 'method': 'GET'}
        first = asyncio.create_task(guarded(scope, receive, send)); await entered.wait()
        second = asyncio.create_task(guarded(scope, receive, send))
        third = asyncio.create_task(guarded(scope, receive, send))
        await asyncio.sleep(0)
        self.assertEqual(guarded.waiting_reads, 2)
        await guarded(scope, receive, send)
        self.assertEqual(output[0]['status'], 503)
        release.set(); await asyncio.gather(first, second, third)
        self.assertEqual(maximum, 1)
        self.assertEqual(guarded.waiting_reads, 0)
        self.assertFalse(guarded.lock.locked())


if __name__ == '__main__': unittest.main()
