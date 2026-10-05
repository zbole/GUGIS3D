# 伦敦与伯明翰真实 DTM 接入

2026-10-05 新增英国环境署 2022 LIDAR Composite DTM 的两座城市局部数据；不是全城地形，也不扩展现有建筑覆盖。进入对应城市的「地形 / 地物」可预览、点查询、下载原始分辨率数据。预览保存为独立草稿，确认前不替换正式城市；丢弃回到原项目。

| 城市 | 源像元 | 无损 GeoTIFF | 20 像元预览控制点 | 4,096 点 RMSE | 最大差 |
|---|---:|---:|---:|---:|---:|
| 伦敦 | 2,631 × 2,513 | 13.83 MB | 16,632 | 0.411 m | 5.546 m |
| 伯明翰 | 2,653 × 2,785 | 13.74 MB | 18,620 | 0.568 m | 14.087 m |

源数据 EPSG:27700、ODN 米，均无 NoData；无损压缩核对了每个像元及坐标元数据。两城抽查均命中 4,096 / 4,096，固定随机种子从源有效像元中心选取，边缘预先排除 40 像元。误差相对源 DTM，不是独立真实地面精度；抽查与源分辨率不能保证粗预览的连续误差。大误差保留在 CSV 中。高程基准未转换为椭球高，显示采用整体相对偏移。

原件、下载 URL、SHA-256 与采集范围保存在 `backend/data/terrain/*-ea-dtm.source.json`；发布元数据为 `shared/public-terrain-sources.json`。图、原像元查询、JSON 回执位于 `frontend/public/research/london-terrain/` 与 `birmingham-terrain/`。接口按城市固定文件与指纹核验，无法识别的城市不借用布里斯托数据。

可复现脚本：`acquire_ea_city_dtm.py` → `prepare_ea_city_terrain.py` → `audit-ea-city-terrain.mjs` → `plot_ea_city_terrain.py`。采集和准备需要全新输出位置，不覆盖已保留原件；采集限制英格兰、固定工作区与响应体积。WCS 单位字段与官方说明存在冲突，米制依据官方数据集正文，已在来源中公开记录。

此前完整验证：584 项前端通过；后端 282 项通过、17 项 Windows 不适用跳过；生产构建通过。真实浏览器分别完成草稿预览、关闭建筑显示、点击地形读取 ODN 高程及 u/v、丢弃草稿恢复正式项目。原有 43 个保留文件和三城正式数据 SHA-256 完全不变，验收草稿备份仅保留在忽略目录 `.local/qa`。

[官方数据集](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-dtm-2022-1m) · [OGL v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)

© Environment Agency copyright and/or database right 2022. All rights reserved.
