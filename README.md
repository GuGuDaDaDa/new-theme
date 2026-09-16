# Night Theme

BuGuLog 的 Hugo 主题：面向中文技术记录与个人随笔的阅读型博客，包含首页推荐、瀑布流列表、文章正文、目录、图片灯箱、图片墙、引用、搜索与三态主题，构建脚本、内容校验和测试都随仓库交付。

- [需求文档](docs/requirements.md)：功能范围、业务规则与验收条件。
- [技术文档](docs/tech-spec.md)：架构、数据与组件合同、构建管线。
- [设计规范](../../design/DESIGN-SPEC.md)：视觉、布局与交互基线。
- [验证记录](docs/validation.md)：各轮实际执行的命令与结果。

## 1. 安装到 Hugo 站点

将完整主题放入站点的 `themes/night-theme/`。使用者只需 **Hugo extended >=0.165.0**，不需要 Node、npm 或 `node_modules`。

从 [exampleSite/hugo.toml](exampleSite/hugo.toml) 复制站点配置到自己的 `hugo.toml`，修改域名、标题、作者和菜单。主题通过 Hugo 内容适配器保留日期过滤和大小写敏感标签规则，以下挂载配置必须保留：

```toml
theme = 'night-theme'

[[module.mounts]]
source = 'content'
target = 'assets/night-content'

[[module.mounts]]
source = 'content'
target = 'content'
files = ['! **']

[[module.mounts]]
source = 'assets'
target = 'assets'
```

第一项让适配器读取作者内容，第二项防止原始 Markdown 被 Hugo 重复生成，第三项保留站点自己的 assets。主题的适配器仍从主题目录加载。不要将原始 content 同时作为普通 Hugo 页面输入。

在自己的站点根目录运行：

```sh
hugo server
hugo --minify
```

文章写在站点 `content/posts/`；关于页、友链页和 `data/friends.yaml` 由站点自己提供。主题不会自动注入示例内容。第一次配置可参考 `exampleSite/`，也可以复制其文章和资源体验功能。

`hugo server` 下修改已有文章会立即生效，删除文章在自身触发的重建中生效；新建文章要再触发一次重建（保存任意其他内容）才会进入内容适配器，这是 Hugo v0.165.0 对挂载到 `assets` 的文件的索引时机，重启开发服务会立刻看到。`hugo --minify` 等完整构建每次重新读取全部输入，不受影响。

## 2. 无 Node 预览本仓库

在主题根目录运行：

```sh
hugo server --source exampleSite --themesDir ../..
hugo --source exampleSite --themesDir ../.. --destination ../public --minify
```

前端产物已随主题提供：`assets/css/compiled.css`、`static/night-theme/js/` 和 `data/night_assets.json`。不要从主题发布包中排除这些文件。内容过滤、标签、摘要和搜索索引都在 Hugo 内完成，不需要 `.generated` 或预处理命令。

## 3. 主题维护者工具

只有修改主题 CSS/JS 源码、增加 Tailwind 工具类或运行测试时才需要 Node >=22.19.0 和 npm：

```sh
npm ci
npm run build:assets  # 更新预编译 CSS、JS 与入口清单
npm run dev           # 前端资源监听 + Hugo 原生内容监听
npm run build         # 编译资源、构建 exampleSite、校验并替换 public
npm run preview       # 本地提供 public，http://localhost:4173/
```

修改前端后，将源码和重新编译的产物一起提交。普通用户新增文章无需编译 Tailwind；覆盖模板时新增未包含的工具类，需要额外 CSS 或重新编译主题资源。依赖版本由 package-lock.json 锁定，Fuse.js 本地按需加载，不使用 CDN。

## 4. 目录与职责

| 路径                                               | 用途                                 |
| -------------------------------------------------- | ------------------------------------ |
| `layouts/`、`i18n/`、`archetypes/`                 | 主题模板、外壳文案、文章模板         |
| `content/_content.gotmpl`                          | 内容适配器，负责过滤及注册页面和资源 |
| `assets/css/`、`assets/js/`                        | 前端源码及预编译 CSS                 |
| `static/night-theme/js/`、`data/night_assets.json` | 随主题发布的 ESM 分块及入口          |
| `hugo.toml`、`theme.toml`                          | 主题默认配置与元数据                 |
| `exampleSite/`                                     | 示例站点配置、文章、图片和友链       |
| `scripts/`、`tests/`                               | 维护者工具和检查                     |

`.build/`、`public/`、`resources/_gen/`、`test-results/`、`node_modules/` 是本地产物，不随主题发布。旧版本的 `.generated/` 已不被使用。

## 5. 站点配置

使用者站点 `hugo.toml` 的关键项：

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

| 参数                                                | 作用                                                |
| --------------------------------------------------- | --------------------------------------------------- |
| `author`                                            | Footer 版权署名与文章落款作者                       |
| `description`                                       | Footer 简介，同时作为站点默认描述                   |
| `footerText`                                        | Footer 标语                                         |
| `icp`                                               | 备案号，可选，缺省隐藏                              |
| `logo`                                              | header 与 Footer 品牌标志图片；未配置用内置单色标记 |
| `social.github` / `social.twitter` / `social.email` | Footer 与关于页社交链接；未配置或格式不合法即隐藏   |
| `defaultSocialImage`                                | 缺封面时的社交分享图，未配置则省略图片标签          |
| `googleAnalytics`                                   | GA ID；仅非本地生产环境且 ID 有效时加载             |
| `avatar`                                            | 关于页头像缺省值；页内 `avatar` 优先，均缺省则隐藏  |
| `favicon`                                           | 标签页图标；未配置用主题自带 `favicon.svg`          |

配置示例：

```toml
title = 'BuGuLog'

[params]
description = '记录技术实践、游戏体验与个人观察。'
author = 'GuGuDaDa'
footerText = '海雾深处，字字为灯'
defaultSocialImage = ''
logo = '/images/logo.svg'
avatar = '/images/avatar.jpg'
favicon = '/images/favicon.png'

[params.social]
github = 'https://github.com/example'
email = 'mailto:you@example.com'
```

`logo`、`avatar`、`favicon` 的取值是站内根路径（`/images/logo.svg`，文件放在使用者站点的 `static/`）或 `http(s)`／`//` 绝对地址。自定义 logo 按原图渲染、保留自身配色：主题内置标记是跟随主题色与导航透明态变化的单色 SVG，换成图片后不再变色，请自行选择在浅色、深色与首页封面背景上都清晰的文件。

## 6. 写文章

```sh
hugo new content posts/my-note/index.md
```

命令按主题 `archetypes/` 中的模板生成草稿 frontmatter；把图片一起放进 `content/posts/my-note/`，正文里用相对文件名引用。

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

正文图片和标题由 render hooks 自动处理：图片输出带灯箱的 `figure`，H2/H3 自动获得锚点并参与目录。bundle 内的栅格图（JPEG／PNG／TIFF／BMP／WebP）会自动生成 WebP 响应式变体；原图仍会发布，灯箱默认展示 WebP 变体，「查看原图」打开未经重编码的原图，GIF、SVG 与远程 HTTPS 图片保持原样。

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

{{< spoiler >}}默认被黑色方块遮住的文字{{< /spoiler >}}

{{< friends >}}                     友链页里的占位符，决定友链网格出现的位置
```

约束：`photo.src` 必须是 bundle 内资源或 HTTPS 地址，`photos` 为空时省略并给出构建警告；`fnref` 为正整数，`refer.num` 必填且同页唯一，`url` 只接受 HTTPS，编号重复、缺少被引用条目或非 `noref` 条目无人引用都会构建报错；`friends` 只用于友链页正文，每页最多一个，重复构建报错。

引用条目按正文 Markdown、可选 `source`、可选 URL、回跳的顺序展示。正文完整显示为第一主行，使用 accent、14px、600；`source` 显示为第二次行，使用 muted、13px、400 并独占一行；无 `source` 时不保留空行。桌面预览和移动面板与文末条目保持相同顺序。

`ai-summary` 与 `ai-warning` 共用同一套卡片样式：浅底、1px 细边框、2px 块圆角、前置装饰标志，以及比正文更小的次级字号（标签 11px、摘要正文 13px、声明 12px；移动端摘要 12px、声明 11px），折叠箭头与关闭按钮保持圆形控件。`ai-summary` 默认折叠，头部显示 `AI 摘要` 标签；`ai-warning` 是一行声明条，可选 `title` 作为加粗前导（后接 `·`），不显示固定的 `warning` 文案——缺 `title` 时只显示正文，正文写成多段时自然换行。两个区块的装饰标志、标签行与控件不进入搜索索引，正文区仍可被搜索。

`spoiler` 位于正文行内，桌面悬停显示、点击固定显示／隐藏，移动端点击切换；无 JS 时文字直接可读，遮罩文字不进入搜索索引与卡片摘要。

## 8. 界面功能

- **首页推荐**：从 `featured: true` 里取最新三篇，手动切换、不自动播放；0 篇隐藏整个推荐区，1 篇隐藏切换条；无 JS 时仍可阅读主推。
- **列表**：首页与 `/posts/` 展示全部公开文章，桌面最短列瀑布流、手机单列；卡片整块可进入文章，标签仍是独立链接。
- **分页**：每页 12 篇，用「加载更多」抓取下一页真实 HTML 并追加，失败可重试或直接访问下一页；从列表进入文章再返回时恢复已加载批次与滚动位置。
- **文章页**：顺序为返回链接 → 标签 → 标题 → 摘要 → 元数据 → 标题图 → 正文；底部为作者版权落款与上一篇／下一篇。
- **目录**：`toc` 为 true、正文至少 3 个 H2 且视口宽于 1100px 时显示右侧目录，否则不保留空栏。
- **图片**：单图点击打开灯箱，图片墙支持点击翻页、方向键与触摸横滑。
- **引用**：正文角标悬停或聚焦显示预览，手机点击打开底部面板，文末保留可回跳的条目。
- **剧透**：`{{< spoiler >}}` 包裹的行内文字默认被黑色方块遮盖，桌面悬停显示、点击固定或隐藏，移动端点击切换，键盘 Enter／Space 切换。
- **搜索**：导航按钮打开弹窗并聚焦输入框，按需加载 Fuse.js 与 `/index.json`，150ms 防抖，每批 20 条，Escape 与关闭按钮退出并把焦点交回入口。
- **主题**：单按钮循环「浅色 → 深色 → 跟随系统」，手动选择存入 localStorage，首次绘制前确定主题避免闪色。
- **其他**：关于页（`content/about/index.md`，头像取页内 `avatar` 页面资源，缺省回退 `params.avatar`；另有 `description` 与页内覆盖社交字段）、友链页（`data/friends.yaml`，`name` 与 `url` 为必填字符串，`url` 只接受 http/https，`avatar` 可选 http/https 或站内根路径，另有可选 `description`；网格位置由 `content/friends/index.md` 正文里的 `{{< friends >}}` 占位符决定，不写占位符时网格仍出现在正文之后）、404 页含搜索入口、文章页 SEO（canonical、OG、Twitter Card、JSON-LD、sitemap）。

## 9. 定制主题

- **文案**：全部外壳文案在 `i18n/zh-CN.toml`，文件名必须与 `hugo.toml` 的 `locale` 一致。模板与浏览器脚本共用同一份译文（构建时生成内联载荷），新增文案时两处同时生效；缺失 key 会让对应位置留空。
- **品牌与头像**：`params.logo` 同时替换 header（47px 尺寸链，≤768px 35px、≤360px 30px）与 Footer（40px）标志，`params.avatar` 作为关于页头像缺省值（页内 `avatar` 优先），`params.favicon` 替换标签页图标；三者缺省时完全使用主题内置资源。自定义 logo 不参与主题色与透明态着色，尺寸由主题 CSS 固定，请提供正方形图片以避免留白。
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

本次迁移的实际结果见 [验证记录](docs/agent-work/hugo-native/VERIFICATION.md)。历史验证不能代替本次 Hugo 原生构建的验收；未运行的浏览器或人工检查会明确标注。

## 11. 部署

在使用者站点中配置正式 `baseURL`，直接运行 `hugo --minify`，将生成的 `public/` 发布到静态服务器。应在干净的专用输出目录构建，避免已删除、转草稿或过期文章的旧 HTML 残留；Hugo 本身不会提供维护者 Node 包装命令的校验后原子替换。

本仓库的 `netlify.toml` 用 Hugo 构建 exampleSite，发布 public，无 Node 前置命令。部署前配置正确的站点 baseURL（也可用 Hugo 标准 `HUGO_BASEURL` 环境变量）；`NIGHT_BASE_URL` 仅适用于维护者 npm 包装命令。当前支持域名根路径，子路径部署未纳入本次合同。

原生生产构建仅在配置了有效 `params.googleAnalytics` 且 baseURL 非本地地址时输出统计脚本；默认空值不加载。维护者 npm 构建固定 local/development 环境并设置 localPreview。构建不会自动部署或上传。

## 12. 相关文档

- [需求文档](docs/requirements.md) · [技术文档](docs/tech-spec.md) · [产品验证记录](docs/validation.md) · [文档索引](docs/README.md)
- [设计规范](../../design/DESIGN-SPEC.md) · [首页样稿](../../design/index.html) · [文章样稿](../../design/article.html)
- [开发周期](docs/cycles/README.md)
