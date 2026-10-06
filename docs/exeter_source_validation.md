# 冻结方法在 Exeter 新样区的验证

入口：`/compare?city=exeter#exeter-source-results`。这是新增的两处原始 DTM 源函数试验，原十城、二十样区结果保持不变，不合并获胜比例。

窗口规则、49 个网格、三种方法、求解器、十档文件预算和六个最大差目标在本轮计算前提交为 `37eb8f68`；协议 SHA-256 为 `4397a05fea520a16b9259a351f02f431e78f2e5a20109d224778d194f2d3b688`。已看过 Exeter 城市粗预览，因此不是完全盲测。窗口由原始栅格尺寸的中心及北侧四分位确定，不根据拟合结果挑选。

每个窗口保留 65 × 65 个原始 1 m Float32 像元中心，中心间的函数定义域为 64 × 64 m（4,096 m²）；GeoTIFF 的像元外边界覆盖 65 × 65 m。坐标为英国国家格网 EPSG:27700，高程为 ODN 米。构建源与核验源均为同一 DTM，结果不代表独立测量精度。

预先固定的 8,192 B 上限，三方法都按本方法满足上限的最小全域 E₂ 模型独立选择：

| 新窗口 | 同等拟合三角带完整文件 / E₂ | GUGIS 拟合混合完整文件 / E₂ | 混合 E₂ 降低 |
|---|---|---|---|
| Exeter 中心 | 6,096 B / 8.771929 m² | 6,256 B / 8.688126 m² | 0.9554% |
| Exeter 北侧四分位 | 6,376 B / 10.212654 m² | 6,436 B / 10.141161 m² | 0.7000% |

全部二十组文件预算中，混合对同等拟合三角带为十六组获益、三组相同、一组失利；中心 512 B 档 E₂ 高 5.2918%。294 个候选中 290 个拟合后 E₂ 下降、四个源函数恒等模型保持不变，十个候选连续最大差增长。拟合优化共享角点高程，保持原面带 / 三角类型、对角线和完整文件大小，不能据此称每一点更准确。

更强控制同屏公开：原始规则 Float32 高程格为 16,980 B，完整源纯面带 135,528 B，精确源 P₂ 三角函数 694,376 B。粗拟合文件的收益不等于同函数无损压缩，也不是 ArcGIS 软件或论文作者程序的实测结果。

独立核验包含全部拟合与未拟合模型的 GL5 全域积分、Galerkin 方程、原始像元逐位一致、完整文件成本及 96 项拟合预算 / 最大差选择。保存模型完成 1,543,206 次原生查询与 1,280,160 对边界值核验，源函数控制另有 49,926 次查询。完整 ZIP 含原始窗口、全部模型、原插值控制、CSV、协议、冻结实现及核验回执。

报告 SHA-256：`10f005ad21a9b7580a688c77d4abb247fd57675284ba514cc32df7b5806af960`。

ZIP 为 6,421,796 B，SHA-256：`793c24669d78715f68cfe4e86a52cfe72bfa7142b84364301e4d782231b39a44`。实际浏览器下载与公开原件相同。第二版散点图仅调整阅读布局，绑定原报告指纹，原实验及选择未更改。

复现顺序：

```powershell
.venv/Scripts/python.exe data-pipeline/exeter_source_fit_benchmark.py .local/research/exeter-source-fit-reproduction-1
.venv/Scripts/python.exe data-pipeline/audit_exeter_source_fit.py .local/research/exeter-source-fit-reproduction-1
cd frontend
node scripts/audit-source-fit.mjs ../.local/research/exeter-source-fit-reproduction-1
node scripts/audit-exeter-source-controls.mjs ../.local/research/exeter-source-fit-reproduction-1
```

生成器只接受冻结输入，拒绝覆盖已有研究输出；具体参数以脚本帮助和发布包中的完整协议为准。正式城市、草稿和历史均不参与此次试验。

![真实浏览器结果](screenshots/exeter-source-results-real-browser-2026-10-06.jpg)

![读取保存模型的同点查询](screenshots/exeter-source-native-real-browser-2026-10-06.jpg)
