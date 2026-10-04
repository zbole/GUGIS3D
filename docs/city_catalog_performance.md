# 城市目录冷加载优化

首次列出城市只需建筑数量、覆盖范围、道路数量和来源，不需要留存七座城市的完整几何。此前每次后端冷启动都要完整验证并展开所有城市，影响首屏城市选择。

现在离线完整验证七份公开种子，生成 14,532 字节摘要回执。运行时仍读取实际城市文件并计算 SHA-256；只有文件字节、回执固定指纹、验证源码/拓扑资源、Python/Pydantic 版本全部匹配才复用摘要。未知、修改、损坏文件，以及回执丢失、漂移或验证环境变化，都回到原完整验证。没有以文件名、旧计数或 stat 信息认定数据有效。

| 首次只读目录调用 | 完整解析中位耗时 | 摘要匹配中位耗时 | 返回内容 |
| --- | ---: | ---: | --- |
| 七城公开种子 | 17,916.99 ms | 256.97 ms | SHA-256 完全一致 |
| 本机现有城市项目 | 17,528.42 ms | 8,644.19 ms | SHA-256 完全一致 |

每种方式在三个新 Python 进程中测量一次目录调用，导入/进程启动不在计时内；系统文件缓存未控制。后一组布里斯托含本地修改，因此仍完整验证，而其他匹配的种子可复用摘要。这里不是完整页面加载、冷磁盘、GPU、帧率或 ArcGIS 的性能结果，也不保证其他计算机获得同样耗时。逐次计时见 [机器可读结果](../shared/city-catalog-performance.json)。

只读目录不创建城市项目、不写历史、不扩大渲染驻留。摘要缓存仍不保留完整几何；返回数据不会修改回执缓存。294 项后端检查通过（17 项环境跳过）；另测精确匹配、来源改动、损坏模型、回执篡改、版本/验证源码漂移，以及现有各城并行与草稿隔离。

```powershell
# 完整验证后生成发布回执；确认源文件均通过，再更新 seed_summaries.py 中固定指纹。
.venv/Scripts/python.exe data-pipeline/build_seed_summaries.py
# 新进程测量；seeds 不创建正式项目，current 只读取现有项目。
.venv/Scripts/python.exe data-pipeline/measure_city_catalog.py --mode full --scope seeds --output .local/benchmark/catalog/full.json
.venv/Scripts/python.exe data-pipeline/measure_city_catalog.py --mode trusted --scope seeds --output .local/benchmark/catalog/trusted.json
```

后续修改任何后端验证源码、拓扑、城市目录或 Python/Pydantic 环境时，旧回执会失效并自动退回完整验证。要发布新的摘要，需重新执行离线验证；不能仅修改哈希来绕过验证。
