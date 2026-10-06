# GUGIS3D 生产部署

目标是 Ubuntu 22.04 服务器 `123.56.47.218`。检查发现已有旧版 GUGIS（HTTP 80 / API 8000）和商店（HTTPS 443 / Node 3100），新版使用独立的 HTTPS 8443 / API 8001。原有服务及配置保留。

新版计划访问地址为 **https://123.56.47.218:8443/**，使用独立网站账号 `gugis`。访问口令不进入 Git、发布包或公开说明。

截至 2026-10-06 22:42（北京时间），服务器已接收并核验完整归档、覆盖包和 **44,233 个文件 / 2,120,788,085 B** 的发布清单，部署代码对应 `fb9c793`。31 个 Linux 依赖轮文件逐个与独立下载的官方 PyPI 文件核对通过；服务器 Python 3.10.12 的 **10 项部署测试全部通过**。安装已在后台启动，但此后本机到服务器的 SSH、HTTP 和 HTTPS 请求同时超时，服务启动与浏览器验收尚未确认。该地址不能据此视为已经完成上线验收。

临时上传入口已经移除，原商店 Nginx 配置按备份原始字节恢复；移除后 HTTPS 商店返回 200，原商店和旧版 GUGIS 服务均仍处于 active。恢复连接后首先检查 `cat /root/gugis-deployment.exit`、`systemctl is-active gugis-api` 和 `journalctl -u gugis-api -n 50 --no-pager`，再完成下述外网验收。若需要放通安全组，仅新站点的 TCP 8443 对外服务，API 8001 始终绑定本机回环地址。

生产包在本机完成 TypeScript 核验与 Vite 构建。服务器运行 Nginx 静态页面和一个非 root API 工作进程，无开发热更新进程。Python 3.10 单独锁定 Linux 可用依赖；上线时逐座重新校验公开城市种子并生成本次运行环境的指纹回执，不复用 Windows 校验环境。

`deploy/build_release.py` 只采集应用、公开数据、生产页面和与公开种子 SHA-256 一致的十六城只读瓦片。包内没有本地正式项目、草稿、历史、虚拟环境、SSH 私钥或网站密码。所有包内文件有完整字节数及 SHA-256 清单；原始科学模型和公开文件保持实际字节，预压缩 HTTP 副本单独生成。

各版本位于 `/opt/gugis/releases/<版本>`，每版使用独立 `.server-venv`；`/opt/gugis/current` 指向当前版本。正式城市、草稿及历史保存在 `/var/lib/gugis`，升级不替换。只读瓦片通过该数据目录的链接读取当前发布包。API 工厂 `deploy.server:application` 将大数据操作限制为一次一项：最多两项 GET / HEAD 读取可等待，等待超过 120 秒会收到明确的 503 和重试提示；繁忙时的新写入直接拒绝且不读取其请求体。没有自动重放写入。健康检查与有界瓦片读取仍可响应，取消客户端连接也不会提前释放正在工作的解析预算。

系统实际报告物理内存约 1.6 GiB，部署检查时可用内存约 1 GiB。生产 API 的 MemoryHigh 为 700 MiB、MemoryMax 为 950 MiB，使用一个工作进程。完整城市导入和分析有额外成本，不能把瓦片下载量或 GUGIS 文件大小当作实际内存使用。

新站点复用当前有效的 IP HTTPS 证书及已运行的 `bristol-cert-renew.timer`；该定时器续期后重新加载 Nginx，所有使用该证书的端口读取新证书。IP 证书有效期短，须保持续期和到期检查，参见 [Let's Encrypt / Certbot 官方说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。新站点有独立网站访问口令，凭据单独传输及保存，不使用服务器 root 密码。

构建与服务器安装：

```powershell
.venv/Scripts/python.exe deploy/build_release.py --release gugis-20261006-r4
```

把输出压缩包和独立网站密码文件通过 SSH / Workbench 上传后，在服务器验证压缩包 SHA-256，解压到新的版本目录。密码文件设为 `600`，随后执行（目录名称须与实际上传版本一致）：

```bash
bash /opt/gugis/releases/gugis-20261006-r4/deploy/ubuntu/install.sh \
  /opt/gugis/releases/gugis-20261006-r4 /root/gugis-site-password
systemctl status gugis-api --no-pager
journalctl -u gugis-api --no-pager -n 50
```

安装程序不删除旧版本，健康检查失败时恢复原来的当前版本链接。正式数据回退应另行按项目历史操作，代码回退不回退用户数据。

上线验收包含：外网 TLS 验证及登录、十六城目录、分块三维场景、原生直纹面查询、最新对比结果、真实证据与 GeoTIFF 下载指纹、未授权请求被拒绝，以及原商店仍正常响应。脚本运行完成本身不等于外网验收完成。

2026-10-06 的完整生产包保存在 [GitHub Release](https://github.com/zbole/GUGIS3D/releases/tag/deploy-20261006-r3)。由于大文件连接中断，原包拆成 16 个有序文件 `gugis-20261006-r3.tar.gz.part-00` 至 `part-15`；每片大小与 SHA-256 见 `gugis-20261006-r3-chunks.json`，最后一片较小。按编号拼接得到 **1,010,145,058 B** 的归档，其 SHA-256 为 `b034bbe18a12420f412db5ba299072b742339a4adac7aa26be3a60d0a5b742e8`。不能把单片当作独立压缩包解压。

此次归档基于 `7a11bf8`，另有 `gugis-20261006-r3-timeout-overlay.zip` 更新生产适配器至 `fb9c793`，用于兼容 Ubuntu Python 3.10 的排队超时。覆盖包 SHA-256 为 `5cb5d6ca121a89e91407a1cc930380f56b16bf8b0844d459c63594f6967ff002`。解压归档后，以覆盖包中的 `server.py` 更新 `deploy/server.py`，并替换包根的 `release-manifest.json`，随后运行完整清单校验和安装程序。科学模型及结果文件没有经过重新编码。
