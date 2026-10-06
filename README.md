# GUGIS3D 本地城市工作台

2026-10-06 对比首屏改为[三条结果主线](docs/result_focus_overview.md)：变曲率样例相对论文式 P1 的 E₂ 降低 63.60%、真实 DTM 混合 20/20 样区收益、三次 CPU 复测 15/15 中位数对比收益。全部控制、未获益结果和来源可查看，完整文件两项收益放在其后；首屏清单仅约 13 kB，主结果链接不再误加载无关补充实验。

2026-10-06 新增[三次独立进程的原生 CPU 复测](docs/native_query_repetitions.md)：五个固定同函数样例 × 三次新进程，15/15 个中位数对比有面带收益，三角 / 面带耗时比为 1.024–1.408×。660 行完整计时、255 对准备后测量、实际编译内核和 123,000 次独立正确性查询均可下载；不择优重跑，实测范围与置信区间明确分开。

2026-10-06 新增[真实 DTM 的 C⁰ 面带/三角带混合表达](docs/hybrid_source_comparison.md)：固定 8,192 B 完整文件上限下，十城二十固定样区全部比本次网格 P1 的全域 E₂ 更低，降幅 3.01%–18.09%；全部十档预算 179/200 组更低。2,940 个模型、1,543 万次原生查询、独立积分和接缝核验可复查，未达标和较大文件也直接展示。该固定网格对照与论文式贪心 P1 分开。

2026-10-06 新增[既有 CPU 查询的后续配对统计](docs/native_query_statistics.md)：五个样例的 95% 探索性重采样区间均高于 1，配对符号检验五项 Holm 校正均低于 0.05。完整原始计时、85 对试验、250,000 个重采样值与确定性复算证据可下载；明确没有重新计时，不将后续诊断当作跨设备或 GPU 保证。

2026-10-06 对比首屏升级为[四项已核验优势](docs/validated_advantage_overview.md)：论文式 P1 误差、真实源函数文件、ArcGIS 兼容同几何格式和原生 CPU 查询。每项独立给出对照、单位、范围与完整证据；指标从不可变报告和实际文件推导，首屏不加载原生模型。

2026-10-06 新增[变曲率方向适配对标](docs/variable_curvature_comparison.md)：预先固定两种四次曲面、七个角度、九档预算。强方向性曲面 63/63 组优于论文式 P1，E₂ 降低 33.81%–90.16%；另一组仅 31/63，全部失利与 P2 高阶控制直接公开。2,071 个完整原生模型、212 万次查询、独立全域积分和完整 CSV/ZIP 可下载。

2026-10-06 新增[原始一米地形的有界面带分块](docs/ruled_terrain_tiles.md)：曼彻斯特中心 512 × 512 m 局部样区，263,169 个原始源节点、64 个 GPR4 面带瓦片。打开查询只加载命中瓦片、最多缓存八个准备结果；532,544 次高程/梯度查询与 14,448 对接缝核验通过，完整原始分辨率和来源可下载。页面显示关联文件代价，不将其当作浏览器内存。

2026-10-06 新增[真实源地形的 ArcGIS 兼容同几何文件对照](docs/source_multipatch_comparison.md)：十城二十固定样区，完整 GUGIS P1 文件比省略可选 M 的实际 MultiPatch 五文件小 32.6%。全部 163,840 个源三角面、Z、面积、向上法向、索引与完整 ZIP 经独立读回核验；当前样区五文件包与全部证据可下载。这是文件格式结果，未运行 ArcGIS 软件。

2026-10-06 新增[真实 DTM 的同源函数对比](docs/source_function_comparison.md)：十城二十固定样区，保留同一逐格高程函数时，原生面带完整二进制文件比本次逐格 P2 三角函数小 80.5%。80 种完整表示与 993,360 次原生查询可复核，提供无损 GeoTIFF 输入、同点高程/坡度和最大差值演示；规则栅格更小的控制结果直接公开。对比页按方向精度、真实函数收益、查询效率三条主线整理。

2026-10-06 新增[主曲率方向适配面带](docs/principal_direction_comparison.md)：七个固定角度、九档预算共 63/63 组比论文式 P1 全域 E₂ 更低；N=2,048 时误差降低 99.88%–99.94%、完整文件小 39.4%–43.2%。精确的 336 B P2 高阶控制一并公开，优势不推广至所有高阶三角方法。[真实 DTM 的预算受限控制试验](docs/real_dem_ruled_control.md)保留面带未获胜的结果。

2026-10-06 新增[纽卡斯尔真实地形与固定样区对照](docs/newcastle_terrain_sample.md)：882.84 万个有效 1 米裸地像元，独立原生面带预览、完整下载和来源核验。十三城 DTM 共 9,846.73 万有效像元；十城二十固定样区同几何文件总节省 26.8% / 28.1% / 29.0%。纽卡斯尔六对文件小 26.6%–35.8%，同时公开混合算法不占优的结果；现有城市与历史存档保持。

2026-10-06 增加[高阶三角方法与同精度结构对照](docs/terrain_order_control.md)：两个直纹结构例子在双方数值零误差门槛下，完整 GOC2 二进制文件分别小 35.5% / 61.1%，完整 JSON 分别小 29.8% / 70.3%；以 P₂ / P₃ 控制源多项式阶数，86 组双编码与 352,256 个查询组合可复核。同时公开原三个严格凸曲面 27 档 P₂ 全域误差更低的结果，区分阶数收益和结构编码收益。

2026-10-06 新增[GUGIS 函数型直纹面带与论文式三角网的直接对照](docs/curved_ruled_comparison.md)：各向异性固定曲面在相同完整文件预算下，全域 E₂ 低 98.3%、实际文件小 41.7%；三个曲面九档预算共 24/27 组误差更低，保留三组不利结果。136 份模型、557,056 次原生查询和全部配对可下载；明确 P₂×P₁ 对 P₁ 的函数阶数差异。对比页以 GUGIS 收益为首，提供轻量模型展示与直接函数求值。

2026-10-05 新增[纽卡斯尔真实中心及河岸街区](docs/newcastle_city_sample.md)：3,560 个建筑轮廓对象、1,950 条道路；十五城公开种子累计 99,719 个对象。547 个 125 m 瓦片有界加载，完整来源与拒绝对象可复核，楼高估算和局部覆盖明确展示；该城独立地形仍待取得。

2026-10-05 新增[诺丁汉固定样区对标](docs/nottingham_terrain_benchmark.md)：同几何三角带文件小 28.8%–33.8%，12 个模型及 49,152 次原生查询可复核。统一九城、18 样区总文件节省 26.8% / 28.2% / 29.0%；混合表达按全域 E₂ 与文件代价判断，保留全部不利结果。十四城公开种子、十二城独立 DTM 及正式城市保护保持有效。

2026-10-05 新增[诺丁汉真实中心街区](docs/nottingham_city_sample.md)：17,134 个建筑轮廓、2,941 条道路；十四城公开种子共 96,159 个对象。档案有限容量扩展至 20,000，保留构件总量和分块预算，完整对象没有因旧上限截断。[诺丁汉独立地形](docs/nottingham_terrain_sample.md)保留 10,506,150 个 1 米裸地像元，原生抽查 RMSE 0.542 m、最大差 7.506 m。十二城 DTM 合计 89,638,942 个有效源像元，来源及全部误差可复核。

2026-10-05 新增[八城证据汇总](docs/cross_city_evidence.md)：16 个固定样区按真实总字节计算同几何文件收益，分别展示全域 E₂／体积取舍及实际直纹函数使用；10 / 25 / 50 cm 总文件节省 26.6% / 28.0% / 28.7%。软件运行结果独立标为待取得。

2026-10-05 完成[利兹固定样区对标](docs/leeds_terrain_benchmark.md)：同几何原生三角带文件小 26.4%–35.5%；混合候选的精度与体积取舍完整展示，新增 12 个模型与 49,152 次固定查询。711 项前端、48 项研究检查及生产构建通过。

2026-10-05 新增[利兹真实中心街区](docs/leeds_city_sample.md)：6,049 个转换建筑轮廓对象、2,924 条道路，十三城公开种子共 79,025 个建筑对象。682 个 125 m 瓦片按需加载；楼高估算、14 个转换拒绝及源状态明确披露，完整 GUGIS 下载逐字节核验。[利兹独立地形](docs/leeds_terrain_sample.md)保留 10,188,976 个 1 米裸地像元和原生直纹面带／三角带；4,096 点抽查 RMSE 0.497 m、最大差 6.883 m，误差和来源完整保留。十一城 DTM 共 79,132,792 个有效源像元；正式项目不变。

2026-10-05 新增[谢菲尔德两个固定样区对标](docs/sheffield_terrain_benchmark.md)：12 个模型、49,152 次原生查询及六对同几何 MultiPatch；原生三角带文件小 24.9%–29.0%。北侧 10 cm 局部分区小 4.6% 且 E₂ 低 2.3%；中心 50 cm 小 30.3% 但 E₂ 高 48.7%、没有直纹区段。保留全部正负结果，页面可准确恢复样区、目标与下载。695 项前端、44 项研究流程检查及生产构建通过。

2026-10-05 发布[谢菲尔德真实城市与独立裸地](docs/sheffield_city_terrain.md)：4,324 栋建筑、2,407 条道路及 7,113,600 个有效 1 m 像元。十二城公开种子共 72,976 栋，十城 DTM 共 68,943,816 像元，均明确局部覆盖；第五版来源链保留旧证据。真实浏览器核验选择保留镜头、直纹面带母线、原生查询与完整下载。粗预览 RMSE 0.586 m / 最大差 10.193 m 同时公开。690 项前端、323 项后端检查、40 项研究流程检查及生产构建通过。

2026-10-05 新增[利物浦两个固定样区对标](docs/liverpool_terrain_benchmark.md)：12 组保存模型、49,152 次固定原生查询和六对同几何 MultiPatch。原生三角带文件小 26.3%–29.3%；混合表示六档均更大且 E₂ 更高，131 个直纹四边形与不利结果原样公开。修复非布里斯托入口隐藏地形结果的问题，刷新保持准确样区与目标。679 项前端、40 项研究流程检查及生产构建通过。

2026-10-05 发布[利物浦真实裸地与原生面带](docs/liverpool_terrain_sample.md)：7,040,000 个有效 1 m 源像元、17,625 控制点，九城 DTM 共 61,830,216 个有效像元。第四版来源链保护前三版原件；无损 TIFF、原生查询和误差图均可复核，抽查 RMSE 0.593 m、最大差 11.391 m 保留公开。674 项前端、318 项后端检查、36 项研究流程检查及生产构建通过。

2026-10-05 新增[利物浦中心与滨水区样本](docs/liverpool_city_sample.md)：3,401 栋真实 OSM 建筑、1,419 条道路，十一城公开种子共 68,652 栋。125 m 分块、完整来源重建及公开下载核验，26 个不支持对象与楼高依据明确披露。672 项前端、315 项后端检查及生产构建通过；首次建筑发布时独立 EA 地形待核验，后续完成并发布，见上方地形记录。

2026-10-05 修复[对标结果链接与恢复](docs/terrain_result_links.md)：范围、固定样区和误差目标随地址记录，刷新保持同一组指标和下载；跨范围清除不兼容样区并保留工作区参数。663 项前端检查及生产构建通过，实际浏览器刷新验收完成，模型与正式数据不变。

2026-10-05 新增[剑桥两个固定样区对标](docs/cambridge_terrain_benchmark.md)：12 组模型、49,152 次固定原生查询及六对同几何 MultiPatch。三角带 JSON 文件小 27.0%–30.8%；局部分区六档均更大，三档 E₂ 更低、三档更高。对比页同时判断精度与体积，保留不利结果与实际直纹数量；不宣称 ArcGIS 软件性能。

2026-10-05 发布[剑桥真实裸地与原生面带](docs/cambridge_terrain_sample.md)：9,586,173 个有效 1 m 像元、24,070 控制点、原生函数查询和无损 GeoTIFF 下载。八城 DTM 共 54,790,216 个有效像元；固定抽查 RMSE 0.226 m、最大差 2.568 m 公开。第三版来源链同时保护两份祖先清单，正式数据不变。

2026-10-05 新增[剑桥中心与学院区](docs/cambridge_city_sample.md)：9,838 栋真实 OSM 建筑、1,501 条道路，十城公开种子共 65,251 栋。完整重建逐字节核验来源、拒绝对象及楼高依据；125 m 分块、独立工作区和完整公开下载。城市种子不含独立发布的地形。

2026-10-05 新增[牛津两个固定样区的全域对标](docs/oxford_terrain_benchmark.md)：12 组保存模型、49,152 次固定原生查询及六对同几何 MultiPatch。三角带文件小 27.4%–32.6%；混合中心 10 cm 档小 4.6% 且 E₂ 高 4.9%，北侧 25 cm 档文件大 108.9%，均原样公开。对比页按范围切换，完整实验包可下载；不宣称 ArcGIS 软件性能。

2026-10-05 发布[牛津真实裸地与原生面带](docs/oxford_terrain_sample.md)：8,047,305 个有效 1 m 像元、20,216 控制点、原生查询与无损 GeoTIFF 下载。七城 DTM 共 45,204,043 个有效像元；4,096 点相对源 RMSE 0.264 m、最大差 3.550 m 同时公开。新版来源清单保留旧六城对标指纹，原正式项目不变。

2026-10-05 新增[牛津中心与北侧学院区](docs/oxford_city_sample.md)：6,594 栋真实 OSM 建筑、1,123 条道路，九城公开种子共 55,413 栋。125 m 分块、楼高估算、10 个拒绝对象及原始来源可追溯；公开文件可核验下载。城市种子不含独立发布的裸地地形。

2026-10-05 新增[六样区真实地形对标](docs/multicity_terrain_benchmark.md)：曼彻斯特、约克、巴斯 36 组保存模型，全域 E₂、连续最大参考界和 147,456 次固定原生查询。18 对同几何三角带 / MultiPatch 文件减少 24.6%–36.1%；局部分区不利结果和实际直纹数量同步展示，软件实测仍待完成。主结果按范围切换，完整模型与逐点 CSV 可下载，不改动正式城市。

2026-10-05 数据集目录增加[完整 GUGIS 公开样本下载](docs/public_city_datasets.md)：八城文件均按长度和 SHA-256 核验，显示楼高依据和已知模型问题。城市文件与独立 DTM 分组，下载不读取本机正式项目、草稿或历史；未取得地形的城市仍可取回建筑样本。

2026-10-05 新增[巴斯中心街区与真实裸地地形](docs/bath_city_sample.md)：7,877 栋真实 OSM 建筑、967 条道路；八城公开种子共 48,819 栋。六城真实 DTM 共 37,156,738 个有效 1 m 像元。巴斯粗预览原像元抽查 RMSE 0.616 m、最大差 4.728 m 如实展示，支持原生面带查询与母线放大。均为局部样本，原有正式项目不变。

2026-10-05 新增[只读真实地形数据集浏览页](docs/terrain_dataset_explorer.md)：五城覆盖、误差图、可复核下载及按需三维面带查询；命中直纹面的母线可单独显示与放大。浏览不创建城市项目或草稿。602 项前端与生产构建通过，曼彻斯特、约克完成真实浏览器核验。

2026-10-05 对标继续落地：[真实 Bristol 的六组 ArcGIS 测试流程](docs/bristol_arcgis_protocol.md)增加同几何文件结果、可下载运行包和严格的结果核验。软件耗时待授权环境实测，文件优势与速度分开。新增[曼彻斯特、约克真实 1 m DTM](docs/multicity_real_dtm.md)，公开地形资料达到五城；局部覆盖与粗预览最大误差同时披露。595 项前端、282 项后端及生产构建通过，17 项后端 Windows 不适用跳过。

2026-10-05 对比页以论文指标为主线重组：先看 E₁ / E₂ / E∞、三角形 N 与 Hessian 网格形状，再看真实 Bristol 的全域积分与文件代价；补充实验按需展开。新增 81 组解析方法结果、18 组真实模型全域 E₂ 和双约束选模，优势、负面结果及无解同屏公开。590 项前端、13 项新增研究数值检查与生产构建通过。[结果与复现](docs/paper_metrics_results.md)。

2026-10-05 [伦敦、伯明翰真实环境署 DTM](docs/multicity_real_dtm.md)已接入：保留 1 m 无损 GeoTIFF 与粗采样原生预览，各自独立草稿、误差回执和下载；实际浏览器完成点查询及恢复，原正式城市保持不变。覆盖均为中心街区局部。

2026-10-05 真实样区增加双重误差约束决策：同时检查最大参考界与可选 RMSE，推荐九份已发布候选中的最小原生文件，保留无解和负面结果，并提供准确模型下载。583 项前端检查及生产构建通过。[示例与比较边界](docs/bristol_terrain_benchmark.md#按双重误差约束选方案)。

2026-10-05 真实样区新增按需加载的三维结构对照：18 份已认证模型支持旋转、缩放、俯视和原生高程／坡度／u-v 查询；切换表示保留镜头，长度与 SHA-256 不通过时不替换结果。580 项前端检查与生产构建通过。[打开方法与坐标范围](docs/bristol_terrain_benchmark.md#可交互的真实样区三维对照)。

2026-10-05 第二轮真实地形优化：局部矩形分区与三角带接缝闭合，六组文件比原全局紧凑混合小 38.9%～62.0%。港区 10 cm 模型为 23.09 kB，相对局部三角带小 53.6%；山坡仍大 19.8%，负面结果同屏公开。12 份模型的连续参考界、共享边 C0、原生查询与压紧几何均核验，正式城市不变。[算法、结果与复现](docs/bristol_terrain_benchmark.md#第二轮局部矩形分区与三角带接缝闭合)。

2026-10-05 对比页新增英国环境署真实港区与布兰登山坡样区，按 10/25/50 cm 最大参考误差目标比较混合面带、紧凑混合与局部三角带，并提供同几何 ArcGIS 兼容 MultiPatch 复现实验包。局部三角带相对五文件格式减少 24.09%～29.92%；六组中混合方案反而更大，负面结果一并公开。没有执行 ArcGIS 软件；误差界仅相对源栅格参考面。[具体结果、限制与复现](docs/bristol_terrain_benchmark.md)。

2026-10-05 真实英国地形：[布里斯托环境署 1 m 裸地 DTM](docs/bristol_real_dtm.md)。新增 13.11 MB 无损压缩 GeoTIFF、15,480 控制点的独立预览、原生查询和可核对的误差回执。只创建草稿，原正式项目不自动替换；20 像元预览的抽查 RMSE 0.608 m / 最大差 6.822 m 同时公开。

2026-10-05 首屏性能：[七城目录冷加载优化](docs/city_catalog_performance.md)。公开种子的首次目录调用由 17.92 s 降至 0.257 s，返回内容相同；文件与验证指纹不匹配仍完整校验。含本地修改的当前项目为 17.53 / 8.64 s；是本机目录 CPU 实测，不代表完整页面或 ArcGIS 性能。

2026-10-05 查询优化：[保留原生求交的射线空间筛选](docs/finite_scale_hybrid_terrain.md#保留原生求交的射线空间筛选)。15 份档案、15,360 对射线结果逐项一致。瑞士 10 cm 混合模型的 1,024 射线查询阶段为 339.73 / 8.77 ms，另需 82.87 ms 建树；小模型存在变慢结果，默认关闭，重复查询可选。不是 ArcGIS 软件性能比较。

2026-10-05 显示优化：[研究三维模型的精确顶点复用](docs/finite_scale_hybrid_terrain.md#研究三维显示的精确顶点复用)。84 份档案的三角几何全部一致；瑞士 10 cm 混合模型显示顶点少 83.0%、位置/法线/索引缓冲数据少 74.7%。网站可切换独立与共享显示，同时公开 CPU 构面代价和实测下载；不是 GPU 内存或 ArcGIS 跑分。

2026-10-05 新增：[约克真实中心街区](docs/york_city_sample.md)，6,092 栋建筑、1,853 条道路。七城公开种子共 40,942 栋，均明确标注局部覆盖；约克采用 125 m 分块，低资源仍最多驻留 2 瓦片。来源、楼高估算与六个转换遗漏可追溯，原有正式档案不变。

后续修复：[来源状态与默认分块](docs/york_city_sample.md#后续修复来源状态与默认分块)。公开种子与本机已保存项目明确区分，离线命令默认使用各城已验证尺寸；旧版候选许可原件独立保留，历史下载继续通过指纹核验。

新增：[精度—成本曲线与约束选择](docs/finite_scale_hybrid_terrain.md#精度成本曲线按要求选择表示)。七类地形、88 个表示成本测点，切换最大参考误差界 / 离网格 RMSE，输入允许误差，选择满足约束的最小已测文件；附 28 份可导出 PNG/SVG 科学图。入口：http://127.0.0.1:5173/compare#terrain-error-cost 。RMSE 与最大误差保证明确分开，不宣称未测模型的全局最优。

新增：[相同三角几何的 ArcGIS 文件格式核验](docs/finite_scale_hybrid_terrain.md#相同三角几何导出-multipatch)。瑞士真实 DEM 四档局部三角模型导出为 EPSG:2056 MultiPatch，GUGIS 原档比五件套小 16.8%–20.7%；全部三角几何与读回高程一致，下载包可逐字节恢复 GUGIS 原档。混合曲面的不同结果与恢复信息额外成本同时公开，未运行 ArcGIS Pro。入口：http://127.0.0.1:5173/compare#raster-multipatch-audit 。

新增：[真实 DEM 的连续参考栅格核验](docs/finite_scale_hybrid_terrain.md#真实-dem-的连续参考栅格对照)，四档 × 三种原生模型全部通过区域误差界。10 cm 档紧凑混合比局部三角文件大 98.0%，同时展示更低 RMSE 与全局网格代价。入口：http://127.0.0.1:5173/compare#raster-terrain-audit 。这里的连续参考不是实测地面误差界。

新增：[相同曲面的面带编码合并](docs/finite_scale_hybrid_terrain.md#同一曲面的编码组织优化)。10 cm 方向变化样本保留原控制点与函数，完整 JSON 从 131.25 kB 降至 56.93 kB，比局部三角基线小 49.6%；同时公开面片编号与边界单侧坡度变化。入口：http://127.0.0.1:5173/compare#strip-compaction-audit 。

更强对照：[相容局部三角剖分](docs/finite_scale_hybrid_terrain.md#更强局部三角剖分结果会反转)新增 24 组同误差实验、48 份配对模型及原生三维切换。10 cm 目标下，混合表示在鞍面 / 长母线样本的文件分别小 97.5% / 90.2%，在凸碗 / 方向变化样本反而大 114.4% / 16.1%；页面同时展示这些结果。入口：http://127.0.0.1:5173/compare#local-triangle-audit 。

新增：[有限尺度直纹面与三角面混合研究](docs/finite_scale_hybrid_terrain.md)，七类地形、四档误差目标、56 份可下载原生模型，含误差核验、实际拓扑图、可旋转三维视图与点击查询。入口：http://127.0.0.1:5173/compare#hybrid-terrain-lab 。结果同时公开优势、无优势和未达标档位；同候选族对照不等于 ArcGIS 软件跑分或近最优证明。

2026-10-04 最新：[ImplicitTerrain 论文同源评测](docs/implicit_terrain_benchmark.md)提供六档 GUGIS 精度与体积、SPG 本机复现、误差图及真实 Shapefile 下载。扩展原有城市并加入曼彻斯特、爱丁堡、卡迪夫，六城本机合计 34,851 栋，均为局部样本。[结果、来源与扩城说明](docs/updates_2026-10-04_terrain_cities.md)。对比入口：http://127.0.0.1:5173/compare#implicit-terrain 。

此前接入 `f05392d` 新版 23 个提交，增加城市入口、只读分块、加载配置、建筑检索、视角链接与候选审阅。[此前更新与验证记录](docs/updates_2026-10-04.md)。布里斯托扩展后正式项目为 10,908 栋，其只读缓存使用公开种子 10,907 栋，两个修订明确区分；原正式修订与 40 个已有历史版本保留。

后续交互修复：分块页面可直接切换低资源 / 均衡配置并保留相机位置，刷新继续使用所选配置；离开编辑器改为页面内确认，取消与写入保护保留。窄窗口先显示三维画面，建筑查询位于其后。验证记录见[本日更新](docs/updates_2026-10-04.md#后续交互修复与完善)。

UI 继续升级为白色工作台：城市入口按步骤组织，进入按钮固定在底部并显示当前模式；浏览页区分主操作与更多工具，建筑列表可收起，原始属性可展开，搜索与选择冲突有明确提示。[界面更新与截图](docs/updates_2026-10-04.md#白色工作台与城市入口升级)。

持续完善：地形与函数地物先进入独立草稿；生成 / 恢复防重复操作及迟到结果写入，草稿状态未知时保护正式修改。LoD1 与构件模型分开统计，楼栋操作依据实际楼层几何；页首统计随当前场景变化，正式档案与内存报告明确独立口径。对比图和联合剖面支持键盘定位，地形对照下载与完整城市导出均绑定显示修订；单栋校验、编码及原子保存也在工作线程执行。最近完整回归为前端 463 项通过、后端 212 项通过（17 项 Windows 不适用跳过），本机 43 个正式 / 历史文件保持不变。[实现、计算边界与实景截图](docs/updates_2026-10-04.md)。

分块读取增加[稳定驻留与大队列回归检查](docs/tile_loader_regressions.md)：当相机或选择仅改变加载优先级、驻留瓦片没有变化时，保留已有场景投影及仍需的请求，避免不必要的整场景重建和重复读取；原有硬预算与过期响应保护继续生效。

默认轻量视角已修正为按数据范围居中，避免把观察目标误当作相机位置而看向样本以外。新增真实 Cesium 相机数学回归：三城、两种读取配置、四种横屏 / 窄屏尺寸共 24 组均选中非空瓦片；这不替代真实浏览器、Windows 或 GPU 验收。

轻量浏览可在进入前选择[低资源读取配置](docs/tile_loading_profiles.md)：驻留最多 2 个瓦片 / 2 MiB，缓存最多 4 个瓦片 / 4 MiB，同时 1 个读取请求；默认均衡配置保持原上限。这里限制的是源数据字节和请求数量，不是 GPU 内存或帧率保证。

新增[轻量模式视角链接](docs/camera_view_links.md)：复制城市、来源修订及相机视角，接收端按实际视域读取分块；来源修订不匹配时明确提示，不冒充历史数据重放。入口页还可展开[源数据修订候选检查](docs/source_candidate_review.md)，对照伦敦 / 伯明翰的原始种子与修订候选，下载带来源和许可的文件；不会自动替换项目或创建草稿。

轻量浏览新增[已加载建筑查询与详情、暂停读取](docs/lightweight_city_exploration.md)：按名称 / ID 搜索当前驻留建筑、分页选择并定位，查看源模型坐标与几何来源；手动暂停或页面隐藏时停止新瓦片读取，恢复后按最新视口继续。英国接入进度可组合筛选地区、名称、样本状态与边界回执状态，仍不把登记数量当成覆盖率。

2026-10-03 后续：网站先选择城市（单选 / 多选），只载入当前工作区；建筑按视域和数量预算分配粗模，保留选中对象与细节上限。可选[轻量只读分块浏览](docs/render_tiles.md)，仅按视域请求已生成的建筑缓存，明确缺少道路和地形；完整编辑模式仍可切换使用。[入口、渲染预算与验证边界](docs/city_selection_rendering.md)。来源审计识别了旧种子的部分竖向建模问题；原始来源和现有项目不自动覆盖，[审计与非默认候选版本](docs/city_source_validation.md)明确记录修正与遗漏。

全国接入准备：新增 [Cabinet Office 76 城名单与只读进度](docs/uk_city_coverage.md)，入口页展开后可按地区和名称筛选；现在有六个样本工作区，全部城市边界覆盖尚未评估。[边界回执工具](docs/city_boundary_receipts.md)仅校验用户提供文件的完整性和结构，不判断拓扑、权威归属或全城覆盖；其安全文件读写当前需要 POSIX 环境，Windows 会明确显示未检查。

2026-10-03：新增伦敦 Westminster / Whitehall 与伯明翰 Civic centre / Jewellery Quarter 的真实 OSM 中心街区样本。顶部切换布里斯托、伦敦、伯明翰独立工作区；每城单独保存正式数据、草稿与历史，三维场景仅挂载当前城市。[三城数据范围、来源与复现](docs/multi_city_workspaces.md)

2026-10-03：合并 DOT 八轮更新，修复空简模建筑显示与剖面漏选，完善历史记录、分析重试、对比快照校对和文件保存保护；已完成 Windows 测试及本地浏览器交互验收。[简要更新说明](docs/updates_2026-10-03.md)

当前公开种子建筑数为布里斯托 10,907、伦敦 5,372、伯明翰 4,126、曼彻斯特 3,430、爱丁堡 6,543、卡迪夫 4,472。布里斯托保留原 600 栋构件示例、3 处地标参考模型和 12 栋英式住宅设计示范，其余新增 OSM 轮廓为 LoD1 体量。高度标签未经独立核验，缺失高度按楼层或默认值估算；不合法或复杂轮廓的拒收数量随转换清单记录。所有种子均未附当地实测 DEM，布里斯托保留的是明确标注的演示地形。

建筑生成、更新、复制与导入先进入所选城市的独立草稿，确认后才保存到该城正式数据；支持历史版本预览恢复。切换城市保留已保存草稿，正在写入时暂停切换。原城市场景页面已移除。

新增函数表达与参数说明、四种英式设计建筑以及 12/24/48 栋街区扩建草稿。已有项目的楼栋数量以页面正式城市统计为准。[函数、草稿与恢复说明](docs/drafts_functions.md)

2026-09-15：完善草稿提交与刷新恢复，优化地形查询和显示缓存，增加场景放大，修复长侧栏滚动；已完成隔离项目的浏览器交互验收。[全局优化与验收记录](docs/global_optimization_2026-09-15.md)

布里斯托的 600 栋轮廓已全部细化为可编辑的墙、门窗、楼板、屋顶及室内交通/分区构件。10 类构件分别配色，颜色与完整语义结构写入城市文件。街区远景使用简模，选中建筑和楼栋详查显示完整结构。立面与内部布局为规则推演，明确保留来源和精度说明；新导入的伦敦、伯明翰种子仍为 LoD1 轮廓体量。

Windows 本地运行：双击 `start-local.cmd`。新电脑安装 Python 3.13、Node.js 22+ 后运行 `start-local.ps1 -Setup`。页面：http://127.0.0.1:5173/ 。

GitHub 公开版包含源码、六城种子、保留的 OSM 来源与采集/转换清单、测试和已保存的对比报告。`.local` 下的本机城市、独立草稿、历史版本、中间实验和运行日志不进入仓库；首次进入某城的完整编辑才从该城种子建立本地项目。来源数据与派生数据库保留 © OpenStreetMap contributors 署名并按 ODbL 1.0 分发，应用代码许可与数据许可分开。

页面地址：城市选择 `http://127.0.0.1:5173/`，工作区 `http://127.0.0.1:5173/?city=<城市ID>`；城市 ID 为 `bristol`、`london`、`birmingham`、`manchester`、`edinburgh`、`cardiff`。

对比展示页：http://127.0.0.1:5173/compare 。布里斯托页逐项对照 ArcGIS Scene Viewer / CityEngine 的官方功能，并展示已保存样本的测量结果；内存百分比只对照本项目展开后的独立点线表示，绝非 ArcGIS 跑分。页面向本地 API 校对修订号，不能将旧快照当作新电脑当前项目结果。伦敦、伯明翰的内存与 ArcGIS 同源对比报告均待测，不借用布里斯托结果。

以下脚本目前针对布里斯托项目。要生成可下载的同源实验包，先在该城“地形 / 地物”生成演示地形或导入 DTM，并明确保存到正式项目，再于仓库根目录运行。演示地形始终标记为非实测：

```powershell
node frontend/scripts/city-memory.mjs --input .local/city/current.gugis.json --output shared/current-city-memory-benchmark.json --runs 3
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain.py
.\.venv\Scripts\python.exe data-pipeline/benchmark_terrain_suite.py
node frontend/scripts/generate-compare-evidence.mjs
```

- [城市使用、数据格式、来源及局限](docs/city_format.md)
- [三城独立工作区、数据范围与重建](docs/multi_city_workspaces.md)
- [本地环境与启动](docs/local_setup_zh.md)
- [单栋实体格式](docs/studio_format.md)
- [City 1.1 全城共享几何与无损存储优化](docs/city_shared_geometry.md)
- [城市数据内存对比与复现方法](docs/city_memory.md)
- [City 1.2 函数地物、面带地形、DEM 导入与查询](docs/environment_format.md)

顶部“地形 / 地物”提供球体与柱体路灯、拱门、弧形阳台、圆形广场，以及直纹面带 / 三角带地形。旧三角扇档案仍可读取，并可按原三角面转换为多条三角带。支持 GeoTIFF、ASCII Grid DTM 导入，按当前城市查询窗口裁剪，并以该城中心建立局部坐标。原生函数与面带拓扑随城市文件保存；演示地形明确标为非实测。已有城市文件需导入对应工作区以恢复本机新增对象。

地形工作区可下载 ArcGIS Pro 可读取的 MultiPatch Shapefile 对照数据；[对标方法和复现步骤](docs/terrain_arcgis_benchmark.md)说明同源控制网、离散误差与文件体积的计算口径。该对照不包含 ArcGIS Pro 的软件性能跑分。

布里斯托正式数据仍保存在 `.local/city/current.gugis.json`，原历史路径不变；伦敦、伯明翰分别保存在 `.local/cities/london/`、`.local/cities/birmingham/` 下的 `current.gugis.json`，各有独立草稿与 `versions`。数据文件保留模型定义、建筑实例、地理位置、语义关系、道路和来源信息，运行时不依赖在线地图或账号。

当前格式是本项目的 GUGIS JSON 扩展，尚无原 C++ 二进制规范，不能声称与旧 `.gugis/.index` 文件兼容。地标为形态参考，轮廓高度多数推算，并非精确测绘城市。

以下为原仓库的历史架构参考，不代表当前页面功能；旧接口暂保留兼容。

---

# gugis-webgis

A web-based 3D GIS MVP for testing a GUGIS-style object model.

The project uses **React + TypeScript + CesiumJS** for the interactive 3D frontend and **FastAPI** for the backend API. The current version uses synthetic Bristol-area sample objects and JSON fallback data, with PostGIS schema files prepared for later database deployment.

## Current Features

* Interactive CesiumJS 3D viewer.
* Synthetic Bristol-area 3D objects.
* GUGIS-compatible object schema:

  * `FunctionStructure`
  * `TemplateStructure`
  * `DiscreteStructure`
  * `HybridBox`
  * object attributes, pose, visibility, and opacity.
* Layer management.
* Layer groups for Base, 3D Objects, Analysis, and AI Placeholder.
* Object picking, clear selection, and stronger selected-object highlighting.
* Property panel and searchable/filterable attribute table.
* Reset to Bristol and fly-to-object tools.
* Distance and height measurement.
* Camera longitude, latitude, and height in the status bar.
* Visibility and transparency controls.
* Clean clipping/slicing placeholder for future 3D Tiles / mesh objects.
* FastAPI endpoints for:

  * health check
  * layers
  * objects
  * object query
  * HybridBox query
  * distance measurement
  * GUGIS JSON export.
* PostGIS schema and seed SQL for future deployment.

## Project Layout

```text
gugis-webgis/
├── frontend/       # React + TypeScript + Vite + CesiumJS
├── backend/        # FastAPI backend
├── database/       # PostGIS schema and sample seed SQL
├── data-pipeline/  # sample data and converter scripts
├── docs/           # architecture, API, object model, roadmap
└── README.md
```

## Quick Start

Run the backend and frontend in two separate terminals.

### Backend

Use the `webgis-backend` conda environment.

```bash
cd ~/gugis-webgis/backend
conda activate webgis-backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Check the backend:

```bash
curl http://localhost:8000/health
```

Expected result:

```json
{"status":"ok","service":"gugis-webgis"}
```

API docs:

```text
http://localhost:8000/docs
```

### Frontend

Use the `webgis-node` conda environment.

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173/
```

The frontend reads the backend URL from:

```text
VITE_API_BASE_URL=http://localhost:8000
```

See `frontend/.env.example`.

On a remote server, use VS Code Port Forwarding for:

```text
5173 -> frontend
8000 -> backend
```

Then open the forwarded local address:

```text
http://localhost:5173/
```

## Build Check

Run this after frontend changes:

```bash
cd ~/gugis-webgis/frontend
conda activate webgis-node
npm run build
```

## Backend vs Frontend

The frontend is the actual WebGIS page.

```text
Frontend: http://localhost:5173
Backend API: http://localhost:8000
Backend docs: http://localhost:8000/docs
```

The backend is required when using API-based object loading, object query, export, and future PostGIS functions.

## GUGIS Object Model

Each object is represented as a GIS entity rather than only a rendered mesh.

Main fields include:

* `object_id`
* `layer_id`
* `shape_type`
* `structure_type`
* `main_type`
* `sub_type`
* `coordinate_mode`
* `base_point`
* `pose`
* `hybrid_box`
* `geometry`
* `attributes`
* `visible`
* `opacity`

Supported structure types in the MVP:

```text
FunctionStructure
TemplateStructure
DiscreteStructure
CompositeStructure
BooleanStructure
```

See:

```text
docs/gugis_object_model.md
```

## Development Roadmap

### V0.1 Current MVP

* Synthetic Bristol sample city.
* CesiumJS interactive viewer.
* FastAPI JSON backend.
* Basic ArcGIS-like interaction tools.
* GUGIS-style object schema.

### V0.2 Frontend Validation

* Fix UI/runtime bugs.
* Improve object picking.
* Improve measurement tools.
* Improve clipping/slicing.

### V0.3 Real Data Import

* Import Bristol OSM / Overture buildings.
* Convert footprints and attributes into GUGIS JSON.
* Generate LoD1 building objects.

### V0.4 Stronger GUGIS Adapter

* Better separation of:

  * FunctionStructure
  * TemplateStructure
  * DiscreteStructure
* Add stronger HybridBox query logic.
* Add object-level spatial filtering.

### V0.5 3D Tiles / glTF Export

* Export render cache.
* Support larger 3D scenes.
* Prepare for web-scale streaming.

### V0.6 AI Integration

* Add point cloud / remote sensing result layers.
* Connect building extraction or semantic segmentation outputs.
* Convert AI results into GUGIS objects.

## Notes

This project currently does **not** depend on 51Earth or any closed cloud-rendering platform.

The goal is to first build a minimal open-source 3D WebGIS prototype, then gradually extend it toward a full GUGIS-compatible data engine.
