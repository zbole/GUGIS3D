# 布里斯托地形与 ArcGIS MultiPatch 对标

当前试点仅使用直纹面带与三角带生成地形。旧档案的三角扇可按原三角面拆为短三角带；此操作保留每个控制点和三角形，但扇转带本身并不保证索引更少。洞穴、洞口等非单值高程场留待后续设计。

## 当前可复核的结果

当前城市项目包含一份**解析函数生成的演示地形，并非布里斯托实测 DTM**。该快照有 2,809 个共享控制点、1,248 个直纹面带和 121 个三角带。以同一控制网生成 MultiPatch Shapefile，全部部件使用 Esri 规范的 Triangle Strip，保留每片 ID：

| 文件 | 未压缩大小 |
| --- | ---: |
| GUGIS 独立地形 JSON（含来源元数据） | 176,666 B |
| MultiPatch 的 `.shp + .shx + .dbf + .prj + .cpg` | 1,257,982 B |

具体字节值以 [`shared/terrain-multipatch-benchmark.json`](../shared/terrain-multipatch-benchmark.json) 为准。网页从同一报告读取数字，并按城市文件 SHA-256 检查新旧。比较使用未压缩文件组件，不用 ZIP 下载包大小。**这是 GUGIS 地形格式与一个 ArcGIS 可读取的 Shapefile 导出方案的比较，不是 ArcGIS Pro 的运行性能测试，也不代表其最优 TIN 或地形数据库存储。**

直纹面带保留双线性曲面；导出 MultiPatch 时每个原生区段按 2×2 子格离散为三角带。相对原生曲面的参数域高程差，本快照的解析最大值约 4.04 cm，按区段平面面积加权的参数域 RMS 约 0.32 cm。它不是相对真实 DTM 的误差，也不应与不同精度的格式直接比较加载速度。

## 四档精度、同点查询与剖面

`/compare#terrain-lab` 读取 [`shared/terrain-comparison-suite.json`](../shared/terrain-comparison-suite.json)，展示四套实际生成并读回的文件。GUGIS 原生文件均为 176,666 B。

| 每区段离散档位 | MultiPatch 五文件合计 | 参数域解析最大高程差 | 同点查询 RMS 差 |
| --- | ---: | ---: | ---: |
| 1×1 | 599,038 B | 16.157 cm | 1.183 cm |
| 2×2 | 1,257,982 B | 4.039 cm | 0.286 cm |
| 4×4 | 3,534,334 B | 1.010 cm | 0.070 cm |
| 8×8 | 11,920,894 B | 0.252 cm | 0.018 cm |

原生高程由网站同一个 `terrainIndex.query` 内核求得；对照高程由 PyShp 读回真实 `.shp`，再在 EPSG:27700 下作独立三角形重心插值。固定 41×41 分层点和 4 个范围外探针共 1,685 点；当前四档均有 1,681 个双方有效点、4 个双方 NoData 点，覆盖状态不一致为 0。查询差值包含水平投影影响，**不是 ArcGIS Pro 内部插值实测**。

实验包另含街区路线、最大扭曲区段两组采样剖面 CSV，网页可切换曲线和站点。曲线连接离散站点，遇到 NoData 断开，不估计连续路线的覆盖率。参数域解析最大差与有限采样点的最大差分别展示，不互相替代。Shapefile 各组件附 SHA-256，下载锁定展示修订号；找不到该修订的包时返回错误，不替换成新项目。

这里验证的是 GUGIS 原生曲面相对本项目 MultiPatch 离散方案的体积与曲面保真优势。ArcGIS 也支持 raster、TIN、terrain dataset；其 [Interpolate Shape](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-analyst/interpolate-shape.htm) 支持栅格双线性插值，不能由本实验推断 ArcGIS 无法表达或分析类似地形。

## 复现步骤

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe data-pipeline/upgrade_current_terrain.py
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain.py
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain_suite.py
node frontend/scripts/city-memory.mjs --input .local/city/current.gugis.json --output shared/current-city-memory-benchmark.json --runs 3
node frontend/scripts/generate-compare-evidence.mjs
```

第一个命令只在当前档案存在旧三角扇或旧转换说明时更新项目；旧版和新版均存入 `.local/city/versions`。第二个命令写出与当前修订号匹配的 `.local/benchmark/terrain-<SHA前缀>.zip` 和指标 JSON。也可在网站“地形 / 地物”工作区点击“下载 ArcGIS 对照数据”。解压 ZIP 后，在 ArcGIS Pro 用“Add Data”添加 `terrain.shp`，其水平坐标系为 EPSG:27700；高程数值保留当前档案的高程基准，演示地形为 `local`，不能当作 ODN 实测高程。

`benchmark_terrain.py` 读取当前 GUGIS 地形，使用 [Esri Shapefile 技术规范](https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf)中的 MultiPatch / Triangle Strip 部件写出真实 `.shp`；自动测试用 PyShp 读回验证。文件大小对比包含 GUGIS 地形 payload 的全部字段，而 Shapefile 包含面片 ID、曲面类型、坐标系及所有三维顶点；两侧都不含建筑、道路或纹理。当前导出以每个 GUGIS 面片对应一个 MultiPatch 要素，便于在 ArcGIS 查询原面片编号。

## ArcGIS Pro 软件实测接入

下载“同源实验包”并解压，在有授权的 ArcGIS Pro Python Command Prompt 运行：

```powershell
python run_arcgis_pro.py
```

脚本先验证四档数据的五个组件文件，再用 `SearchCursor` 全几何读取和 `CopyFeatures` 导入各自临时 FGDB，每项重复 3 次，输出 `arcgis-pro-results-*.json`。在网页点击“导入 ArcGIS Pro 实测 JSON”，同包标识、城市修订、数据指纹、任务、重复次数和数值全部校验后，展示三次原值、中位数与范围；仅在当前浏览器保留，可清除。这些是用户导入值，本机没有独立复核。

脚本只测同进程重复数据读写，不保证冷缓存，不包括 UI 加载、FPS、显存或查询速度。目前没有实际 ArcGIS Pro 输出，页面的软件耗时留空。脚本在 ArcGIS Pro 中的执行仍需实机验证。

## 尚需完成的同机软件基准

若要声称 GUGIS 比 ArcGIS Pro 加载更快或更省运行内存，还需在同一台机器上使用同一真实 DTM、相同裁剪范围和高程基准，对固定的相机路径、地形剖面与点查询做重复测量，记录加载时间、保留内存、显存、帧率以及误差。本报告没有这些数据，因此网站把软件性能标为“待测”。
