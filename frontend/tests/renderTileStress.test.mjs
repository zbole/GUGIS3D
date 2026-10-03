import test from "node:test";
import assert from "node:assert/strict";
import { chooseViewportTiles, renderTilesToCity, tileLoadingProfiles } from "../src/studio/renderTileClient.ts";
import { centerView, deferred, descriptorCount, hash, makeHarness, makeSyntheticFixture, rectangleView, verifyManifest } from "./helpers/renderTileStress.mjs";

// Deterministic protocol/scheduling regressions, not wall-clock benchmarks or
// evidence of additional UK coverage. The timeout only detects deadlocks.
const timeout = 30000;
let fixture;
const getFixture = () => fixture ??= makeSyntheticFixture();
const ids = tiles => new Set(tiles.map(tile => tile.tile_id));
const chosenIds = (manifest, view, budget) => new Set(chooseViewportTiles(manifest, view, budget).chosen.map(d => d.id));

for (const [profile, budget] of Object.entries(tileLoadingProfiles)) {
  test(`${profile}: 2,048 synthetic descriptors survive cache churn, held aborts and disposal`, { timeout }, async t => {
    const { manifest, bytesFor } = await getFixture(), h = makeHarness(manifest, budget);
    t.after(() => h.stream.dispose());
    const valid = request => new Response(bytesFor(request.id));
    const firstView = centerView(manifest.tiles[0]);
    let firstResidents;
    for (let i = 0; i < 32; i++) {
      const view = centerView(manifest.tiles[(i * 67) % descriptorCount]);
      h.stream.setView(view); await h.drain(valid);
      assert.equal(h.current.failures.length, 0);
      assert.equal(h.current.candidates, descriptorCount);
      assert.deepEqual(ids(h.current.tiles), chosenIds(manifest, view, budget));
      const scene = renderTilesToCity(manifest, h.current.tiles);
      assert.equal(new Set(scene.instances.map(instance => instance.id)).size, h.current.tiles.length);
      if (i === 0) firstResidents = [...h.current.tiles];
    }
    assert.equal(h.peakCache, budget.cacheTiles, "the traversal fills the actual profile cache");
    const beforeRefetch = h.requests.length;
    h.stream.setView(firstView); await h.drain(valid);
    assert.deepEqual(new Set(h.requests.slice(beforeRefetch).map(r => r.id)), ids(firstResidents), "full cache turnover forces every original tile to refetch");
    assert.deepEqual(ids(h.current.tiles), ids(firstResidents));
    assert.ok(h.current.tiles.every(tile => !firstResidents.includes(tile)), "refetched tiles have fresh objects");

    // Start actual body reads and hold their cancellation promises. Repeated
    // replans must not treat an aborted signal as a free physical slot.
    h.stream.setView(centerView(manifest.tiles[1500]));
    const held = h.requests.filter(request => !request.answered);
    assert.equal(held.length, budget.concurrency);
    const cancellation = held.map(() => ({ started: deferred(), release: deferred() }));
    held.forEach((request, i) => request.finish(new Response(new ReadableStream({
      cancel() { cancellation[i].started.resolve(); return cancellation[i].release.promise; },
    }, { highWaterMark: 0 }))));
    await Promise.all(held.map(request => request.readStarted.promise));
    const beforeReplans = h.requests.length;
    let latestView;
    for (let i = 0; i < 64; i++) {
      h.stream.setPaused(true);
      latestView = centerView(manifest.tiles[1900 + i]);
      h.stream.setView(latestView); h.stream.setPaused(false);
      assert.equal(h.requests.length, beforeReplans);
    }
    await Promise.all(cancellation.map(item => item.started.promise));
    assert.ok(held.every(request => request.signal.aborted));
    assert.equal(h.live, budget.concurrency);
    assert.equal(h.current.tiles.length, 0);
    for (let i = 0; i < cancellation.length; i++) {
      assert.equal(h.requests.length, beforeReplans + i);
      cancellation[i].release.resolve();
      await h.waitFor(() => h.requests.length === beforeReplans + i + 1);
      assert.equal(h.live, budget.concurrency, "only each settled cancellation frees its physical slot");
    }
    await h.drain(valid);
    assert.deepEqual(ids(h.current.tiles), chosenIds(manifest, latestView, budget));
    assert.equal(h.current.failures.length, 0);

    // A transport ignoring AbortSignal returns valid bytes for an obsolete
    // view. Its late result cannot enter either residency or the cache.
    h.stream.setView(centerView(manifest.tiles[700]));
    const stale = h.requests.filter(request => !request.answered), cacheBeforeStale = h.current.cacheTiles;
    assert.equal(stale.length, budget.concurrency);
    latestView = centerView(manifest.tiles[1000]);
    h.stream.setView(latestView);
    assert.ok(stale.every(request => request.signal.aborted));
    const beforeLate = h.requests.length;
    stale.forEach(request => request.finish(valid(request)));
    await h.waitFor(() => h.requests.length === beforeLate + budget.concurrency);
    assert.equal(h.current.tiles.length, 0);
    assert.equal(h.current.cacheTiles, cacheBeforeStale);
    await h.drain(valid);
    assert.deepEqual(ids(h.current.tiles), chosenIds(manifest, latestView, budget));
    assert.equal(h.current.failures.length, 0);

    h.stream.setView(firstView);
    const disposed = h.requests.filter(request => !request.answered);
    assert.equal(disposed.length, budget.concurrency);
    const emissions = h.emissions, requests = h.requests.length;
    h.stream.dispose();
    assert.ok(disposed.every(request => request.signal.aborted));
    disposed.forEach(request => request.finish(valid(request)));
    await h.idle();
    h.stream.setView(latestView); h.stream.setPaused(false); h.stream.retry();
    assert.equal(h.emissions, emissions, "all late load completions suppress notifications after disposal");
    assert.equal(h.requests.length, requests);
    assert.equal(h.live, 0);
    assert.equal(h.peak, budget.concurrency);
    assert.ok(requests < 400, "large manifest stress uses a bounded number of responses");
  });

  test(`${profile}: mixed failures drain a large manifest queue and only explicit retry recovers`, { timeout }, async t => {
    const base = await getFixture(), manifest = structuredClone(base.manifest);
    const modes = ["valid", "bad-sha", "invalid-utf8", "invalid-json", "wrong-city", "bad-topology", "short-bytes", "overflow", "oversized-header", "http-503"];
    const corrupt = (index, original) => {
      const mode = modes[index % modes.length];
      if (mode === "bad-sha") return Buffer.alloc(original.length, 48);
      if (mode === "invalid-utf8") return Buffer.from([0xc3, 0x28]);
      if (mode === "invalid-json") return Buffer.from("{");
      if (mode === "wrong-city" || mode === "bad-topology") {
        const tile = JSON.parse(original);
        if (mode === "wrong-city") tile.city_id = "bristol";
        else tile.geometry_library["synthetic-mesh"].triangles = [[999999, 0, 1]];
        return Buffer.from(JSON.stringify(tile));
      }
      return original;
    };
    // Decode/identity/topology faults carry matching descriptor bytes/hash so
    // they reach the intended validator, rather than all failing at SHA first.
    for (let i = 0; i < 160; i++) {
      if (i % modes.length < 2 || i % modes.length > 5) continue;
      const descriptor = manifest.tiles[i], bytes = corrupt(i, base.bytesFor(descriptor.id));
      descriptor.byte_length = bytes.length; descriptor.sha256 = hash(bytes);
    }
    const checked = await verifyManifest(manifest), h = makeHarness(checked, budget);
    t.after(() => h.stream.dispose());
    const indices = new Map(checked.tiles.map((descriptor, index) => [descriptor.id, index]));
    const observed = new Set(), cancellations = new Map();
    const respond = request => {
      const index = indices.get(request.id), mode = modes[index % modes.length], original = base.bytesFor(request.id);
      assert.ok(index < 160); observed.add(mode);
      const countCancel = () => cancellations.set(mode, (cancellations.get(mode) ?? 0) + 1);
      if (mode === "short-bytes") return new Response(original.subarray(0, original.length - 1));
      if (mode === "overflow") return new Response(new ReadableStream({
        start(controller) { controller.enqueue(original); controller.enqueue(new Uint8Array(1)); }, cancel: countCancel,
      }));
      if (mode === "oversized-header" || mode === "http-503") return new Response(new ReadableStream({ cancel: countCancel }), {
        status: mode === "http-503" ? 503 : 200,
        headers: mode === "oversized-header" ? { "content-length": String(budget.activeBytes + 1) } : {},
      });
      return new Response(corrupt(index, original));
    };
    for (let start = 0; start < 160; start += budget.activeTiles) {
      const view = rectangleView(checked, start, budget.activeTiles);
      h.stream.setView(view); await h.drain(respond);
      const expected = checked.tiles.slice(start, start + budget.activeTiles);
      assert.deepEqual(ids(h.current.tiles), new Set(expected.filter(d => indices.get(d.id) % modes.length === 0).map(d => d.id)));
      assert.deepEqual(new Set(h.current.failures.map(failure => failure.id)), new Set(expected.filter(d => indices.get(d.id) % modes.length !== 0).map(d => d.id)));
      assert.equal(h.current.wanted, budget.activeTiles);
      const requests = h.requests.length;
      h.stream.setView(view); await h.idle();
      assert.equal(h.requests.length, requests, "a repeated camera plan never implicitly retries failures");
    }
    assert.deepEqual(observed, new Set(modes));
    assert.equal(h.requests.length, 160, "the entire mixed queue progresses exactly once");
    assert.equal(new Set(h.requests.map(request => request.id)).size, 160);
    for (const mode of ["overflow", "oversized-header", "http-503"]) assert.equal(cancellations.get(mode), 16);

    // These descriptors always described valid bytes. Repair only the transient
    // transport response, not the descriptor or source revision, before retry.
    for (const index of [1, 9]) {
      const descriptor = checked.tiles[index], unchanged = structuredClone(descriptor);
      const requests = h.requests.length;
      h.stream.setView(rectangleView(checked, index, 1)); await h.idle();
      assert.equal(h.requests.length, requests);
      assert.equal(h.current.failures.length, 1);
      assert.match(h.current.failures[0].message, index === 1 ? /SHA-256/ : /503/);
      h.stream.retry(); await h.drain(request => new Response(base.bytesFor(request.id)));
      assert.equal(h.requests.length, requests + 1);
      assert.equal(h.current.failures.length, 0);
      assert.deepEqual(ids(h.current.tiles), new Set([descriptor.id]));
      assert.deepEqual(descriptor, unchanged);
    }
    assert.equal(h.requests.length, 162);
    assert.equal(h.peak, budget.concurrency);
    assert.equal(h.live, 0);
  });
}
