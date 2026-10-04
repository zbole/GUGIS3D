# Tile-loading profiles

Before entering optional read-only tile mode, the city-selection page offers two
fixed source-payload loading profiles. The complete editor is unaffected.
The read-only preview also offers an explicit profile selector. It captures the
current camera and source revision, disposes the old session, and restores that
pose in the new session only after validation. Selection and manual pause reset;
the page explains this. If no valid pose is available, it uses the default view.
The local session URL retains the selected profile through refresh and browser
history; copied public camera links still omit the profile as described below.

| Limit | Balanced (default) | Economy |
|---|---:|---:|
| Active tiles | 8 | 2 |
| Active encoded source bytes | 8 MiB | 2 MiB |
| Cached tiles | 16 | 4 |
| Cached encoded source bytes | 16 MiB | 4 MiB |
| Concurrent tile requests | 3 | 1 |

Economy is useful when a smaller loaded area and fewer simultaneous requests
matter more than immediate access to surrounding buildings. These are limits on
source payloads and request scheduling, not measurements or guarantees of GPU
memory, JavaScript memory, network speed or frame rate. The existing scene's
geometry/detail limits continue to apply separately.

## Safe behavior

- Profiles are fixed allowlisted values; URL input cannot supply arbitrary
  numeric budgets or raise the existing hard limits
- The optional `tile_profile=economy` query parameter records the lower profile
  for a tile-mode session. Balanced is the default; unknown values do not create
  custom settings
- City/profile changes replace the preview session and dispose its requests,
  cache and viewer. There is still only one active city/viewer at a time
- A profile does not mutate a live stream's budget, rewrite geometry or partially
  display an over-budget building
- Selection keeps one complete associated tile within the profile's hard limits;
  pause/resume, hidden-page pause, hashes and stale-response isolation remain in
  force
- A source tile larger than the active-byte budget is left unrequested. The UI
  explains that the user can choose Balanced or build smaller offline tiles;
  it never silently raises the limit or downloads the full city
- Returning to selection or switching to the complete editor clears owned profile
  URL state. No global persistent preference is written

Camera links continue to contain the city, source revision and pose only. They do
not carry a loading budget/profile. Recipients use their own explicitly chosen
or default loading profile and still require access to the matching render
package.

## Reproducible protocol check

After building the three local render packages, run:

```sh
node frontend/scripts/verify-render-streaming.mjs
```

The script runs both profiles against the same actual package bytes, checks active
and cache byte/count limits, concurrency, unique inspector counts, selection
retention and pause behavior, and reports the loaded subset for each city/profile.
It uses a local fetch double; it is not a real-browser, network or GPU benchmark.

For the retained three-city packages, the origin-centred conservative initial
request (no viewport rectangle) produced the following protocol results:

| City | Balanced buildings / source bytes | Economy buildings / source bytes |
|---|---:|---:|
| Bristol | 508 / 3,322,946 | 216 / 835,508 |
| London | 309 / 488,629 | 44 / 57,117 |
| Birmingham | 322 / 459,211 | 70 / 87,640 |

Balanced loaded eight tiles per city with a peak of three concurrent requests;
Economy loaded two tiles with a peak of one. Each run retained the selected
building after an offscreen pan, kept pause from requesting more geometry and
made zero full-city requests. The different building counts are intentional
loaded subsets, not dropped or simplified source geometry. Different viewports
will select different tiles and produce different byte/building totals.
