# Agent Conductor 中文专家团

`agent-conductor-zh` 把 Agent Conductor 路由能力与
[`jnMetaCode/agency-agents-zh`](https://github.com/jnMetaCode/agency-agents-zh)
的 268 个中文专家角色打包为一个 Codex 插件。插件固定使用经过哈希校验的角色快照，
不会在安装或更新时从网络拉取角色内容。

## 访问与插件安装

This is a private repository. 只有仓库所有者和已授权 collaborator 能获取插件；
请先确保本机 Git 已登录可访问 `maaaaaa12138/Plugins`，不要共享私有仓库地址或凭据。

先克隆私有仓库，再把其中的 `Agent Conductor` 子目录添加为 marketplace：

```powershell
git clone git@github.com:maaaaaa12138/Plugins.git
codex plugin marketplace add "C:/path/to/Plugins/Agent Conductor"
codex plugin add agent-conductor-zh@personal
```

可用下面的命令确认 marketplace 与插件状态：

```powershell
codex plugin marketplace list
codex plugin list
```

## 两种运行方式

Compatibility mode 在插件安装后立即可用。路由器会从 bundled
`assets/agents/*.toml` 读取候选角色，并让 built-in `default` subagent 执行角色指令；
此时不要求先复制 268 个 TOML。

安装原生自定义 Agent 后，Codex 可以直接按候选 `slug` 选择角色。Global scope is the default，
目标目录为 `~/.codex/agents/`。Project scope is optional，目标目录为
`<project>/.codex/agents/`，必须显式提供绝对项目路径。

## Windows 管理命令

以下命令在插件目录中执行。先检查状态和 dry run，再执行真实安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action status -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -DryRun -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -Json
```

更新与卸载：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action update -DryRun -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action update -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action uninstall -DryRun -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action uninstall -Json
```

项目安装示例：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -Scope project -Project "C:\work\my-project" -DryRun -Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-agents.ps1 -Action install -Scope project -Project "C:\work\my-project" -Json
```

脚本要求 Node.js 18 或更高版本。可通过 `-NodePath` 或
`AGENT_CONDUCTOR_NODE` 指定运行时。

## Node 管理命令

非 Windows 环境可直接使用同一个管理核心：

```bash
node scripts/manage-agents.mjs status --json
node scripts/manage-agents.mjs install --dry-run --json
node scripts/manage-agents.mjs install --json
node scripts/manage-agents.mjs update --dry-run --json
node scripts/manage-agents.mjs update --json
node scripts/manage-agents.mjs uninstall --dry-run --json
node scripts/manage-agents.mjs uninstall --json
```

项目模式使用：

```bash
node scripts/manage-agents.mjs install --scope project --project /absolute/path/to/project --dry-run --json
```

## 冲突与安全规则

- 安装器先校验 manifest、角色数量、slug、路径和全部源文件 SHA-256，再创建目标目录。
- It will never overwrite a pre-existing unmanaged role or a managed role modified by the user.
- `update` 只替换仍与上次托管哈希一致的文件；`uninstall` 只删除仍与托管哈希一致的文件。
- 不提供隐式 force 模式。`conflict` 或 `modified` 必须逐文件人工处理。
- 已存在的 symbolic link、junction 或其他 reparse path 会被拒绝。
- 状态文件在提交前进行哈希比对；不要同时运行多个管理命令，也不要在运行中改动目标目录。

每个角色文件采用同目录临时文件、哈希复验和原子 rename。状态在角色动作全部完成后
才提交。如果进程恰好在部分角色已写入、状态尚未提交时中断，重试会把这些文件按
未托管冲突保留，不会自动覆盖；检查报告后再逐文件恢复。

## 刷新与排错

原生 Agent 安装、更新或卸载后，请创建一个 new Codex task，让 Agent 发现列表刷新。
已有任务仍可继续使用 bundled compatibility mode。

常见检查顺序：

1. 运行 `-Action status -Json` 查看 `missing`、`modified` 和 `conflict`。
2. 确认使用 Node.js 18 或更高版本。
3. 项目模式确认 `-Project` 是绝对路径。
4. 私有 marketplace 拉取失败时，先确认当前 Git 凭据仍有 collaborator 权限。

## 来源与许可证

角色内容来自 `jnMetaCode/agency-agents-zh`，固定上游提交记录在
`assets/roles-manifest.json`，依据 MIT License 再分发。完整上游许可证见
`LICENSES/agency-agents-zh-MIT.txt`，归属和快照信息见 `NOTICE.md`。
