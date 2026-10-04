# 真实 Bristol 地形：同误差表示与 MultiPatch 格式对照

入口：`http://127.0.0.1:5173/compare#bristol-terrain-benchmark`。选择 10、25、50 cm 最大参考误差目标；两地全部表示、控制点成本、连续参考界与抽查 RMSE 同时展示，不用某个有利样本替代全部结果。

## 10 cm 目标的具体结果

| 固定样区 | GUGIS 局部三角带 | 同几何 MultiPatch 五文件 | 文件减少 | 加原生恢复信息后的 MultiPatch | 紧凑混合面带 |
|---|---:|---:|---:|---:|---:|
| 港区 | 49,793 B | 69,549 B | 28.406% | 108,368 B | 60,805 B |
| 布兰登山坡 | 36,764 B | 49,517 B | 25.755% | 77,539 B | 93,746 B |

两个样区的三档实验中，GUGIS 局部三角带相对同几何 MultiPatch 五文件减少 **24.09%～29.92%**。这是保存格式的文件实验，**没有执行 ArcGIS Pro，不代表其运行内存、渲染速度或计算耗时**。

同一目标下，紧凑混合面带在这六组真实样区都比局部三角带大。10 cm 下分别大 22.1% 和 155.0%；混合方案的抽查 RMSE 也更小，两者实际误差分布不同。当前全局张量细分会把局部地形细节传递成整行、整列的额外控制成本，后续需要评估局部相容分区，而不能宣称直纹面天然更省。港区 50 cm 的独立局部三角带文件略大于 25 cm，说明独立细分与打包结果不一定按阈值单调。

![实际网站中的真实 Bristol 对比](screenshots/bristol-certified-comparison-2026-10-05.png)

## 来源与公平口径

- [英国环境署 EA 2022 LIDAR Composite DTM](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m)，原像元 1 m，EPSG:27700，ODN 高程；[OGL v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)。公开无损 GeoTIFF SHA256：`eba5ddd68fd58472d236d681f8af8da98df5a29762673414cb916658a264bfbf`。
- 拟合前固定港区中心 `(-2.5985, 51.4501)` 和山坡中心 `(-2.6078, 51.4524)`。实际中心取国家格网像元中心；每地 65×65 个原像元中心，跨度 64×64 m，零缺测。具体窗口和中心国网坐标保存在报告。
- 参考面为原始源栅格的连续分片双线性插值。使用同一参考、相同阈值，分别构造全局相容混合网、局部最长边三角细分及几何不变的面带压紧。连续参考界覆盖源单元顶点、三角边网格交点及二次极值，并计入 Z 保存舍入和浮点保护；不是未知地面的精度保证、区间算术证明或论文最优性定理。
- 每份模型通过网站原生 `terrainMath.ts` 核验 4,096 个固定随机非网格点、4,225 个源像元中心和 256 个外边界点。两种混合编码的方向几何哈希相同，原生抽查及边界高程差小于 1e−9 m。
- MultiPatch 仅从已认证的局部三角带导出，遵循 [Esri Shape 31 / Triangle Strip 规范](https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf)。单要素、兼容面带合并、无人工三角面、无不存在的可选 M。SHP、SHX、DBF、PRJ、CPG 的未压缩总字节数为核心对照。读回全部有向三角面一致，4,096 点高程差为 0；附加恢复文件保留原生点号、面带和完整元数据，能够逐字节还原原档案。两种成本分列。
- 实验模型 X/Y 为**英国国家格网局部偏移，未转换城市 ENU**，用于原生数值实验；不得直接植入三维城市。两处小样区不代表整城已达到该误差界。正式城市、历史、20 像元粗预览和旧瑞士实验均未被替换。

![原像元高程与全部成本结果](../frontend/public/research/bristol-certified/source-and-cost.png)

## 复现与交付

每个可下载 ZIP 包含全部九份模型、原始裁剪 JSON、4,096 点共同查询夹具、完整逐点 CSV、三档 MultiPatch 五文件、原生恢复信息、构建与查询回执、许可和说明。公开结果为 `shared/bristol-certified-terrain.json`，CSV 和科学图位于 `frontend/public/research/bristol-certified/`。结果绑定源文件、代码、模型、夹具和下载包 SHA256；CPU 索引构建与五次预热查询批次耗时分列，GPU/FPS/浏览器堆内存未测量。

```powershell
.venv/Scripts/python.exe data-pipeline/build_bristol_terrain_benchmark.py --output .local/benchmark/bristol-certified-new
node frontend/scripts/audit-bristol-certified.mjs .local/benchmark/bristol-certified-new
.venv/Scripts/python.exe data-pipeline/publish_bristol_terrain_benchmark.py --input .local/benchmark/bristol-certified-new
.venv/Scripts/python.exe data-pipeline/plot_bristol_terrain_benchmark.py --input .local/benchmark/bristol-certified-new
.venv/Scripts/python.exe -m unittest discover -s data-pipeline/tests -p test_bristol_benchmark.py
```

构建器要求新目录。运行测量和发布会更新这组实验的公开结果和代码指纹，应先检查变更，保留历史提交；不会修改正式城市。本次前端组件检查、两项发布包数值检查、生产构建和真实浏览器档位切换、源图加载、ZIP/CSV 下载均通过。实际下载的港区包及 CSV 与仓库文件逐字节一致；控制台无警告和错误。

© Environment Agency copyright and/or database right 2022. All rights reserved.
