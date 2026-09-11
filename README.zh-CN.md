# DevSpace File Tools

[English](README.md) | **简体中文**

为 `@waishnav/devspace` 增加独立的 `copy`、`move` 和 `delete` MCP 工具。

目标是让文件系统修改保持结构化，并严格限制在 workspace 范围内，而不是退回到 shell 的 `cp`、`mv` 或 `rm` 命令。

## 增加了什么

应用补丁后，DevSpace 的 minimal/full 模式会提供：

```text
open_workspace
read
write
edit
copy
move
delete
bash
```

新增工具沿用 DevSpace 的 workspace 边界模型，并额外执行以下限制：

- 所有路径必须位于已打开的 workspace 内；
- workspace 根目录和 `.git` 受到保护；
- 通过符号链接解析后的父目录不得逃逸到 workspace 外；
- `copy` 默认拒绝覆盖已有目标；
- 复制目录时必须显式设置 `recursive=true`；
- `move` 默认拒绝覆盖已有目标；
- 删除非空目录时必须显式设置 `recursive=true`；
- 复制或删除符号链接时操作的是符号链接本身，不会跟随到链接目标；
- DevSpace 的工具说明也会同步更新，避免模型使用 shell 的 `cp`、`mv`、`rm` 绕过这些结构化工具。

## 兼容性

目前已测试：

| DevSpace 包版本 | 状态 |
| --- | --- |
| `@waishnav/devspace@1.0.8` | ✅ 已测试 |

对于尚未验证的 DevSpace 版本，补丁默认会拒绝执行，而不是基于未知的内部代码结构强行修改。

如果未来 DevSpace 官方已经原生提供全部三个工具，补丁会直接成功退出，不会重复修改。

## 安装

要求：

- Node.js 版本满足当前 DevSpace 的运行要求；
- 本机已经安装 `@waishnav/devspace`。

### 一条命令安装

推荐使用：

```bash
npx --yes github:ZntxCYL/devspace-file-tools
```

不需要发布到 npm registry：`npx` 会直接从这个 GitHub 仓库安装，并执行仓库里唯一的 CLI 入口。

也可以使用 shell bootstrap：

```bash
curl -fsSL https://raw.githubusercontent.com/ZntxCYL/devspace-file-tools/main/install.sh | bash
```

这个 bootstrap 安装器会自动从本仓库下载 `patch.mjs`、应用补丁，并在完成后删除临时文件。

如果你希望先检查代码再执行，也可以克隆仓库：

```bash
git clone https://github.com/ZntxCYL/devspace-file-tools.git
cd devspace-file-tools
bash install.sh
```

安装脚本会按以下顺序寻找 DevSpace：

1. 显式设置的 `$DEVSPACE_PACKAGE_ROOT`；
2. `./node_modules/@waishnav/devspace`；
3. `~/.local/share/devspace-kit/node_modules/@waishnav/devspace`；
4. npm 全局安装目录。

如果 DevSpace 安装在自定义位置，使用 `npx` 时可以这样指定：

```bash
DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace \
  npx --yes github:ZntxCYL/devspace-file-tools
```

使用 shell bootstrap 时：

```bash
curl -fsSL https://raw.githubusercontent.com/ZntxCYL/devspace-file-tools/main/install.sh | \
  DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace bash
```

如果已经克隆仓库，则仍可使用：

```bash
DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace bash install.sh
```

补丁完成后需要重启 DevSpace，并重新连接 MCP 客户端，让客户端重新获取工具 schema。

## 补丁会修改什么

补丁会修改 DevSpace 已生成的：

```text
dist/server.js
```

写入修改之前，会自动创建带时间戳的备份，默认保存在：

```text
~/.devspace/patches/backups/
```

补丁是幂等的：如果当前 DevSpace 已经应用过相同补丁，再次运行不会重复修改。

由于修改的是 npm 包内生成后的文件，重新安装或升级 `@waishnav/devspace` 可能会覆盖这些修改。升级后重新执行 `./install.sh` 即可。如果新版本还没有被明确支持，补丁会停止执行，而不是猜测新的代码结构。

## 升级 DevSpace

推荐的安全升级流程：

```bash
cd ~/.local/share/devspace-kit
npm install --save-exact @waishnav/devspace@latest

cd /path/to/devspace-file-tools
bash install.sh
```

如果补丁提示当前 DevSpace 版本不受支持，请等待本仓库增加该版本兼容性，或者提交 Issue，并附上准确的 DevSpace 版本号。

## 卸载

最干净的卸载方式是重新安装你需要的官方 DevSpace 版本，这会恢复官方原始的生成文件。

例如，在本地 DevSpace kit 中：

```bash
npm install --save-exact @waishnav/devspace@1.0.8
```

## 为什么不直接使用 shell 命令？

`copy`、`move` 和 `delete` 都属于模型可调用的文件修改操作。独立的 MCP 工具能够在真正修改文件前校验 workspace 边界，并让操作意图更加明确。

相比之下，shell 命令权限更宽，也更容易被模型意外误用。因此这里保留 `bash` 用于测试、构建、Git 检查等任务，而把文件复制、移动和删除交给专门的结构化工具处理。

## License

MIT
