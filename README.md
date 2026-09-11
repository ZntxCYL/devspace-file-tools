# DevSpace File Tools

Adds dedicated `copy`, `move`, and `delete` MCP tools to `@waishnav/devspace`.

The goal is to keep filesystem mutations structured and workspace-scoped instead of falling back to shell `cp`, `mv`, or `rm` commands.

## What it adds

After patching, DevSpace minimal/full mode exposes:

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

The added tools enforce the same workspace boundary model as DevSpace:

- paths must stay inside the opened workspace;
- workspace root and `.git` are protected;
- symlinked parent directories may not escape the workspace;
- `copy` refuses to overwrite by default;
- directory copies require `recursive=true`;
- `move` refuses to overwrite by default;
- deleting a non-empty directory requires `recursive=true`;
- symlinks are copied/deleted as symlinks instead of following their targets;
- DevSpace instructions are updated so shell `cp`, `mv`, and `rm` are not used as a bypass.

## Compatibility

Currently tested against:

| DevSpace package | Status |
| --- | --- |
| `@waishnav/devspace@1.0.8` | ✅ Tested |

Unknown DevSpace versions are refused by default rather than being patched against unverified internal anchors.

If a future DevSpace release ships all three tools natively, the patch exits successfully without changing anything.

## Install

Requirements:

- Node.js supported by your DevSpace installation
- an existing `@waishnav/devspace` installation

Clone this repository and run:

```bash
git clone https://github.com/ZntxCYL/devspace-file-tools.git
cd devspace-file-tools
bash install.sh
```

The installer looks for DevSpace in these locations:

1. `$DEVSPACE_PACKAGE_ROOT` when explicitly set;
2. `./node_modules/@waishnav/devspace`;
3. `~/.local/share/devspace-kit/node_modules/@waishnav/devspace`;
4. the global npm root.

For a custom installation:

```bash
DEVSPACE_PACKAGE_ROOT=/path/to/node_modules/@waishnav/devspace bash install.sh
```

Restart DevSpace after patching, then reconnect your MCP client so it refreshes the tool schema.

## What the patch changes

The patch modifies DevSpace's generated `dist/server.js` and creates a timestamped backup before writing changes:

```text
~/.devspace/patches/backups/
```

It is idempotent: running it again on an already-patched installation is a no-op.

Because this modifies generated package output, reinstalling or upgrading `@waishnav/devspace` can replace the patch. Run `./install.sh` again after an upgrade. If the new version is not explicitly supported, the patch will stop instead of guessing.

## Updating DevSpace

A safe workflow is:

```bash
cd ~/.local/share/devspace-kit
npm install --save-exact @waishnav/devspace@latest

cd /path/to/devspace-file-tools
bash install.sh
```

If the patch reports an unsupported DevSpace version, wait for this repository to add compatibility for that release or open an issue with the exact DevSpace version.

## Uninstall

The cleanest uninstall is to reinstall the official DevSpace package at the version you want, which restores its original generated files.

For example, in a local DevSpace kit:

```bash
npm install --save-exact @waishnav/devspace@1.0.8
```

## Why not shell commands?

`copy`, `move`, and `delete` are model-facing mutations. Dedicated MCP tools can validate workspace boundaries and make intent explicit before touching the filesystem. Shell commands are broader and much easier to misuse accidentally.

## License

MIT
