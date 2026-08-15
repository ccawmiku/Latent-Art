# Latent Art Wallpaper

这是基于 `ccawmiku/latent-art-canvas` `dev` 分支改造的 Wallpaper Engine 网页壁纸版本。源码为 ES 模块(`src/js`),通过 esbuild 打包成 `dist/latent-art.js`,`index.html` 加载打包产物,支持直接双击打开(file://)和 GitHub Pages 两种方式。

## 在线部署(GitHub Pages)

本仓库通过 GitHub Pages 部署,入口为 `index.html`。Wallpaper Engine 中使用网页壁纸时,填写 Pages 地址即可:

```text
https://ccawmiku.github.io/latent-art-canvas/
```

`dist/latent-art.js` 已随仓库提交,Pages 无需构建即可直接提供静态文件。

## 使用

打开页面后,首次默认显示随机图像和右下角控制按钮。

设置面板包含:

- 随机方式,四种:**步进成长型**、**随机画布型**、**逐条过渡**、**逐维过渡**。
  - 步进成长型为**线性步进**:旅程开始时冻结起点 A、预生成随机目标 B 并预计算 A→B 向量,每步线性推进 `z = A + p·(1+过冲)·(B−A)`(p 从 0 到 1),终点越过 B 延伸至过冲比例处,到步数上限后以落点为新 A 再生成新 B。
  - 逐条过渡(wipe):旅程开始时把目标图 B 按其**结构网格**(格子 4/8/16/32/64px,可调)渲染,并把其条纹**按绘制顺序记录**为元数据(反映遮盖关系)。揭示顺序可调:**顺序**(从底到顶按绘制顺序逐条揭示,上层条纹盖住下层)或**随机 xy**(每步随机位置揭示)。每张图的条带数可以不同,过渡只消费 B 自己的有序条带列表、逐条覆盖,全部揭示完画面恰好等于 B——步数自动算出,无需设置。只有逐条过渡应用网格钳制,其他模式画面不变。
  - 逐维过渡(dim):预生成目标 B,每步把 192 维隐空间中的一维设为 B 的目标值,192 步后完全变成 B。
  - 可调参数(GROWTH 分区,仅步进成长型显示):步数上限(5–120,默认 30)、过冲(0–100,默认 65)。
- 显示方式:满铺或正方形居中(默认正方形居中);居中模式可选四周背景颜色(默认白色)。
- 效果:正常或雾面模式;雾面模式强制满铺并叠加全屏高斯模糊遮罩,模糊强度可调(0–40px,默认 16px)。
- 轴向:XY、X、Y。
- 切换时间:单位秒,默认 1 秒(支持 0.1 秒精度,最小 0.1 秒)。
- 暂停、右下角独立的下一张按钮。
- "重启画布":重新随机生成解码器和 latent 状态。
- 右下角 ★ 进入原始工作台模式,工作台内按钮变为 BACK 可返回壁纸。
- 颜色:AUTO 或手动色板(CLASSIC/NEON/EARTH 可在右下角切换),也可限制颜色数量。

设置会保存到浏览器本地存储。`project.json` 提供了 Wallpaper Engine 可识别的基础属性入口;页面内设置面板始终可用。

## 开发

```bash
npm install              # 安装依赖(vitest / playwright / esbuild)
npm run build            # 打包 src/js → dist/latent-art.js
npm run build:watch      # 监听 src 变化自动重新打包
npm test                 # 单元测试(vitest)
npm run test:e2e         # 性能测试(playwright)
python -m http.server 18088   # 本地预览 http://127.0.0.1:18088
```

修改 `src/js` 后需要重新 `npm run build`(或保持 `build:watch` 运行),浏览器才会加载到新代码;部署 Pages 前记得把最新的 `dist` 一起提交。

## 许可

MIT License,保留原项目版权声明。
