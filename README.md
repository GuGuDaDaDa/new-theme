# Night Theme

基于 Hugo 的 BuGuLog 主题脚手架。技术基线见 [技术文档](docs/tech-spec.md)，业务范围见 [需求文档](docs/requirements.md)。

## 环境与运行

- Hugo **v0.165.0+extended+withdeploy**（系统已安装，不通过 npm 下载）。
- Node.js **v26.7.0**，npm 安装依赖；`.nvmrc` 与 engines 固定版本。
- Tailwind CSS v4 CLI、esbuild、原生 JavaScript ESM；本项目没有 TypeScript、Vite 或 Webpack。

```sh
npm ci
npm run dev
```

开发地址为 http://localhost:1313/。监听 content、assets、layouts、data、static 等源文件，变更后串行重建并重启 Hugo；浏览器手动刷新。终端 Ctrl+C 停止服务。构建错误显示在终端，修复文件后自动重试。

```sh
npm run build
npm run preview
```

静态预览地址为 http://localhost:4173/。build 校验版本，生成公开内容 staging 并原子切换，执行 Tailwind/esbuild 和两遍 Hugo 构建，校验产物后替换 public；preview 静态托管 public 产物。使用 npm 入口，不直接运行缺少生成资源的 `hugo`。

## 目录与生成文件

`assets/css/components` 放组件样式；`assets/js/core` 和 `components` 放基础工具与功能模块；`layouts` 使用 Hugo 新模板目录（`_partials`、`_markup`、`_shortcodes`）。完整目录见技术文档。

作者编辑 `content/`、`data/`、`hugo.toml`。`.generated/`、`.build/`、`public/` 是受管可再生成产物，不手工编辑或提交。`node_modules/`、npm 缓存、`.env` 与测试产物也已忽略。

内容支持 YAML/TOML/JSON frontmatter（JSON 支持原生对象及 `---json` 围栏）。文章必须有 title 和含时区的有效 date；排序主键为上海日历日 date 降序，同日按 created（缺省回退 date）降序，平分以路径升序确定；新文章建议 `content/posts/name/index.md` 与图片组成 page bundle，可用 `hugo new content posts/name/index.md` 创建草稿。草稿、未来和到期内容从生成输入排除；tags 规范化为独立 term，显示原标签名称。

## 代码检查与验证

```sh
npm run lint
npm run format:check
npm run format
npm test
npm run build
npm run test:browser
npm run check
```

首次浏览器测试需 `npx playwright install chromium`。下载不可用时可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向本机 Chromium（`playwright.config.js` 已配置兼容回退），验证记录需注明实际浏览器版本。`npm run check` 汇总 lint、format:check、单元测试、Hugo 集成测试和构建；浏览器端到端测试由 `npm run test:browser` 独立执行。ESLint 使用 flat config 与 JSDoc 规则，Prettier 支持 Go templates 和 TOML；原始内容、archetype 及既有需求文档不做自动重排。

## 当前范围

已建立 Cycle 01 构建与公开内容基线：

- 完整严格 frontmatter 校验与解析。
- 统一时钟公开过滤（排除 draft/未来/到期/隐藏 leaf bundle 资源，独立页隔离）。
- 上海时区稳定排序与连续 rank。
- 大小写敏感 tags 独立 term 路由、无 taxonomy 总览、无 categories。
- PostView 与本地/远程封面安全回退。
- 两遍渲染与 HTML 纯文本提取（保留搜索代码，剥离控件）。
- 12 篇分页、第二页 canonical 与短代码幂等试验。
- esbuild ESM splitting、动态 chunk 与 mounts 合同。
- staging 原子更新与失败保留旧 public。
- 真实浏览器环境下的 CSS/JS/动态 chunk HTTP 加载与无 JS 降级浏览。

推荐切换、瀑布流动态重排、追加加载与返回恢复、三态主题菜单、搜索弹窗 UI、目录、灯箱、多实例图片墙、完整引用交互等功能属于后续周期的增量，当前未宣称完成功能验收。预留 shortcode 与组件在实现后逐步接入。
