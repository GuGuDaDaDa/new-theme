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

静态预览地址为 http://localhost:4173/。build 校验版本，生成公开内容，执行 Tailwind/esbuild 和两遍 Hugo 构建，校验产物后替换 public；preview 只提供现有产物。使用 npm 入口，不直接运行缺少生成资源的 `hugo`。

## 目录与生成文件

`assets/css/components` 放组件样式；`assets/js/core` 和 `components` 放基础工具与功能模块；`layouts` 使用 Hugo 新模板目录（`_partials`、`_markup`、`_shortcodes`）。完整目录见技术文档。

作者编辑 `content/`、`data/`、`hugo.toml`。`.generated/`、`.build/`、`public/` 是可再生成产物，不手工编辑或提交。`node_modules/`、npm 缓存、`.env` 与测试产物也已忽略。

内容支持 YAML/TOML frontmatter，JSON 使用显式 `---json` 围栏。文章必须有 title 和含时区的 date；同日按 created 排序，缺省取 date。新文章建议 `content/posts/name/index.md` 与图片组成 page bundle，可用 `hugo new content posts/name/index.md` 创建草稿。草稿、未来和过期内容从生成输入排除；tags 规范化为独立 term，显示原标签名称。

## 代码检查

```sh
npm run lint
npm run format:check
npm run format
npm test
npm run build
npm run test:browser
```

首次浏览器测试需 `npx playwright install chromium`。下载不可用时可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向本机 Chromium，验证记录需注明实际浏览器版本。`npm run check` 汇总 lint、format、单元测试、Hugo 集成测试和构建；浏览器 smoke 测试单独执行。ESLint 使用 flat config 与 JSDoc 规则，Prettier 支持 Go templates 和 TOML；原始内容、archetype 及既有需求文档不做自动重排。

## 当前范围

已接通构建管线、基础首页／文章／标签／关于／友链／404、公开索引和资源引用。当前列表是无 JS 网格基础层。

推荐切换、最短列定位、加载更多与返回恢复、主题菜单、搜索 UI、目录、灯箱、图片墙、引用、SEO 完整输出等仍为占位，未宣称完成功能验收。预留 shortcode 被使用时明确报错，避免静默吞掉正文；实现后再开放。预留 JS 模块不注册无效事件，尚未接入的按钮不输出。

验证结果见 [validation.md](docs/validation.md)。本轮不部署，也不请求 Google Analytics。
