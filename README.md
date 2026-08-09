# Latent Art Wallpaper

这是基于 `ccawmiku/latent-art-canvas` `dev` 分支改造的 Wallpaper Engine 网页壁纸版本。

## 本地 URL 模式

如果 Wallpaper Engine 只接受 URL，可运行目录中的 `server.py`，然后在 Wallpaper Engine 中填写：

```text
http://127.0.0.1:18088/
```

Windows 下也可以运行 `start-wallpaper-server.bat`，再把这个批处理加入开机启动。服务器只提供静态文件，不访问时阻塞等待连接，不运行图像生成循环，因此空闲时不会额外占用 CPU。

## 使用

将整个文件夹作为 Wallpaper Engine 的 Web wallpaper 项目导入，入口是 `index.html`，也可以直接用浏览器打开预览。首次打开默认只显示随机图像和右下角设置按钮。

设置面板包含：

- 随机方式：步进成长型（沿用原代码的 latent step）或随机宇宙型（定时生成新宇宙）。
- 显示方式：满铺或正方形居中；居中模式可选四周背景颜色。
- 轴向：XY、X、Y。
- 切换时间：单位秒，默认 60 秒。
- 暂停。
- 右下角独立的下一张按钮，可立即切换图像。
- 设置面板内提供“重启宇宙”，会重新随机生成解码器和 latent 状态。
- 切换时间支持 0.1 秒精度，最小值为 0.1 秒。
- 右下角新增星星入口，可在壁纸模式和原始工作台模式之间切换。
- 颜色：AUTO 或手动色板，也可限制颜色数量。

设置会保存到浏览器本地存储。`project.json` 提供了 Wallpaper Engine 可识别的基础属性入口；页面内设置面板始终可用。

## 许可

MIT License，保留原项目版权声明。
