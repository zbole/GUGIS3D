# Deterministic tile-loader scaling checks

The loader separates **which tiles are needed** from **the order in which to
request them**. A camera-priority change can reorder the same chosen tile IDs
without changing any geometry. A loaded-building selection can do this too by
pinning one of the already resident tiles.

## Keep unchanged geometry stable

When chosen tile membership is unchanged, request priority updates without
advancing the cancellation epoch or restarting pending reads. Actual membership
changes still use the existing global-epoch invalidation. Pause and disposal
still invalidate pending work, and unsettled physical transports retain their
concurrency slots.

When the exact resident tile objects are unchanged, the published `tiles` array
also keeps its reference and established order. This allows the preview's scene
projection memoization to reuse the existing geometry. Replaced or refetched
objects, or a changed resident set, publish a new array. The array's order is
not a request-priority contract: the queue uses its own ordered wanted list, the
inspector sorts names/IDs, and the renderer independently ranks visible buildings.

This avoids projection-triggered geometry reconstruction on rank-only pans or
selection changes. It does not skip necessary visibility/style updates, simplify
source geometry or retain stale objects across city/revision sessions.

## Evidence and limits

The issue was reproduced with all three retained sample packages under Balanced
and Economy. In one Bristol Balanced case, 16 same-membership pans retained
404 unique buildings, 6,723 asset primitives and 2,575,593 source bytes, but
previously caused 16 redundant projection rebuilds and 5,159,424 canonical
leaf/key JSON serializations. Those are deterministic operation counts, not
elapsed time, frame-rate or GPU-memory measurements.

Changing only priority while initial reads were pending previously required
11 fetch attempts to fill the same eight Balanced tiles, or three attempts to
fill two Economy tiles. These are calls in an offline deferred-transport test;
they do not claim that browser caching always produces the same network traffic.

After the fix, all six retained city/profile cases preserved their tile-array
identity across 16 rank-only pans and a select/deselect cycle. Additional adapter
rebuilds and their canonical serialization work were zero for those events.
Pending rank-only reorder aborted zero transports and used exactly eight or two
fetch attempts. Geometry/identity content and source-byte residency were
unchanged. The real-package protocol script additionally checks loaded-selection
reuse when the package has a building unique to a non-first resident tile.

Focused regressions cover stable loaded/partial residency, selection pins,
updated queue order without abort/refetch, overlapping real membership changes,
stale responses, eviction/refetch and replacement of an object with an equal ID.
No cache, byte, geometry-instance or concurrency limit is raised.

## Many-tile stress coverage

The separate deterministic stress suite uses a bounded synthetic many-tile
manifest and explicitly synthetic placements/identities. Reusing an unchanged
retained mesh for realistic payload structure does not create a geographic
dataset or demonstrate additional UK coverage.

The fixture has 2,048 descriptors and an 873,719-byte manifest, below the existing
4 MiB limit. Bodies are generated lazily from one unchanged committed London
mesh; synthetic provenance and revision stay separate from the retained source.
Four cases cover both profiles, including 32 settled views, 64 rapid held-cancel
replans and 160 mixed responses per profile plus two explicit successful retries.

Checks combine cache turnover, repeated viewport changes, held cancelled reads,
pause/resume, late completion and disposal under both profiles. Every emitted
state must obey active/cache counts and encoded-byte limits, and physical fetch
concurrency must remain capped. Mixed malformed/oversized responses must fail
without entering residency, allow unrelated queue work to progress and recover
only through explicit retry where the descriptor still identifies valid bytes.

Tests use completion notifications and deferred responses. A test timeout detects
a deadlock; it is not a performance target. Individual slow-cancellation, hashing
and timeout edge cases remain in the focused loader suite. Browser/WebGL/GPU
acceptance is separate.
