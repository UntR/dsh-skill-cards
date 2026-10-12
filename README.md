<div align="center">

# 🎴 dsh-skill-cards · 技能卡片

**把 DeepSeek Harness 的技能目录变成一整面可交互的游戏王卡墙。**

*以图片卡片浏览本机技能 · 自定义封面与卡名 · 智能分类 · 3D 立体卡片墙 · 抽卡揭示 · 一键注入当前会话*

[![npm version](https://img.shields.io/badge/npm-0.1.0-c9a24b)](https://www.npmjs.com/package/dsh-skill-cards)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-62%20passing-brightgreen)](test/)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。在**聊天输入框下方**放一个「技能」按钮，同时在**设置 → 技能**里内嵌完整管理器，点开是一个以**图片卡片**呈现的技能浏览弹窗。选中技能后**仅对本次会话生效**——不动磁盘、不污染全局目录。

[功能](#-功能一览) · [安装](#-安装) · [使用](#-使用) · [API](#-http-api-参考) · [开发](#-开发) · [疑难排查](#-疑难排查)

</div>

---

## 📸 效果

| 卡片网格 | 3D 立体墙 | 抽卡揭示 |
| --- | --- | --- |
| 分类筛选 / 搜索 / 多选 / ★ 常用 | WebGL 星云背景 + 悬停视差 | 应用后卡背飞入 → 逐张 3D 翻面 |

---

## ✨ 功能一览

### 两个入口

- **聊天输入框下方「技能」按钮** — 注册在官方 `conversation.input.right` 槽位（输入框下方、发送按钮左侧），走官方槽位而非 DOM 探测，稳定可靠。
- **设置 → 技能** — 整个管理器**内嵌**在该设置项内（`settings.section`），点开即用，无需再开弹窗。该入口能精确拿到当前会话 id。

> 插件入口（DSH 自带的插件管理面板）**不做任何改动**——本插件只管「技能的可视化浏览与本次会话引入」。

### 🎴 游戏王式卡面（按分类自动换装）

- 卡面为 TCG 结构：金属外框 + 属性徽章 + 名字条（星级）+ 插画窗（封面图优先，无图则显示名字缩写字纹）+ 描述框 + 右下 **ATK 数值（= 使用次数）**。
- **主题表驱动**：11 个内置分类各有专属框色 / 插画渐变 / 辉光（开发·橙、测试·绿、设计·紫、安全·红……）。自建分类查表不到时**按名字哈希生成色相**（饱和度/亮度锁定在卡框区间），任何后续新增分类都自动有一套和谐皮肤。
- **闪卡罕贵度**：约 1/8 的技能（名字哈希确定性）为 SR 卡，卡面带持续流动的斜向碎闪光泽，悬停任意卡也会扫光。无随机抖动 —— 同名技能每次都是同一个罕贵度。

### 🧊 3D 卡片墙（默认开启）

- 卡片以立体墙呈现：每张卡按技能名确定**微倾斜 / 纵深姿态**（同名永远同姿势，重开不跳），鼠标悬停有**视差倾斜**，打开时**错峰入场**。
- 背景是 **WebGL 粒子星云**（three.js，随鼠标轻微移动，跟随明暗主题）。
- **完整降级链**：WebGL 不可用 / three.js 加载失败 / 系统「减弱动态效果」→ 自动退回平面网格，搜索、多选、改图、应用全部照常可用。关闭弹窗即释放 GPU。
- three.js 不在 DSH 客户端模块表里（`require('three')` 会抛错），所以插件**自带一份 UMD 版**（`vendor/three.min.js` v0.152.2），由宿主端以同源经典 `<script>` 提供 —— **不走 CDN，离线可用**。

### 🗂️ 分类 / 常用 / 使用次数

- 每张卡按名称与描述**自动归类**到 11 个中文分组：开发 / 测试 / 设计 / 写作·文档 / 办公文档 / AI·智能体 / 流程·工程 / 研究·分析 / 技能·管理 / 安全 / 数据。
- 顶部**分类筛选 tab**（全部 / 常用 / 各分组，带计数）+ 右侧下拉框（默认 / 按使用次数 / 只看收藏）双通道筛选；★ 常用卡片**置顶**。
- **分类管理**：底部工具栏独立「分类管理」按钮可**新增 / 重命名 / 删除**用户自建分类。内置智能分类**只读**，自建分类自由编辑，新增分组会并入筛选与卡面主题。
- 卡面布局：标题 ≤2 行、描述 ≤3 行、分类固定左下角、使用次数固定右下角。

### 🖼️ 自定义封面 / 卡名

- 每张卡左下角悬停出现「图片」按钮，可填写**封面图 URL、标题、描述**；也可**从本机选图上传**。
- 上传的图片作为**文件**存到 `~/.dsh/skill-cards-images/`，配置里只存受保护的同源服务 URL —— **不存 base64**，防止配置被撑爆。支持 `png / jpg / webp / gif / svg`。
- 落盘于 `~/.dsh/skill-cards.json`，刷新即生效。

### 🎴 应用本次会话（抽卡仪式感）

- 点「应用到本次会话」：弹窗先关闭，暗金纹章卡背**依次飞入**屏幕中央，再**逐张 3D 翻面揭示**（间隔 420ms），SR 卡翻面瞬间金光爆闪。点击任意处 / `Esc` 可跳过；系统「减弱动效」时直接跳过。
- 成功引入的技能名以彩色标签出现在输入框「技能」按钮上方（约 4 秒后消失）。

### 🌏 技能中文化

- 底部工具栏「中文化」打开批量面板：**① 生成提示词并复制**（列出所有未翻译技能）→ 粘到对话框发给 agent → **② 把返回的 JSON 粘回面板点「写入」**。
- 每张卡左上角悬停有「译」按钮，可单卡翻译。
- agent 也可**直接调接口写入**（免粘贴）：

```bash
curl -X POST http://127.0.0.1:19387/plugins/dsh-skill-cards/i18n \
  -H 'content-type: application/json' \
  -d '{"items":[{"name":"tdd","zh":"测试仪式","zhDesc":"红-绿-重构循环的守护者。"}]}'
```

- 翻译优先渲染中文名，无翻译则回退英文原名 —— **没翻译的技能照常显示**。未知技能名会被服务端跳过，不会污染配置。

---

## 📦 安装

> [!IMPORTANT]
> **务必走官方安装器，不要手改 profile 的 `package.json` / `node_modules`。**
> DSH 桌面版把这四者当作**一个原子事务**；只改其中一部分会让 DSH 启动时判定组合不一致，并**写入最小安全配置**（表现为：其它插件全部消失、配置被重置）。

### 桌面版

```bash
# 桌面版必须用安装目录自带的 CLI，普通 dsh CLI 会被 Electron 独占拒绝
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-skill-cards
```

或直接用应用内 **设置 → 插件管理 → 添加**。

### Web 版

```bash
dsh plugin --profile web add dsh-skill-cards
```

### 从源码安装（贡献者）

```bash
git clone https://github.com/baobao1994/dsh-skill-cards.git
dsh plugin --profile web add "/absolute/path/to/dsh-skill-cards"
```

安装是纯 `insert` 的 `cordis.patch.yml`。若宿主代码未加载（弹窗打不开），**重启一次 DeepSeek Harness**；之后 `client/` 的改动刷新页面即可生效。

### 卸载

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop remove dsh-skill-cards
```

---

## 🚀 使用

1. **打开面板** — 点输入框下方的「技能」按钮，或进 **设置 → 技能**。
2. **筛选与搜索** — 顶部分类 tab + 搜索框（同时匹配中英文名与描述）。
3. **定制** — 悬停卡片左下角「图片」按钮换封面；左上角 ★ 设常用；拖到「分类」改归类。
4. **选中** — 点卡片切换选中，右上角复选框显示状态，可多选。工具栏可全选 / 清空。
5. **应用** — 点「应用到本次会话」，看抽卡揭示动画，确认技能已进入本会话。
6. **随时撤销** — 再次打开面板，已应用的技能带标记，再点一次即从本会话移除。

### 技能从哪来

插件**不提供技能市场**，只展示**本机已安装**的技能。列表为空时，把技能目录放到以下任一位置后刷新：

| 位置 | 说明 |
| --- | --- |
| `~/.dsh/skills/` | DSH 用户技能根目录 |
| `~/.agents/skills/` | Agent CLI 安装位置（主力） |
| `~/.claude/skills/` | Claude 兼容技能池 |
| `<项目>/.dsh/skills/` | 项目级 |
| `<项目>/.agents/skills/` | 项目级 |

每个技能是一个**直接包含 `SKILL.md` 的目录**（或扁平的 `<name>.md`）。`$DSH_HOME` 可覆盖默认的 `~/.dsh`。

### 封面图自动识别

在技能目录（含 `SKILL.md` 的那一层）放下列任一文件名，即自动作为卡片插画：

```
cover.png   cover.jpg   cover.jpeg   cover.webp   cover.svg   preview.png   preview.jpg
```

想用任意图片，请用卡片上的「图片」按钮上传，或填 http(s) 图片链接。

---

## 🔌 HTTP API 参考

所有路由挂在 `/plugins/dsh-skill-cards/` 下，并做**同源校验**（跨域请求返回 403）。仅本机 DSH 使用，无鉴权需求，请勿反向代理暴露到公网。

### GET

| 路由 | 说明 |
| --- | --- |
| `skills?cwd=<path>` | 已安装技能列表 + 合并后的分类表 |
| `cards` | 全部自定义卡面配置 |
| `stats` | 分类 / ★ 常用 / 使用次数 + 自建分类 |
| `cover?skill=<name>` | 技能目录内的封面图（无则 404） |
| `image?id=<hash>.<ext>` | 上传图片回读（id 需匹配 `[a-f0-9]{24}\.(png\|jpe?g\|webp\|gif\|svg)`） |
| `active-session` | 当前活跃会话 id |
| `applied?sessionId=<id>` | 该会话已引入的技能名列表 |
| `vendor/three.min.js`、`vendor/card-back.jpg` | 插件自带的静态资源（白名单） |

### POST

| 路由 | body | 说明 |
| --- | --- | --- |
| `introduce` | `{ sessionId?, names: string[] }` | 把技能注册进**会话级** skills 服务 |
| `revoke` | `{ sessionId?, names: string[] }` | 从会话移除已引入的技能 |
| `cards` | `{ name, image?, title?, description?, i18n? }` | 写入卡面配置；`image: ''` 清除，`i18n: null` 清除中文层 |
| `i18n` | `{ items: [{ name, zh, zhDesc? }] }` | 批量写入中文卡名 |
| `stats` | `{ name, category?, starred? }` | 局部更新某技能统计 |
| `categories` | `{ action: "add"\|"rename"\|"remove", id?, label? }` | 分类管理 |
| `image` | raw body + `content-type: image/*` | 上传封面图，返回受保护的 URL |

---

## ⚙️ 工作原理

- **技能来源**：宿主端 [lib/skills-scan.js](lib/skills-scan.js) 扫描上述技能根，解析 `SKILL.md` 的 YAML frontmatter（`name` / `description`，支持行内、引号、块标量三种真实写法），并探测同目录封面图。
- **会话级引入**：`POST /introduce` → `ctx.get('agents')?.get(sessionId)` 取出当前会话的 agent → 对其**会话作用域**的 `skills` 服务调用 `register({ name, description, content, resourceBase, invocation, source })`。纯内存注册，重启前一直有效，不写任何技能目录。
- ** disposer 保留**：每次注册返回的 disposer 都存在 `sessionId → skillName → dispose` 的注册表里，因此技能**可以被撤销**；agent 移除时该表整块清理，避免出现「幽灵技能」。
- **当前会话判定**：设置页槽位能拿到 `useSessions` 的会话 id 并写入共享 store；从输入框按钮打开时拿不到，回退到宿主端跟踪的最近活跃会话。
- **数据落盘**：

| 文件 | 内容 |
| --- | --- |
| `~/.dsh/skill-cards.json` | 卡面配置（封面 URL / 标题 / 描述 / 中文层） |
| `~/.dsh/skill-cards-stats.json` | 分类 / ★ / 使用次数 / 自建分类（与配置分离，高频写不搅动布局） |
| `~/.dsh/skill-cards-images/` | 上传的图片原始字节（按 sha256 前 24 位命名） |

### 客户端加载契约（给二次开发者）

`window.__ModuleLoader__.load({ id, factory })` 的 `factory` **只接收 `require` 一个参数**，DSH 不会传入 `module` / `exports`。必须自己造：

```js
factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
  // ...
  exports.name = 'dsh-skill-cards'
  exports.inject = ['slots', 'locale']
  exports.apply = apply
  return exports
}
```

写成 `factory: (require, module) => { const exports = module.exports }` 会在启动时抛
`Cannot read properties of undefined (reading 'exports')`，导致 `web boot: 1 entry did not activate`，进而触发上面的配置重置。

---

## 🗂️ 目录结构

```
dsh-skill-cards/
├── package.json          # 插件清单（no-build，web 客户端）
├── cordis.patch.yml      # 纯 insert 补丁，热挂载
├── vendor/
│   ├── three.min.js      # three.js v0.152.2 UMD（3D 卡片墙，同源经典 <script> 加载）
│   └── card-back.jpg     # 卡背雕花纹理
├── lib/                  # ── 宿主端（Node）
│   ├── index.js          #   HTTP 路由 / vendor 静态文件 / 封面服务 / 会话引入
│   ├── skills-scan.js    #   枚举本机技能 + 解析 frontmatter + 探测封面
│   ├── stats.js          #   分类 / 常用 / 使用次数 + 智能分类建议
│   └── http.js           #   HTTP 辅助（sameOrigin 闸门 / JSON / 文件）
├── client/
│   └── client.js         # ── 浏览器端：入口按钮 + 设置面板 + 卡片浮层 + 3D 墙 + 出卡
├── diagnose/             # ── 脱离 DSH 的自测页（真实 React 渲染）
└── test/                 # ── node:test 单测（62 个）
```

---

## 🛠️ 开发

```bash
npm install      # 无运行时依赖，仅为 diagnose 页拉取 React UMD
npm test         # node --test，62 个用例
npm run check    # 对所有源码做 node --check 语法校验
npm run diagnose # 启动独立自测页 http://127.0.0.1:8940/diagnose/
```

**架构约束（改动时务必遵守）**

1. **宿主端只 `inject = ['webServer']`**。`skills` 是 agent 级服务，在根作用域 await 它会让 Cordis 的 `apply()` 永久挂起 —— 症状是按钮出现了但所有请求 404。需要 `agents` / `skills` 时用 `ctx.get()` **机会式**读取。
2. **路由前缀不带尾部斜杠**。宿主用 `pathname === prefix || pathname.startsWith(prefix + '/')` 匹配前缀路由，带斜杠会导致静默全量 404。
3. **绝不把 base64 写进配置**。图片以文件存储，配置只存同源 URL。
4. **`client/client.js` 不走构建**。JSX 需手工替换为 `React.createElement`，CSS 全部内联。
5. **只注入到会话作用域**。任何时候不要注册到宿主全局 skills 服务，否则会泄漏到所有会话。

---

## ❓ 疑难排查

| 症状 | 原因 / 解决 |
| --- | --- |
| 输入框下方没有「技能」按钮 | `conversation.input.right` 是会话级槽位，尚未进入会话时不渲染。改从 **设置 → 技能** 进入 |
| 同时开多个会话时应用到了错的会话 | 输入框入口拿不到会话 id，依赖「最近活跃会话」。从 **设置 → 技能** 进入可精确命中 |
| 卡片列表为空 | 技能没放在已识别的技能根目录（见上文表格）。放置后刷新 |
| 卡片没有插画 | 目录内没有 `cover.*` / `preview.*` 文件。用「图片」按钮上传或填 URL |
| 没有 3D 效果 | WebGL 不可用、three.js 加载失败或系统开了「减弱动态效果」—— 属自动降级，功能不受影响 |
| 弹窗一闪而过 / 设置空白 | 先跑 `npm run diagnose` 打开 `http://127.0.0.1:8940/diagnose/`，看诊断日志两行是否都是 ✅。❌ 则把红字与 F12 Console 报错反馈到 [Issues](https://github.com/baobao1994/dsh-skill-cards/issues) |
| 装上后其它插件全没了 | 手改了 profile 的 `package.json`。用官方安装器重新添加，见[安装](#-安装) |

### 单独自测 client.js

如果「点击技能弹窗一闪而过 / 设置空白」，先在真实 DSH 之外验证插件自身是否健康：

1. `npm run diagnose` → 打开 <http://127.0.0.1:8940/diagnose/>
2. 看「诊断日志」：两行都应是 ✅、无红色 ❌。
   - ✅ → client.js 在真实 React 下渲染正常 → 问题在 DSH 宿主侧。
   - ❌ → 把红字与浏览器控制台（F12 → Console）报错反馈回来。

该页自带本地 React 副本，只需一次 `npm run diagnose`，无需联网。

---

## 🤝 贡献

欢迎 PR！提交前请确保：

```bash
npm run check && npm test
```

- 新增功能同时补 `test/` 下的用例（当前 62 个）。
- 遵守上方 **架构约束** 五条，尤其是会话作用域与路由前缀。
- UI 改动请在支持 / 不支持 WebGL、以及「减弱动态效果」三种情形下各验一次。
- 中文与英文 README 同步更新。

---

## 📄 许可

[MIT](LICENSE) © 2026 gww

本插件与 DeepSeek 官方无隶属关系。技能内容由各自作者所有。