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

## 原生查询内核的配对优化实验

索引由固定 64 m 分桶改为自适应分桶，初始宽度 8–64 m；过大或重叠控制面会自动加粗，索引引用总数上限 4,000,000。高程、解析坡度、坡向、原生面求逆及射线拾取算法没有改变。原 DEM、已保存档案和精度报告均保持原样。

在同一 Node v24.13.0、同一研究档案、同一 4,096 个连续坐标上，分别编译提交 `56a008e` 的旧内核和新版内核。每档每版三个独立进程，交替顺序；每进程热身一次后计时九次，取各进程中位数的中位数。完整 TerrainHit 序列（包含面片、高程、坡度、坡向、参数）的 SHA-256 在全部进程和版本间一致。

| 控制网 | 旧版查询 ms | 新版查询 ms | 旧/新耗时比 |
|---|---:|---:|---:|
| 2 m | 57.27 | 9.63 | 5.95 |
| 4 m | 16.18 | 7.15 | 2.26 |
| 8 m | 6.51 | 4.87 | 1.34 |
| 16 m | 3.71 | 3.81 | 0.97 |
| 32 m | 3.43 | 3.20 | 1.07 |
| 64 m | 2.93 | 2.89 | 1.01 |

2 m 档索引留存 V8 数据堆从 235.75 MB 增至 245.16 MB，约增加 4%；构建从 539.57 ms 增至 548.16 ms。保留内存是解析地形后的基线之上、强制 GC 后的索引增量，不是 GPU 内存或浏览器总内存。低密度档不一定加速，16 m 档实测略慢；小差异不能视为稳定优势。

页面保留旧内核/SPG 的原始五次跨运行库计时，明确标作基线记录；另列更新前后的同运行库配对实验，避免混为一个实验或宣称 ArcGIS/SPG 加速。报告公布所有进程记录、索引构建与留存内存、源代码与档案哈希。

```powershell
node frontend/scripts/benchmark-terrain-index.mjs .local/benchmark/implicit-terrain-replay 56a008e
```

该命令从 Git 读取旧代码，分别在本地临时目录编译运行，不更改工作区或正式城市；更新 `shared/terrain-index-benchmark.json` 与公开下载副本。在另一台机器复现时应保留完整数据和运行库版本，不期待耗时一致。

## 更紧凑的 MultiPatch 基线

原来的五组件 MultiPatch 按原面片分成多个要素，保留 DBF 中的 ID 和类型。现在补充单要素 XYZ 版，按 [Esri Shapefile 技术说明](https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf)省略不存在的可选 M 值，并进一步连接端点完全一致、顶点数为偶数的三角带。连接必须有唯一前驱与后继，不添加桥接三角形。全部六档保存前后验证有向三角形集合哈希，8 m / 16 m 另做百万像元独立读回，高程逐点相同。

8 m 档原每面片一个要素的五组件为 2.622 MB；单要素 XYZ 为 1.246 MB；合并相邻带后为 0.758 MB（8,845 部件降为 125）。同一 GUGIS JSON 为 1.059 MB，比最紧凑的纯几何基线大 39.7%。原 59.6% 文件节省只属于原分组方式，不应作为一般性方法优势。网站主结果采用更紧凑的基线，另列各分组方式。

纯几何版没有逐面片 DBF 属性。另提供属性映射与合并位置映射，大小单独计入；映射保留面片 ID、原类型、来源元数据与原部件位置，但不能恢复共享控制点 ID 或离散前的直纹曲面。三角带文件的高程误差继承原格式对照；不是 ArcGIS 软件执行结果。

```powershell
.venv/Scripts/python.exe data-pipeline/benchmark_research_packing.py --input .local/benchmark/implicit-terrain-replay
.venv/Scripts/python.exe data-pipeline/benchmark_research_joined_strips.py --input .local/benchmark/implicit-terrain-replay
```

上述过程校验原档案和文件 SHA-256，生成新的研究目录；不修改正式城市。发布完整 JSON，以及 8 m / 16 m 紧凑和合并版对照包，不含作者权重或代码。下一步需要从有限尺度的可逼近性和相同精度下的总成本建立方法优势，而不是依赖不够紧凑的保存方式。

## 后续需要实测

ArcGIS Pro 的实际读取与分析、GPU 内存与帧率；SPG 重新训练成本及多随机种子稳定性；统一流程的临界网络 precision / recall / F₀.₅ 与 MIG 距离；独立来源和独立留出实验。上述指标在页面标为待测，不填入推测值。
