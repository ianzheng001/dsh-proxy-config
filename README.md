# dsh-proxy-config

Configure outbound HTTP proxies for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) from the Settings UI, instead of relying on `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` in the shell that launched it.

Keep several named proxies (each with its own bypass list) and switch the **active** one with one click. An outbound proxy is a single process-wide dispatcher, so exactly one preset is installed at a time; switching writes one field and the new policy applies without restarting dsh.

English | [中文说明](#中文说明)

## Features

- **Multiple proxies, one active**: a `profiles` catalogue plus a single `active` pointer. Switching is a one-field write, and every other preset is inert by construction.
- **Settings UI**: card list with radio activation, add / edit / rename / delete, per-preset bypass, and one-click switching. Saving writes the profile patch and hot-applies it.
- **Per-preset bypass**: the common case (same network, different exit) is one click — a new preset inherits the active preset's bypass list.
- **Three routing modes**: `proxy` (install the active preset), `direct` (force everything direct and override the launcher's environment policy), `off` (leave the launcher policy alone).
- **Legacy configs keep working**: a pre-preset `proxy` + `bypass` patch still routes traffic; opening Settings once shows it as a preset and one save migrates it.
- **No runtime dependencies**: `schemastery` and `@deepseek-ai/dsh-http-proxy` are resolved from the dsh installation, so a linked checkout needs no `npm install`.
- Reuses dsh's own proxy library, so routing semantics match the launcher exactly.

## Requirements

- dsh ≥ `0.2.0-rc.2` (the Desktop app ships `0.2.1-rc.2`).
- `pnpm` (used internally by `dsh plugin`).

## Install

### Web / headless profile

```bash
dsh plugin --profile web add git+https://github.com/ianzheng001/dsh-proxy-config.git
```

For development, clone and link the directory (`dsh plugin add` uses pnpm link, no dependencies are installed):

```bash
git clone https://github.com/ianzheng001/dsh-proxy-config.git ~/git/dsh-proxy-config
dsh plugin --profile web add link:~/git/dsh-proxy-config
```

The package declares `dsh.bundle.patch`, so installing it adds its loader row automatically — no manual `insert` in `cordis.patch.yml`.

### DeepSeek Harness Desktop

The Desktop app uses its own `desktop` profile. Install through the app's Plugins panel (paste the repository URL or a local directory), or use the bundled CLI while the app is quit:

```bash
# 1. Quit DeepSeek Harness completely (Cmd+Q)
# 2. Install with the app's own CLI; the homebrew CLI refuses the desktop profile
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add git+https://github.com/ianzheng001/dsh-proxy-config.git

# 3. Reopen the app
```

## Configure

### In Settings (recommended)

**Settings → 出站代理**. The page edits the `proxy-config` entry of the current profile, writes through dsh's settings chain into `cordis.patch.yml` (comments preserved), and the Loader commits the change into the running plugin — no restart.

- Clicking a card's radio button activates that preset and writes immediately (any staged field edits are submitted atomically with it).
- Activating a preset from `direct` / `off` mode also switches the mode back to `proxy`.
- Deleting the active preset activates the first remaining one.
- Renaming the active preset updates `active` in the same write; duplicate names are rejected.

### In the profile patch

```yaml
- id: proxy-config
  config:
    mode: proxy              # proxy | direct | off; defaults to proxy
    active: corp             # exactly one preset name
    profiles:
      - name: corp
        proxy: proxy.example.com:8080   # http:// is added when no scheme is given
        bypass: [.example, .example.com, .local]
      - name: local
        proxy: http://127.0.0.1:7890
        bypass: []
```

- `profiles` is the catalogue; `active` must name one of its entries. An empty `active` installs nothing (the launcher's environment policy stays in place) rather than silently falling back.
- Per-scheme overrides are available per preset: `httpProxy`, `httpsProxy`, `allProxy`.
- Credentials may be embedded in the URL (`http://user:password@proxy.example.com:8080`); they are masked in logs.
- The pre-preset format still works while `profiles` is empty:

```yaml
- id: proxy-config
  config:
    proxy: http://127.0.0.1:7890
    bypass: [.example.com, .local]
```

## Modes

| Mode | Behaviour |
|------|-----------|
| `proxy` (default) | Install the active preset's proxy and bypass list. |
| `direct` | Force every request direct: installs the library's no-proxy policy, replacing the dispatcher the launcher built from `HTTP(S)_PROXY`. |
| `off` | Install nothing; keep whatever the launcher installed from the environment. |

`direct` is the only correct way to override an environment proxy — leaving `proxy` empty merely makes the plugin return early.

## Bypass semantics

- `example.com` also matches `api.example.com` (suffix match).
- A leading `.` and `*.` mean the same thing.
- Ports are allowed: `example.com:8443`.
- `*` bypasses everything.
- CIDR is **not** supported (`10.0.0.0/8` has no effect); use domain suffixes.
- Loopback addresses are always direct — the library forces this so dsh's own Web UI and local services cannot loop through the proxy.

## Limitations

- Only `http://` / `https://` proxies are supported. SOCKS URLs are reported and skipped, leaving that scheme direct.
- The policy is process-wide: every outbound `fetch()` goes through it (LLM requests, web search, HTTP MCP, web fetch).
- stdio child processes inherit the policy through the dsh subprocess environment logic (Node ≥ 22.21 / 24).
- `direct` mode does not clear proxy variables a child process already inherited; remove them from `~/.dsh/.env` if child processes must go direct too.

## Development

```bash
npm test                          # host e2e + browser-bundle smoke
dsh --profile web --dump-config 2>&1 | grep -A2 "id: proxy-config"
```

The tests link their peers from an installed dsh profile; no `npm install` is required.

## License

MIT. See [LICENSE](LICENSE).

---

# 中文说明

给 DeepSeek Harness (dsh) 配置出站 HTTP 代理的插件：在设置界面里维护多套代理（各带自己的 bypass），一键切换当前生效的那一套，不必再依赖启动 shell 的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。

出站代理是进程级单一路由（undici 全局 dispatcher），所以「多套代理」只能是**目录 + 单一 active 指针**：切换只写一个字段，其余配置原样保留且天然不生效，改完立即应用，无需重启 dsh。

## 功能

- **多套代理，只激活一套**：`profiles` 目录 + `active` 指针；点卡片上的单选按钮即切换。
- **设置界面**：卡片列表，新增 / 编辑 / 改名 / 删除 / 每套独立 bypass，保存即写入 profile patch 并热应用。
- **新增自动继承 bypass**：新建代理时从当前激活项复制 bypass 列表（同网络换出口的常见场景），地址自己填。
- **三种模式**：`proxy`（装激活的那一套）/ `direct`（强制全直连，覆盖 launcher 的环境变量策略）/ `off`（不干预）。
- **旧配置可用**：只有顶层 `proxy` + `bypass` 的 patch 继续生效；打开设置页会显示成一条代理，保存一次即完成迁移。
- **零运行时依赖**：`schemastery` 与 `@deepseek-ai/dsh-http-proxy` 都从 dsh 安装目录解析，link 安装不需要 `npm install`。
- 复用 dsh 自带的代理库，路由语义与 launcher 完全一致。

## 前置条件

- dsh ≥ `0.2.0-rc.2`（Desktop 自带 `0.2.1-rc.2`）。
- `pnpm`（`dsh plugin` 内部使用）。

## 安装

### Web / headless profile

```bash
dsh plugin --profile web add git+https://github.com/ianzheng001/dsh-proxy-config.git
```

开发时按本地目录 link（改代码后重启 dsh 生效）：

```bash
git clone https://github.com/ianzheng001/dsh-proxy-config.git ~/git/dsh-proxy-config
dsh plugin --profile web add link:~/git/dsh-proxy-config
```

包内声明了 `dsh.bundle.patch`，安装后会自动加入组合树，不需要手动在 `cordis.patch.yml` 里 `insert`。

### DeepSeek Harness Desktop

Desktop 使用独立的 `desktop` profile，推荐用 App 的插件面板安装（粘贴仓库地址或本地路径）。也可以用 App 自带 CLI（先 Cmd+Q 完全退出）：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add git+https://github.com/ianzheng001/dsh-proxy-config.git
```

## 配置

### 界面里改（推荐）

**设置 → 出站代理**。页面编辑当前 profile 的 `proxy-config` 条目，通过 dsh 的 settings 写入链落进 `cordis.patch.yml`（保留注释），Loader 把变化提交进运行中的插件——保存即生效，不用重启。

- 点卡片左侧单选即切换并立即写入；若同时有未保存的字段修改，会一并原子提交。
- 在「全部直连 / 不干预」模式下激活任意代理，会顺带把模式切回「走代理」。
- 删除当前激活项会自动激活剩下的第一套；改名会同步更新 `active`，重名会被拦下。

### 直接改 patch

```yaml
- id: proxy-config
  config:
    mode: proxy              # proxy | direct | off，缺省为 proxy
    active: corp             # 只能指向 profiles 里的一个 name
    profiles:
      - name: corp
        proxy: proxy.example.com:8080   # 不带 scheme 时自动补 http://
        bypass: [.example, .example.com, .local]
      - name: local
        proxy: http://127.0.0.1:7890
        bypass: []
```

- 每套代理可单独配置 `httpProxy` / `httpsProxy` / `allProxy` 覆盖。
- 凭据可以直接写在 URL 里（`http://user:password@proxy.example.com:8080`），日志中会打码。
- `profiles` 为空时仍按旧格式的顶层字段路由。

## 模式

| 模式 | 行为 |
|------|------|
| `proxy`（默认） | 安装激活项配置的代理与 bypass。 |
| `direct` | 强制全部直连：装库里的 no-proxy 策略，替换 launcher 从 `HTTP(S)_PROXY` 装的那套。 |
| `off` | 不装任何策略，保留 launcher 从启动环境变量装的那一套。 |

## bypass 语义

- `example.com` 同时匹配 `api.example.com`（子域后缀）。
- 前导 `.` 与 `*.` 等价。
- 支持端口：`example.com:8443`。
- `*` 表示全部直连。
- 不支持 CIDR；回环地址始终直连（由库强制，避免 dsh 自己的 Web UI 绕进代理）。

## 限制

- 只支持 `http://` / `https://` 代理；SOCKS 会被报告并跳过，该 scheme 走直连。
- 策略是进程级的：所有 `fetch()` 出站流量（LLM、web search、HTTP MCP、web fetch）都走它。
- stdio 子进程通过 dsh 的子进程环境逻辑继承（Node ≥ 22.21 / 24）。
- `direct` 模式不会清掉子进程已经继承的代理环境变量；需要子进程也直连时，清掉 `~/.dsh/.env` 里的代理变量。

## 开发

```bash
npm test                          # 宿主 e2e + client bundle 冒烟
dsh --profile web --dump-config 2>&1 | grep -A2 "id: proxy-config"
```

测试会从已安装的 dsh profile 软链 peer 依赖，不需要 `npm install`。

## 许可

MIT，见 [LICENSE](LICENSE)。
