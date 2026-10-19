# dsh-proxy-config

给 DeepSeek Harness (dsh) 用的出站 HTTP 代理配置插件。把这个插件的配置写在 profile 的 `cordis.patch.yml` 里，就能维护**多套**代理（各带自己的 bypass），并在设置界面里一键切换当前生效的那一套——不用再依赖启动 shell 的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量。

## 干什么

- 给 dsh 进程装一个全局出站代理策略，覆盖所有走 `fetch()` 的流量：LLM 请求、web search、HTTP MCP、web fetch。
- **多套代理，同一时间只生效一套**：出站代理是进程级单一路由，所以插件把代理做成一个「目录」（`profiles`）+ 一个 `active` 指针。切换只写 `active` 一个字段，其余配置原样保留、天然处于关闭状态，不需要逐个 disable。
- **设置里有图形界面**：设置 → 出站代理，卡片式代理列表（单选激活 / 新增 / 编辑 / 删除 / 每套独立 bypass），点单选即切换生效；另有三种全局模式（走代理 / 全部直连 / 不干预）。保存写入 profile patch 并热应用，不用重启。
- 支持 `http` / `https` 分 scheme 配置，支持 `bypass`（等价于 `NO_PROXY`）。
- 旧版单代理配置（顶层 `proxy` + `bypass`）继续可用；在设置页保存一次即自动迁移成第一条代理记录。
- 插件卸载/热替换时自动回滚到 launcher 原来的策略。
- 复用 dsh 自带的 `@deepseek-ai/dsh-http-proxy`，路由语义和官方实现完全一致（不是另写一套）。

## 前置条件

- dsh ≥ `0.2.0-rc.2`（Desktop App 内置 `0.2.1-rc.2`，homebrew CLI 是 `0.2.0-rc.2`，两者都行）。
- `pnpm`（dsh 自己的插件安装器就用它）。

## 安装（给同事）

**零运行时依赖**：`@deepseek-ai/schemastery` 和 `@deepseek-ai/dsh-http-proxy` 都从 dsh 安装目录解析，克隆后**不需要 `npm install`，也不需要访问 registry**。

```bash
# Web / headless profile：直接按仓库地址装（或不 clone 也行）
dsh plugin --profile web add git+https://github.com/ianzheng001/dsh-proxy-config.git

# 开发时：clone 后按本地绝对路径装，改代码只需重启
git clone https://github.com/ianzheng001/dsh-proxy-config.git ~/git/dsh-proxy-config
dsh plugin --profile web add ~/git/dsh-proxy-config
```

这个包声明了 `dsh.bundle.patch`，装完会自动加入 profile 的 bundle 列表，不需要手动在 patch 里 `insert`。

装到别的 profile 就换 `--profile`。desktop profile 见下一节。

### 装到 DeepSeek Harness Desktop

Desktop 走独立的 `desktop` profile，和 CLI 的 `web` profile 互不影响。**推荐用 App 自己的插件面板**（左侧「插件」→ 添加插件 → 粘贴仓库地址或本地绝对路径），那是 App 管理的安装路径。

也可以用它自带的 CLI：

```bash
# 1. 完全退出 DeepSeek Harness（Cmd+Q，确认进程已消失）
# 2. 用 Desktop 自带的 CLI 安装。homebrew 装的 dsh 对 desktop profile 会直接报
#    "managed exclusively by the Electron application"；Desktop 自带 CLI 带
#    manageDesktopProfile 权限，只有它放行 plugin 子命令。
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add git+https://github.com/ianzheng001/dsh-proxy-config.git

# 3. 在 ~/.dsh/profiles/desktop/cordis.patch.yml 里加同样的 - id: proxy-config 配置
# 4. 重新打开 Desktop
```

验证：打开 Desktop 的「插件」面板，`dsh-proxy-config` 应显示为已启用；运行中也可以在页面里查 `/api/pluginInventory/list`，`include:proxy-config` 的 `fiberPhase` 应为 `active`。

两点差异：

- Desktop 自带 dsh `0.2.1-rc.2`，homebrew CLI 是 `0.2.0-rc.2`；插件声明 peer `>=0.2.0-rc.2`，两者都能过兼容性检查。
- 插件按宿主的 `profileContext.installAnchor` 解析 `@deepseek-ai/dsh-http-proxy`（`schemastery` 同理，且是**加载期**解析），在 Desktop 里命中的是 `app.asar` 内那一份，和 launcher 用的是同一个模块实例。若按裸包名解析会拿到 homebrew 的副本，进程内 fetch 仍会被代理，但 `proxyEnvironmentForChild()` 读不到策略，stdio 子进程会丢代理。

## 配置

两种方式，写的是同一份东西（profile 的 `cordis.patch.yml`）：

### 界面里改（推荐）

**设置 → 出站代理**（Settings → 出站代理）。页面读的是当前 profile 的 `proxy-config` 条目，保存时通过 dsh 的 settings 写入链写回 patch 文件、保留 YAML 注释，然后由 Loader 把新值提交进运行中的插件引用并重新安装代理策略——**保存即生效，不用重启**。

界面暴露的字段：

- **模式**：`proxy` / `direct` / `off` 三选一（见下表）。
- **代理列表**：每张卡片 = 一套代理，字段为 `name`（唯一）、`proxy`、`httpProxy` / `httpsProxy` / `allProxy`（卡片里收起在「分协议配置」）、`bypass`（芯片式增删）。
- **单选钮 = 立即切换**：点一下就写入 `active` 并重新安装策略；如果当时还有未保存的字段修改，会一起原子提交。激活任意一套时会顺带把模式切回 `proxy`。
- 删除当前激活项会自动激活列表里的第一套，不会留下「无激活」状态。
- 改了激活项的名字，`active` 会在同一次写入里跟着改；重名会被拦下（激活项按名字定位）。
- 若 profile 里还是旧版的顶层 `proxy` / `bypass`，页面会显示成「默认」这一套并提示迁移；点保存即写入 `profiles` + `active` 并清掉旧字段。

`log` 只能在 patch 里改。

三种模式：

| 模式 | 行为 |
|------|------|
| `proxy`（默认） | 按配置的代理地址 + bypass 装策略 |
| `direct` | **强制全部直连**：装库里的 no-proxy 策略，替换 launcher 从 `HTTP(S)_PROXY` 装的那套 dispatcher。代理字段保留但不生效 |
| `off` | 不装任何策略，保留 launcher 从启动环境变量装的那一套 |

`direct` 是插件能"关掉环境变量代理"的唯一正确做法——`proxy` 留空时插件是早退的，环境变量策略仍然生效。

页面按设计方案挂在设置导航里，不复用 `plugins.row.config`；这是因为它编辑的是自己这一行的配置，而不是某个组合包的配置页。

### 直接改 patch

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: proxy-config
  config:
    mode: proxy              # 全局模式，可省略（默认 proxy）
    active: corp             # 唯一激活项，按 name 引用
    profiles:
      - name: corp
        proxy: proxy.example.com:8080    # 不带 scheme 时自动补 http://
        bypass: [.example, .example.com, .local] # 不走代理的域名后缀
      - name: clash
        proxy: http://127.0.0.1:7897
        bypass: []
```

- `profiles` 是一个目录，`active` 只能指向其中一条；没有 `active` 就什么都不装（保留 launcher 的环境变量策略），不会偷偷回退到别的代理。
- 每套代理可以只配 https：

```yaml
      - name: only-https
        httpsProxy: http://127.0.0.1:7890
```

- 需要认证的代理直接把凭据写进 URL（日志里会被打码）：

```yaml
      - name: authed
        proxy: http://user:password@127.0.0.1:7890
```

- 旧格式仍然有效，`profiles` 为空时按顶层字段路由：

```yaml
- id: proxy-config
  config:
    proxy: http://127.0.0.1:7890
    bypass: [.example.com, .local]
```

### 字段

| 字段 | 默认 | 说明 |
|------|------|------|
| `mode` | 无（等价 `proxy`） | `proxy` / `direct` / `off`，见上表 |
| `active` | `''` | 当前激活的 `profiles[].name`；空 = 不装策略 |
| `profiles` | `[]` | 代理目录，每条含 `name` / `proxy` / `httpProxy` / `httpsProxy` / `allProxy` / `bypass` |
| `enabled` | `true` | **已废弃**：`false` 等价 `mode: off`，仅为兼容旧 patch 保留 |
| `proxy` | `''` | **旧格式**：`profiles` 为空时两种 scheme 共用的代理地址 |
| `httpProxy` | `''` | **旧格式**：覆盖 `proxy`，仅 `http:` |
| `httpsProxy` | `''` | **旧格式**：覆盖 `proxy`，仅 `https:` |
| `allProxy` | `''` | **旧格式**：某个 scheme 自己没配时使用 |
| `bypass` | `''` | **旧格式**：字符串（逗号/空格分隔）或 YAML 列表 |
| `log` | `true` | 是否在安装时写一条日志 |

### bypass 语义

- `example.com` 同时匹配 `api.example.com`（按子域后缀匹配）。
- 前导 `.` 和 `*.` 等价，都表示后缀匹配。
- 可以带端口：`example.com:8443`。
- `*` 表示全部直连。
- **不支持 CIDR**（`10.0.0.0/8` 不会生效），请改写成域名后缀。
- 回环地址（`localhost`、`127.0.0.0/8`、`::1`、`0.0.0.0`）永远直连，这是 dsh 内置策略强制的，避免 dsh 自己的 Web UI 和本地服务被代理绕成死循环。

### 限制

- 只支持 `http://` / `https://` 代理。SOCKS 会被报告并跳过，该 scheme 走直连。
- 策略是进程级的：配了代理，MCP 子进程以外的所有出站请求都会走它。stdio 子进程通过 `NODE_USE_ENV_PROXY` 继承（需要 Node 22.21+ 或 24+），由 dsh 自带的子进程环境逻辑处理。
- 只影响 dsh 进程；浏览器自己的代理设置由系统决定。
- **`direct` 模式不改变子进程看到的环境变量**：库在装直连 dispatcher 时会把它继承的代理变量写回 `process.env`，所以 stdio MCP 子进程仍按环境变量走。要连子进程一起直连，得清掉 `~/.dsh/.env` 里的代理变量（当前配置没有这些变量，无影响）。

## 与 `~/.dsh/.env` 的关系

dsh launcher 在插件加载之前就会读环境变量装一次代理策略。插件是在它之上再叠一层：

- 不配置这个插件 → 行为完全等于原生 `HTTP_PROXY` 那套。
- 配置了这个插件 → 插件策略生效，插件卸载后回滚到环境变量策略。
- 两种都想要就用插件（优先级更明确、可按 profile 区分）；只想机器级默认就用 `~/.dsh/.env`。

## 验证

```bash
# 0. 界面验证：设置 → 出站代理，能看到当前策略、改完保存、看 patch 文件是否变了
# 1. 确认 entry 在组合后的树里
dsh --profile web --dump-config | grep -A2 "id: proxy-config"

# 2. 插件自带测试：两个假代理 + .invalid 域名，断言激活/切换/失效的代理都不串流量
cd tool_dsh_proxy_plugin && npm test
# 单跑：
#   node test/proxy-e2e.mjs    # 宿主半侧：路由、切换、apply() 热重装
#   node test/client-smoke.mjs # 浏览器半侧 bundle：IIFE 包裹、注册、inject 契约
```

实测方法：把 `proxy` 指向一个会记录访问的本地代理，启动 `dsh web`，看代理侧是否出现 dsh 的出站 `CONNECT`；在 `bypass` 里加上目标域名后再启动，应当不再出现。

## 卸载

```bash
dsh plugin --profile web remove dsh-proxy-config
```

## 目录

```
tool_dsh_proxy_plugin/
├── lib/index.js           # 宿主半侧：profiles/active → 环境视图 → installProxyFromEnvironment
├── lib/client.js          # 浏览器半侧：设置 → 出站代理 卡片列表（读写 proxy-config 条目）
├── cordis.patch.yml       # bundle patch，安装后自动插入 proxy-config 这一行
├── test/proxy-e2e.mjs     # 假代理端到端断言（含 apply() 热重装与多代理切换）
├── test/client-smoke.mjs  # bundle 冒烟：IIFE/注册/inject
└── test/link-deps.mjs     # 测试时从已装 profile 软链 peer 依赖
```
