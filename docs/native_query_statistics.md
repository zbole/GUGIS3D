# 原生 CPU 查询的后续配对统计

入口：`/compare#native-query-statistics`。该页面分析既有 Windows i7-14650HX / Node v24.13.0 计时，保留原始 220 行、五个固定样例、每例 17 对准备后试验。没有重新计时；统计协议在这次分析前固定，不是原始计时的预注册。

五个样例的耗时中位数之比为 **1.092、1.176、1.371、1.131、1.253**（三角 / 面带）；大于 1 表示本次面带查询更快。五个 95% 探索性重采样区间均高于 1，配对胜负的双侧符号检验经五项 Holm 校正后也均低于 0.05。两种诊断针对不同统计量，页面分别说明。

## 定义与边界

统计量为三角查询耗时中位数 / 面带查询耗时中位数，不是 17 个配对比值的中位数。重采样保留同一试验编号的配对关系，分别在 9 对面带先执行、8 对三角先执行的层内有放回采样；每例 50,000 次，使用固定 PCG64 种子和线性 2.5% / 97.5% 分位数。这是 percentile 方法，不是 BCa。

符号检验只看配对谁更快，去除完全相等的耗时，使用精确双侧二项概率及五项 Holm stepdown 校正。重采样和符号检验均依赖试验对足够独立、有代表性的假设；串行关联或运行时漂移会影响推断。结果仅是本机这组 CPU 样例的诊断，不提供跨设备、GPU、ArcGIS 或真实 DTM 的性能保证。

方法定义参考 [SciPy 配对重采样](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)、[精确二项检验](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.binomtest.html)、[R 多项校正](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html)。实现使用 NumPy 和 Python 标准库，不调用 SciPy。

## 审核与下载

`frontend/public/research/query-statistics-v1/` 保存原始 CSV、85 对配对 CSV、250,000 个 Float64 重采样值、统计报告、科学图、原始原生模型证据与完整统计 ZIP。发布逐字节重放报告、CSV 和全部分布，独立复核二项完整支持集、分位数与 Holm 校正。

原始报告 SHA-256：`df7e009f07fe0267fb939d5141a54b4f2d7cacc6cd027a0b5c44bf5aacd852bf`。统计报告 SHA-256：`e946b2f28d21946ffc01b9fce3b9c0277956d6556278ffb86806f104d1671b9e`。

```powershell
python data-pipeline/query_statistics.py --help
python data-pipeline/publish_query_statistics.py --help
python -m unittest discover -s data-pipeline/tests -p 'test_query_statistics*.py'
cd frontend
node --test tests/queryStatisticsResults.test.mjs
```

修改统计方法或加入新计时必须发布新版本，既有公开计时和 v1 统计证据不覆盖。页面按需展开统计，初始视图不读取原生模型。React 交互和数值检查已完成；当前环境未完成新增页面的真实 GPU/浏览器验收。
