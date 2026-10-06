Fixed 512x512m Manchester centre sample, not whole city. EA 2022 original 1m Float32 source pixels, BNG/ODN metre convention with original source unit metadata caveat.
64 native GPR4 tiles, each 64x64m and 65x65 original nodes. Original cellwise bilinear source function retained without triangle tessellation. Source-relative agreement is not independently surveyed ground accuracy.
All 532544 internal/node queries and 14448 seam pairs checked; C0 heights and along-seam derivatives agree, normal derivatives may jump. Full raw reference grid included for reproduction, not an application preload.
Actual GeoTIFF pixels and georeference unchanged; footprint 513x513m, between-centre function domain 512x512m. No raster-storage, ArcGIS software or heap-memory superiority claim.
Native file bytes and execution coefficients are different costs. Tile loading avoids mandatory full-dataset fetch; native-query correctness audit is not a browser performance benchmark.
Source: Environment Agency, OGL v3.0; original source identity and metadata caveat in results.json.
