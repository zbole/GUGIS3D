Complete source-function dataset: all 20 fixed real DTM windows, ten cities, 65x65 original Float32 samples each.
Models cover the same 64x64m domain between pixel centres; derived source GeoTIFF footprint is 65x65m PixelIsArea.
GPR4: common 80-byte BNG/ODN/metre/clip header, shared Float64 XYZ, native bands / P1 strips / P2 triangles. Ruled bands and P2 preserve the reference cellwise bilinear function, E2 < 1e-8 m2. Native 1m source-node P1 has a nonzero between-node residual.
Compact ZGR1 regular-grid and actual lossless georeferenced Float32 GeoTIFF controls are included and can be smaller than the vectors; no raster-storage superiority claim.
Source-relative numerical consistency is not surveyed ground accuracy. Float64 numerical guard, not interval proof. No paper-author or ArcGIS software execution, no heap-memory/CPU/GPU performance claim.
EA source-unit caveat and ODN convention are retained in source_identity. Source data: Environment Agency 2022, OGL v3.0.
All native source nodes and gradients verified. Execution midpoint controls are caches, not saved file or heap measurement.
