# Night Theme

BuGuLog 的 Hugo 主题：面向中文技术记录与个人随笔的阅读型博客，包含首页推荐、瀑布流列表、文章正文、目录、图片灯箱、图片墙、引用、搜索与三态主题，构建脚本、内容校验和测试都随仓库交付。

- [需求文档](docs/requirements.md)：功能范围、业务规则与验收条件。
- [技术文档](docs/tech-spec.md)：架构、数据与组件合同、构建管线。
- [设计规范](../design/DESIGN-SPEC.md)：视觉、布局与交互基线。
- [验证记录](docs/validation.md)：各轮实际执行的命令与结果。

## 1. 如何使用

本仓库是**自包含站点**，不是可以直接拷进别的站点 `themes/` 目录的通用主题：`scripts/build.mjs` 用 Hugo `module.mounts` 把本目录的 `layouts`、`assets`、`static`、`i18n`、`data`、`archetypes` 和生成目录 `.generated/content` 一起挂载给 Hugo，`scripts/lib.mjs` 也把工程根限制在本目录内。

因此使用方式就是：把仓库放在本机，直接在 `content/` 写 Markdown、在 `hugo.toml` 改配置，用下面的 npm 脚本开发和构建。不要直接运行 `hugo`——缺少生成资源时会得到不完整的站点。

## 2. 环境要求

| 依赖    | 版本                                              | 说明                                                                                     |
| ------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Hugo    | `extended`（实测 `v0.165.0+extended+withdeploy`） | 系统安装，不由 npm 下载；最低版本与 extended 由 `hugo.toml` 的 `module.hugoVersion` 强制 |
| Node.js | `>=22.19.0`（实测 `v26.7.0`）                     | 最低版本写在 `package.json` 的 `engines`；`.nvmrc` 是维护者实测版本，不是硬性要求        |
| npm     | 随 Node                                           | 依赖锁定在 `package-lock.json`                                                           |

样式用 Tailwind CSS v4 CLI 编译，脚本用 esbuild 打包原生 ESM；没有 TypeScript、Vite 或 Webpack，也不使用 CDN。

## 3. 快速开始

```sh
npm ci
npm run dev
```

开发地址 http://localhost:1313/。`dev` 先完成内容准备和资源编译，再启动 Hugo 服务，并监听 `content/`、`assets/`、`layouts/`、`data/`、`static/`、`i18n/`、`scripts/`、`hugo.toml` 与 `package-lock.json`；变更后串行重建并重启服务，浏览器手动刷新，终端 Ctrl+C 停止。构建错误显示在终端，修好源文件后自动重试。

```sh
npm run build    # 生成生产构建，产物写入 public/
npm run preview  # 用本地 HTTP 服务托管 public/，地址 http://localhost:4173/
```

`build` 的流程是：校验工具链版本 → 校验并准备内容 → 编译 Tailwind 与 esbuild 资源 → 两遍 Hugo 构建（先 prepare 提取摘要与搜索正文，再输出最终站点）→ 校验产物 → 原子替换 `public/`。构建失败时旧 `public/` 保持不变。`preview` 不重新构建，因此需要先执行过 `npm run build`。

## 4. 目录结构

作者维护：

| 路径                      | 用途                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `content/`                | 文章与独立页面；文章使用 `content/posts/<名字>/index.md` 的 page bundle，图片放在同一目录 |
| `data/friends.yaml`       | 友链条目                                                                                  |
| `hugo.toml`               | 站点配置、菜单、`params`、taxonomy、分页与输出格式                                        |
| `assets/css`、`assets/js` | 设计令牌、组件样式与脚本源码                                                              |
| `layouts/`                | Hugo 模板、partials、render hooks、shortcodes                                             |
| `i18n/zh-CN.toml`         | 主题外壳文案                                                                              |
| `archetypes/`             | `hugo new` 使用的 frontmatter 模板                                                        |

受管生成目录，不要手工编辑或提交：`.generated/`（派生内容与数据）、`.build/`（未完成构建与缓存）、`public/`（已完成的生产构建）、`test-results/`、`node_modules/`。

## 5. 站点配置

`hugo.toml` 的关键项：

| 配置                                | 作用                                             |
| ----------------------------------- | ------------------------------------------------ |
| `title`                             | 站点名，用于品牌、Footer 与「关于」页标题        |
| `locale` / `defaultContentLanguage` | `zh-CN` / `zh`，决定 `i18n/` 文件名              |
| `timeZone`                          | `Asia/Shanghai`，排序与日期判断的基准时区        |
| `hasCJKLanguage`、`summaryLength`   | 中文摘要长度，约 100 个汉字量级                  |
| `disableKinds`                      | 关闭 taxonomy 总览与 RSS；标签聚合页仍输出       |
| `taxonomies.tag`                    | 仅 `tags`，无 categories，无标签总览入口         |
| `pagination`                        | 每页 12 篇，分页路径 `/page/N/`                  |
| `outputs.home`                      | `HTML` + `Search`，生成搜索索引 `/index.json`    |
| `menus.main`                        | 主导航项，用 `pageRef` 指向 `/about`、`/friends` |

`params`：

| 参数                                                | 作用                                              |
| --------------------------------------------------- | ------------------------------------------------- |
| `author`                                            | Footer 版权署名与文章落款作者                     |
| `description`                                       | Footer 简介，同时作为站点默认描述                 |
| `footerText`                                        | Footer 标语                                       |
| `icp`                                               | 备案号，可选，缺省隐藏                            |
| `social.github` / `social.twitter` / `social.email` | Footer 与关于页社交链接；未配置或格式不合法即隐藏 |
| `defaultSocialImage`                                | 缺封面时的社交分享图，未配置则省略图片标签        |
| `googleAnalytics`                                   | GA ID；仅非本地生产环境且 ID 有效时加载           |

配置示例：

```toml
title = 'BuGuLog'

[params]
description = '记录技术实践、游戏体验与个人观察。'
author = 'GuGuDaDa'
footerText = '海雾深处，字字为灯'
defaultSocialImage = ''

[params.social]
github = 'https://github.com/example'
email = 'mailto:you@example.com'
```

## 6. 写文章

```sh
hugo new content posts/my-note/index.md
```

命令按 `archetypes/` 中的模板生成草稿 frontmatter（当前 Hugo 版本对 `content/posts/<名字>/index.md` 取 `archetypes/default.md`）；把图片一起放进 `content/posts/my-note/`，正文里用相对文件名引用。

### Frontmatter

| 字段             | 类型     | 必填 | 行为                                               |
| ---------------- | -------- | ---- | -------------------------------------------------- |
| `title`          | string   | 是   | 展示标题，不从文件名推测                           |
| `date`           | datetime | 是   | 发布日期，显示与主排序依据；必须带时区             |
| `created`        | datetime | 否   | 创建时间；回退到 `date`，用于同一发布日内排序      |
| `publishDate`    | datetime | 否   | 定时发布；回退到 `date`                            |
| `expiryDate`     | datetime | 否   | 到期后从公开构建排除                               |
| `lastmod`        | datetime | 否   | 与 `date` 相同则不显示；不同时只显示「更新于…」    |
| `description`    | string   | 否   | 手写纯文本摘要，优先于正文自动摘要                 |
| `summary`        | string   | 否   | 显式摘要；也支持正文 `more` 分隔符                 |
| `featured`       | bool     | 否   | `false`；是否进入首页推荐候选                      |
| `tags`           | []string | 否   | 空数组；全站唯一的标签体系                         |
| `cover`          | string   | 否   | 封面：bundle 内相对路径、站点绝对路径或 HTTPS 地址 |
| `cover_alt`      | string   | 否   | 封面说明，纯装饰可为空                             |
| `cover_position` | string   | 否   | `50% 50%`；两个 0–100% 坐标，仅用于需要裁切的封面  |
| `toc`            | bool     | 否   | `true`；仍需满足目录显示条件才展示                 |
| `draft`          | bool     | 否   | `false`                                            |

支持 YAML、TOML、JSON frontmatter。`_night` 是构建生成的保留命名空间，作者不要设置。

### 公开与排序

- 每轮构建用同一时刻判断：`draft` 不为 true、`date` 与 `publishDate` 不晚于构建时刻、`expiryDate` 缺省或未过期。未公开文章不会出现在列表、标签、搜索索引和 sitemap 中。
- 排序为 `date` 在站点时区下的日历日降序 → 同日按 `created` 降序 → 仍相同按内容路径升序，重复构建结果稳定。
- 标签去首尾空白、去空项、去重，大小写敏感；点击标签进入 `/tags/<term>/` 聚合页，不提供标签总览。
- 摘要取非空 `description`，否则取正文摘要纯文本；列表卡片最多 110 字符，推荐区最多 60 字符，无有效摘要则隐藏该区域。
- 日期显示为 `YYYY / MM / DD`，阅读时间显示中文分钟数，非空正文至少 1 分钟。
- 封面缺失或本地资源不存在时给出构建提示并回退到无封面样式；远程封面只接受 HTTPS。

## 7. Shortcode 与 Markdown 扩展

正文图片和标题由 render hooks 自动处理：图片输出带灯箱的 `figure`，H2/H3 自动获得锚点并参与目录。

```text
{{< photos >}}
{{< photo src="hill-street.jpg" caption="图注" alt="替代文本" >}}
{{< /photos >}}

{{< fnref 1 >}}                    正文中的引用角标
{{< refers title="参考与注释" >}}    文末引用容器，每页最多一个
{{< refer num=1 source="来源名称" url="https://example.com" >}}
支持 **Markdown** 的文献说明。
{{< /refer >}}
{{< refer num=2 noref=true >}}补充阅读。{{< /refer >}}
{{< /refers >}}

{{< ai-summary >}}作者手写的摘要，默认折叠。{{< /ai-summary >}}
{{< ai-warning title="透明声明" >}}AI 辅助声明，默认展开且可关闭。{{< /ai-warning >}}
```

约束：`photo.src` 必须是 bundle 内资源或 HTTPS 地址，`photos` 为空时省略并给出构建警告；`fnref` 为正整数，`refer.num` 必填且同页唯一，`url` 只接受 HTTPS，编号重复、缺少被引用条目或非 `noref` 条目无人引用都会构建报错。

## 8. 界面功能

- **首页推荐**：从 `featured: true` 里取最新三篇，手动切换、不自动播放；0 篇隐藏整个推荐区，1 篇隐藏切换条；无 JS 时仍可阅读主推。
- **列表**：首页与 `/posts/` 展示全部公开文章，桌面最短列瀑布流、手机单列；卡片整块可进入文章，标签仍是独立链接。
- **分页**：每页 12 篇，用「加载更多」抓取下一页真实 HTML 并追加，失败可重试或直接访问下一页；从列表进入文章再返回时恢复已加载批次与滚动位置。
- **文章页**：顺序为返回链接 → 标签 → 标题 → 摘要 → 元数据 → 标题图 → 正文；底部为作者版权落款与上一篇／下一篇。
- **目录**：`toc` 为 true、正文至少 3 个 H2 且视口宽于 1100px 时显示右侧目录，否则不保留空栏。
- **图片**：单图点击打开灯箱，图片墙支持点击翻页、方向键与触摸横滑。
- **引用**：正文角标悬停或聚焦显示预览，手机点击打开底部面板，文末保留可回跳的条目。
- **搜索**：导航按钮打开弹窗并聚焦输入框，按需加载 Fuse.js 与 `/index.json`，150ms 防抖，每批 20 条，Escape 与关闭按钮退出并把焦点交回入口。
- **主题**：单按钮循环「浅色 → 深色 → 跟随系统」，手动选择存入 localStorage，首次绘制前确定主题避免闪色。
- **其他**：关于页（`content/about/index.md`，支持 `avatar`、`description` 与页内覆盖社交字段）、友链页（`data/friends.yaml`，`name` 与 `url` 为必填字符串，`url` 只接受 http/https，`avatar` 可选 http/https 或站内根路径，另有可选 `description`）、404 页含搜索入口、文章页 SEO（canonical、OG、Twitter Card、JSON-LD、sitemap）。

## 9. 定制主题

- **文案**：全部外壳文案在 `i18n/zh-CN.toml`，文件名必须与 `hugo.toml` 的 `locale` 一致。模板与浏览器脚本共用同一份译文（构建时生成内联载荷），新增文案时两处同时生效；缺失 key 会让对应位置留空。
- **样式**：设计令牌集中在 `assets/css/components/tokens.css`（颜色、字体、间距），组件样式一文件一组件，`assets/css/main.css` 的 `@import` 顺序决定打包顺序。
- **脚本**：`assets/js/core/` 放基础工具，`assets/js/components/` 放功能模块，入口为 `assets/js/main.js`，按需 `import()` 的模块由 esbuild 拆分。
- 站点参数、菜单、友链数据与正文属于作者内容，不放在 `i18n/` 中。

## 10. 检查与验证

| 命令                   | 内容                                        |
| ---------------------- | ------------------------------------------- |
| `npm run lint`         | ESLint（flat config、JSDoc 规则），禁止告警 |
| `npm run format:check` | Prettier 检查，含 README、Go 模板与 TOML    |
| `npm run format`       | 按同样范围写入格式化结果                    |
| `npm test`             | Node test runner 的单元与构建集成测试       |
| `npm run build`        | 生产构建与产物校验                          |
| `npm run test:browser` | Playwright 浏览器回归，针对 `public/` 产物  |
| `npm run check`        | 依次执行 lint、format:check、test、build    |

首次运行浏览器测试需要 `npx playwright install chromium`；下载不可用时设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向本机 Chromium，`playwright.config.js` 已配置兼容回退。验证记录需注明实际使用的浏览器版本。

已记录的结果见 [docs/validation.md](docs/validation.md)：`npm run check` 与浏览器套件在 Chromium 通过，视觉核对覆盖 1440px 与 390px 的浅色／深色组合以及 320–1920px 的溢出检查。Firefox、WebKit/Safari、真实触摸设备与屏幕阅读器尚未实测，不要把 Chromium 结果当作跨浏览器承诺。

## 11. 部署

`public/` 是完整的静态产物，可以交给任意静态服务器或静态托管平台。部署域名通过 `NIGHT_BASE_URL` 注入：构建脚本按「`buildSite({ baseURL })` 选项 → `NIGHT_BASE_URL` 环境变量 → 本地默认值」的顺序解析，结果会写进 canonical、`og:url`、结构化数据、sitemap 与站内绝对链接。未注入时使用本地地址（`http://localhost:4173/`），不要直接用默认值发布；注入值必须是 http/https 绝对 URL，末尾斜杠可省略。本轮只支持部署在域名根路径，带路径的 baseURL（例如 `https://example.com/blog/`）会让输出校验按根路径解析站内链接而报 ENOENT 失败，子路径部署留待后续需求。

Netlify 步骤：

1. 连接 Git 仓库，或本地执行 `npx netlify deploy --dir=public`。
2. 仓库已提供 `netlify.toml`：构建命令 `npm ci && npm run build`，发布目录 `public`，并固定 `HUGO_VERSION=0.165.0`、`NODE_VERSION=24`。
3. 在站点配置的环境变量里添加 `NIGHT_BASE_URL=https://你的域名/`。
4. 触发部署后访问正式域名，并在页面源码中确认 canonical 与 `og:url` 已指向该域名。

构建不部署、不上传；`params.googleAnalytics` 只是预留，构建脚本固定使用 `local`／`development` 环境且 `params.localPreview=true`，部署后也不会加载统计脚本。

## 12. 相关文档

- [需求文档](docs/requirements.md) · [技术文档](docs/tech-spec.md) · [产品验证记录](docs/validation.md) · [文档索引](docs/README.md)
- [设计规范](../design/DESIGN-SPEC.md) · [首页样稿](../design/index.html) · [文章样稿](../design/article.html)
- [开发周期](docs/cycles/README.md)
