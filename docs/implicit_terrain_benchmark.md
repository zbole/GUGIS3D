# ImplicitTerrain 同源地形评测

本页说明对比页“论文同源实测”的来源、计算口径和复现步骤。使用作者公开的瑞士 DEM 与 SPG 权重，在本机比较原生 GUGIS 直纹面带、三角带和实际 MultiPatch Shapefile。结果体现精度与体积的取舍，不能据此宣称 GUGIS 全面优于 SPG 或 ArcGIS。

## 结果与解释

| 表达 | 高程 RMSE | 完整未压缩表达文件 | 已完成的测量 |
| --- | ---: | ---: | --- |
| SPG 作者示例权重 | 5.13 cm | 1.596 MB | 本机 CPU 前向求值，含两个权重与必要恢复元数据 |
| GUGIS 2 m 控制网 | 4.42 cm | 17.897 MB | 保存后读回，实际网站查询内核核对 |
| GUGIS 8 m 控制网 | 20.36 cm | 1.059 MB | 保存后读回，实际网站查询内核核对 |
| 8 m 同控制网 MultiPatch | 20.39 cm | 2.622 MB | 五个真实文件组件读回，并对全部参考像元求值 |

1 MB = 1,000,000 字节。8 m GUGIS 比 SPG 文件小 33.7%，但误差更大；比同控制网 MultiPatch 文件小 59.6%。直纹面带离散为三角带会增加误差：8 m 档二者高程差 RMSE 为 1.35 cm、最大值为 44.06 cm。平均值不能替代局部最大误差。

GUGIS 的控制点、边界序列和构面类型可以明确保存、检查和编辑。当前优势证据包括实际文件体积和原生查询读回；局部编辑成本、拓扑分析和 ArcGIS 软件性能尚需实验，不能从格式特点推导数值。

## 来源和参考数据

- [项目与论文](https://fengyee.github.io/implicit-terrain/)：[CVPR 2024 Workshop INRV 论文](https://fengyee.github.io/implicit-terrain/static/pdfs/ImplicitTerrain_camera_ready.pdf)，不是 CVPR 主会论文。
- [作者公开代码的锁定版本](https://github.com/Fengyee/implicit-terrain/tree/ef5f180f0ec3582ddba4e71a1f0faa3dced2a40c)。本实验使用该版本的公开示例，不混用后续版本或论文其他数据集结果。
- 原始 `2494_1141.tif` 为 EPSG:2056、2000×2000、0.5 m 采样。SHA-256：`a7d90ba9b42712624d82cdfb3b7beae2ef7a2493f88d16846dea82fd8d1bc30d`。
- 按示例的 PIL BILINEAR 路径构造 1000×1000 参考网格，地形范围约 1 km²；全部 1,000,000 个参考像元中心参与评测，没有留出训练测试集。
- 原始数据归属 swissALTI3D / Federal Office of Topography swisstopo，遵循其[开放地理数据使用条件](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)。垂直基准未独立核验。

这是独立瑞士研究样本，未作为任何英国城市的真实地形。下载包仅含本项目重新构造的数据、结果和图；不重新分发作者代码、权重或整份原始 DEM。

## 方法

SPG 使用 `torch.load(..., weights_only=True, map_location='cpu')` 读取预期形状的有限权重；不执行下载的 notebook 或任意 pickle。恢复式为 `surface − (geometry×0.5+0.5)×(residual_max−residual_min) − residual_min`，并保存源高程范围、残差范围、坐标域和坐标系。复现 PSNR 为 66.39308 dB，与公开 notebook 示例约 66.39307 dB 相符。

GUGIS 使用网站后端实际 `from_grid` 构面，控制网间距为 2、4、8、16、32、64 m，保留末端边界。最大相邻坡度不超过 0.15 时采用直纹面带，其余采用三角带；不采用三角扇。写入完整 JSON 后重新校验，按保存下来的控制点和面带求值。另用网站的 `terrainIndex` 查询内核核对每档 512 个像元探针和边界外 NoData。

MultiPatch 从同一保存控制网导出：原三角带保持类型，每个直纹面带区段离散一次，采用 Triangle Strip。计入 `.shp/.shx/.dbf/.prj/.cpg` 的实际字节，独立读回五组件后对全部参考像元进行三角插值。本机未运行 ArcGIS Pro。

精度包括米制 RMSE、MAE、绝对误差 P95、最大误差和偏差。PSNR 使用作者示例的归一化 `[-1,1]` 高程与 peak=1。SSIM 明确采用高斯 σ=1.5、11×11 窗口、总体协方差、data_range=1 的本地口径，不声称与论文默认值完全一致。梯度采用双方共同高斯平滑 σ=4 后的 1 m 中心差分，剔除四像元边界；方向比较要求双方梯度范数均大于 0.01。

查询计时采用同一随机种子 20261004、相同 4096 个连续坐标，热身后重复五次。GUGIS 为 Node 网站内核逐点查询，SPG 为 PyTorch CPU 批量前向，运行库和实现不同；结果不构成产品速度排名。训练耗时为未测，文件尺寸不是运行内存，CPU 测量不代表 GPU 帧率。

## 复现

在仓库根目录使用独立研究虚拟环境安装官方 CPU PyTorch、numpy、Pillow、scipy、scikit-image 和 matplotlib。后端环境另需项目正常依赖，前端先执行 `npm ci`。作者代码仅作为资料和权重来源保存于忽略目录：

```powershell
git clone https://github.com/Fengyee/implicit-terrain.git .local/references/implicit-terrain
git -C .local/references/implicit-terrain checkout ef5f180f0ec3582ddba4e71a1f0faa3dced2a40c
python -m venv .local/research-venv
.local/research-venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.local/research-venv/Scripts/python.exe -m pip install numpy Pillow scipy scikit-image matplotlib
.local/research-venv/Scripts/python.exe data-pipeline/replay_implicit_terrain.py --reference .local/references/implicit-terrain --output .local/benchmark/implicit-terrain-replay --threads 8
.venv/Scripts/python.exe data-pipeline/build_research_terrain.py --input .local/benchmark/implicit-terrain-replay
.local/research-venv/Scripts/python.exe data-pipeline/summarize_research_terrain.py --input .local/benchmark/implicit-terrain-replay --prepare
node frontend/scripts/research-terrain-queries.mjs .local/benchmark/implicit-terrain-replay
.venv/Scripts/python.exe data-pipeline/export_research_multipatch.py --input .local/benchmark/implicit-terrain-replay
.local/research-venv/Scripts/python.exe data-pipeline/summarize_research_terrain.py --input .local/benchmark/implicit-terrain-replay
```

最后一步更新 `shared/implicit-terrain-benchmark.json` 和 `frontend/public/research/implicit-terrain/` 结果、图和下载包；其余中间结果留在 `.local`。新版本运行库或机器上的时间结果会改变，应保存自己的版本与完整测量记录。

## 原始源数据的离网格核验

另从未重采样的原始 0.5 m DEM 无放回抽取 16,384 个像元中心，随机种子 20261006；这些位置与 1 m 评测网格中心均相差四分之一米。排除外侧一圈像元，保证双方都在有效域内；参考高程直接来自原栅格，不通过插值制造参考值。使用相同的 SPG 权重及恢复范围，GUGIS 仍查询同一保存档案。

2 m GUGIS 的 RMSE 为 7.30 cm、最大绝对误差约 159.44 cm，SPG 为 7.65 cm、约 130.45 cm。GUGIS 平均误差略低，但最坏点更差；此结果不支持各项精度全面更优的结论。8 m GUGIS 的源数据 RMSE 为 22.29 cm。原始源数据已经参与预处理，所以这不是独立留出测试集；结果与百万个 1 m 网格点的统计分开展示。

在前面实验的同一中间目录执行：

```powershell
.local/research-venv/Scripts/python.exe data-pipeline/benchmark_research_offgrid.py --reference .local/references/implicit-terrain --input .local/benchmark/implicit-terrain-replay --prepare
node frontend/scripts/research-terrain-queries.mjs .local/benchmark/implicit-terrain-replay --offgrid
.local/research-venv/Scripts/python.exe data-pipeline/benchmark_research_offgrid.py --reference .local/references/implicit-terrain --input .local/benchmark/implicit-terrain-replay
```

报告保存原 DEM、父评测、查询集和各档案的 SHA-256，拒绝混用不同修订；网站提供单独 JSON 和 CSV 下载。

## 后续需要实测

ArcGIS Pro 的实际读取与分析、GPU 内存与帧率；SPG 重新训练成本及多随机种子稳定性；统一流程的临界网络 precision / recall / F₀.₅ 与 MIG 距离；独立来源和独立留出实验。上述指标在页面标为待测，不填入推测值。
