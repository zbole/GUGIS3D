# Lightweight city exploration

The optional read-only tile mode now provides a building list and inspector.
It uses only the verified tiles currently resident in the browser. Searching
does not download the full city, query a geocoder, fetch an OSM object or create
a project. A building outside the loaded subset cannot be found by this list;
move the camera to load another area first.

## Loaded-building search and details

- Search the retained placement name or building ID, case-insensitively
- Results are de-duplicated across tile boundaries and paged, with at most 25
  building rows displayed at once
- Selection from the list and selection in the scene share the same state
- Focus is an explicit action, so searching or selecting does not unexpectedly
  move the camera
- The inspector identifies the exact city/source revision, original placement
  and asset IDs, coordinates, altitude, heading and render primitive count
- Render quality distinguishes a source-provided overview from the complete
  fallback components included in the tile package

Coordinates and altitude describe the source model's placement. Altitude is not
the building's height, and the inspector does not infer measured height, raw OSM
tags or source accuracy from rendered geometry. Roads, terrain, complete semantics
and buildings outside the loaded subset remain absent. Source-revision warnings
and attribution remain available in the preview.

The selected building continues to pin one complete associated tile inside the
existing hard limits. The inspector does not make extra geometry requests to fill
out a selection. A city switch or manifest recheck resets session-specific search
and selection; if a selected object is absent, its details are unavailable rather
than borrowed from another city or revision.

## Pause loading

The preview provides a manual tile-loading pause. While paused, already verified
geometry remains visible, pending tile reads are cancelled and no further tile
reads start. Camera movement records the latest requested view without replacing
the displayed tile set. Resuming plans from that latest view and reuses the bounded
cache, with the same selection pin and byte/count/concurrency limits.

Hidden browser pages also pause tile reads. Returning to a visible page resumes
only if the user did not manually pause. A manifest recheck is an explicit separate
read; a new session still validates its manifest before displaying geometry.
Pause does not measure or promise reduced GPU memory or FPS, and it does not freeze
the camera or renderer. It controls tile acquisition while keeping inspection
available.

Cancelled requests continue to occupy their concurrency slots until their
transports settle. Responses from a pre-pause request cannot update the scene,
even if a transport ignores abort. Intentional cancellation is not reported as
a broken dataset or a timeout requiring retry.

## UK readiness filters

The existing national progress panel combines name/alias, country, sample status
and boundary-receipt status filters locally. It includes a clear-filters action
and result count. A platform unable to securely read a receipt has its own
"not checked on this platform" status; it is not grouped with a failed check.

Filtering does not add active city workspaces or assess geographic coverage.
The official city list, related sample availability and receipt checks remain
separate. In particular, the existing London-named sample is associated with
Westminster by its source description; no City of London coverage is implied.

## Verification limits

Tests exercise list filtering/pagination, selection/revision isolation, explicit
focus, combined readiness filters, pause/resume races, cache reuse, cancellation
and visibility listener cleanup without a WebGL context. The real-package
streaming protocol check uses actual generated package bytes. These checks do not
replace real-browser interaction, visual layout or GPU performance acceptance.
See [render package contracts](render_tiles.md) for the immutable-source,
missing-layer and rendering-budget constraints.
