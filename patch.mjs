import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const packageRoot = process.env.DEVSPACE_PACKAGE_ROOT || join(homedir(), ".local/share/devspace-kit/node_modules/@waishnav/devspace");
const serverPath = join(packageRoot, "dist/server.js");
const packageJsonPath = join(packageRoot, "package.json");
const backupDir = process.env.DEVSPACE_PATCH_BACKUP_DIR || join(homedir(), ".devspace/patches/backups");
const supportedVersions = new Set(["1.0.8"]);

function replaceOnce(text, before, after, label) {
    const first = text.indexOf(before);
    if (first < 0) throw new Error(`Patch anchor not found: ${label}`);
    if (text.indexOf(before, first + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
    return text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceCount(text, before, after, expected, label) {
    const count = text.split(before).length - 1;
    if (count !== expected) throw new Error(`Patch anchor count mismatch for ${label}: expected ${expected}, got ${count}`);
    return text.split(before).join(after);
}

function mutationHelpers() {
    return `function workspaceRelativePath(workspaceRoot, absolutePath) {\n    const path = relative(workspaceRoot, absolutePath);\n    return path === \"\" ? \".\" : path.split(sep).join(\"/\");\n}\nfunction isProtectedWorkspacePath(workspaceRoot, absolutePath) {\n    const path = relative(workspaceRoot, absolutePath);\n    return path === \"\" || path === \".git\" || path.startsWith(\`.git\${sep}\`);\n}\nasync function lstatIfExists(path) {\n    try {\n        return await lstat(path);\n    }\n    catch (error) {\n        if (error && typeof error === \"object\" && error.code === \"ENOENT\")\n            return undefined;\n        throw error;\n    }\n}\nasync function assertMutationPathSafe(workspace, absolutePath, inputPath) {\n    if (isProtectedWorkspacePath(workspace.root, absolutePath)) {\n        throw new Error(\`Protected workspace path cannot be modified by this tool: \${inputPath}\`);\n    }\n    const canonicalRoot = await realpath(workspace.root);\n    const canonicalParent = await realpath(dirname(absolutePath));\n    if (!isPathInsideRoot(canonicalParent, canonicalRoot)) {\n        throw new Error(\`Path resolves outside workspace root through a symlink: \${inputPath}\`);\n    }\n}\n`;
}

function mutationToolsBlock() {
    return `        registerAppTool(server, toolNames.copy, {\n            title: \"Copy file or directory\",\n            description: \"Copy one file, symlink, or directory inside a workspace. Copying a directory requires recursive=true. The destination parent must already exist. Refuses to overwrite by default. Protected workspace paths such as the workspace root and .git cannot be used as destinations, symlinked parent directories may not resolve outside the workspace, and symlinks are copied without following their targets.\",\n            inputSchema: {\n                workspaceId: z\n                    .string()\n                    .describe(workspaceIdDescription),\n                sourcePath: z\n                    .string()\n                    .describe(\"Existing file, symlink, or directory path to copy, relative to the workspace root.\"),\n                destinationPath: z\n                    .string()\n                    .describe(\"Destination path, relative to the workspace root. Its parent directory must already exist.\"),\n                recursive: z\n                    .boolean()\n                    .optional()\n                    .default(false)\n                    .describe(\"Required when copying a directory. Defaults to false.\"),\n                overwrite: z\n                    .boolean()\n                    .optional()\n                    .default(false)\n                    .describe(\"Whether to replace an existing destination. Defaults to false.\"),\n            },\n            outputSchema: resultOutputSchema({\n                sourcePath: z.string(),\n                destinationPath: z.string(),\n                recursive: z.boolean(),\n                overwritten: z.boolean(),\n            }),\n            ...toolWidgetDescriptorMeta(config, \"edit\"),\n            annotations: EDIT_TOOL_ANNOTATIONS,\n        }, async ({ workspaceId, sourcePath, destinationPath, recursive, overwrite }) => {\n            const startedAt = performance.now();\n            const workspace = workspaces.getWorkspace(workspaceId);\n            const source = workspaces.resolvePath(workspace, sourcePath);\n            const destination = workspaces.resolvePath(workspace, destinationPath);\n            if (source === destination) {\n                throw new Error(\"Source and destination paths are the same.\");\n            }\n            const sourceEntry = await lstatIfExists(source);\n            if (!sourceEntry) {\n                throw new Error(\`Source path does not exist: \${sourcePath}\`);\n            }\n            await assertMutationPathSafe(workspace, source, sourcePath);\n            await assertMutationPathSafe(workspace, destination, destinationPath);\n            if (sourceEntry.isDirectory() && !sourceEntry.isSymbolicLink()) {\n                if (!recursive) {\n                    throw new Error(\`Directory copy requires recursive=true: \${sourcePath}\`);\n                }\n                if (isPathInsideRoot(destination, source)) {\n                    throw new Error(\`Cannot copy a directory inside itself: \${destinationPath}\`);\n                }\n            }\n            const destinationEntry = await lstatIfExists(destination);\n            if (destinationEntry && !overwrite) {\n                throw new Error(\`Destination already exists: \${destinationPath}\`);\n            }\n            if (destinationEntry && isPathInsideRoot(source, destination)) {\n                throw new Error(\`Cannot overwrite an ancestor of the source path: \${destinationPath}\`);\n            }\n            let backup;\n            if (destinationEntry) {\n                backup = \`\${destination}.devspace-copy-backup-\${randomUUID()}\`;\n                await rename(destination, backup);\n            }\n            try {\n                await cp(source, destination, { recursive: sourceEntry.isDirectory() && !sourceEntry.isSymbolicLink(), dereference: false, force: false, errorOnExist: true });\n            }\n            catch (error) {\n                if (backup) {\n                    await rm(destination, { recursive: true, force: true });\n                    await rename(backup, destination);\n                }\n                throw error;\n            }\n            if (backup) {\n                await rm(backup, { recursive: true, force: true });\n            }\n            const normalizedSource = workspaceRelativePath(workspace.root, source);\n            const normalizedDestination = workspaceRelativePath(workspace.root, destination);\n            const result = \`Copied \${normalizedSource} to \${normalizedDestination}\${destinationEntry ? \" (overwrote destination)\" : \"\"}.\`;\n            const content = [textBlock(result)];\n            logToolCall(config, {\n                tool: toolNames.copy,\n                workspaceId,\n                sourcePath: normalizedSource,\n                destinationPath: normalizedDestination,\n                recursive,\n                overwrite: !!destinationEntry,\n                success: true,\n                durationMs: Math.round(performance.now() - startedAt),\n            });\n            return {\n                content,\n                _meta: {\n                    tool: toolNames.copy,\n                    card: {\n                        workspaceId,\n                        path: normalizedDestination,\n                        summary: {\n                            sourcePath: normalizedSource,\n                            destinationPath: normalizedDestination,\n                            recursive,\n                            overwritten: !!destinationEntry,\n                        },\n                    },\n                },\n                structuredContent: {\n                    result,\n                    sourcePath: normalizedSource,\n                    destinationPath: normalizedDestination,\n                    recursive,\n                    overwritten: !!destinationEntry,\n                },\n            };\n        });\n        registerAppTool(server, toolNames.move, {\n            title: \"Move file or directory\",\n            description: \"Move or rename one existing file or directory inside a workspace. The destination parent must already exist. Refuses to overwrite by default. Protected workspace paths such as the workspace root and .git cannot be moved, and symlinked parent directories may not resolve outside the workspace.\",\n            inputSchema: {\n                workspaceId: z\n                    .string()\n                    .describe(workspaceIdDescription),\n                sourcePath: z\n                    .string()\n                    .describe(\"Existing file or directory path to move, relative to the workspace root.\"),\n                destinationPath: z\n                    .string()\n                    .describe(\"Destination path, relative to the workspace root. Its parent directory must already exist.\"),\n                overwrite: z\n                    .boolean()\n                    .optional()\n                    .default(false)\n                    .describe(\"Whether to replace an existing destination. Defaults to false.\"),\n            },\n            outputSchema: resultOutputSchema({\n                sourcePath: z.string(),\n                destinationPath: z.string(),\n                overwritten: z.boolean(),\n            }),\n            ...toolWidgetDescriptorMeta(config, \"edit\"),\n            annotations: EDIT_TOOL_ANNOTATIONS,
        }, async ({ workspaceId, sourcePath, destinationPath, overwrite }) => {\n            const startedAt = performance.now();\n            const workspace = workspaces.getWorkspace(workspaceId);\n            const source = workspaces.resolvePath(workspace, sourcePath);\n            const destination = workspaces.resolvePath(workspace, destinationPath);\n            if (source === destination) {\n                throw new Error(\"Source and destination paths are the same.\");\n            }\n            const sourceEntry = await lstatIfExists(source);\n            if (!sourceEntry) {\n                throw new Error(\`Source path does not exist: \${sourcePath}\`);\n            }\n            await assertMutationPathSafe(workspace, source, sourcePath);\n            await assertMutationPathSafe(workspace, destination, destinationPath);\n            if (sourceEntry.isDirectory() && !sourceEntry.isSymbolicLink() && isPathInsideRoot(destination, source)) {\n                throw new Error(\`Cannot move a directory inside itself: \${destinationPath}\`);\n            }\n            const destinationEntry = await lstatIfExists(destination);\n            if (destinationEntry && !overwrite) {\n                throw new Error(\`Destination already exists: \${destinationPath}\`);\n            }\n            if (destinationEntry && isPathInsideRoot(source, destination)) {\n                throw new Error(\`Cannot overwrite an ancestor of the source path: \${destinationPath}\`);\n            }\n            if (destinationEntry) {\n                const backup = \`\${destination}.devspace-move-backup-\${randomUUID()}\`;\n                await rename(destination, backup);\n                try {\n                    await rename(source, destination);\n                }\n                catch (error) {\n                    await rename(backup, destination);\n                    throw error;\n                }\n                await rm(backup, { recursive: true, force: true });\n            }\n            else {\n                await rename(source, destination);\n            }\n            const normalizedSource = workspaceRelativePath(workspace.root, source);\n            const normalizedDestination = workspaceRelativePath(workspace.root, destination);\n            const result = \`Moved \${normalizedSource} to \${normalizedDestination}\${destinationEntry ? \" (overwrote destination)\" : \"\"}.\`;\n            const content = [textBlock(result)];\n            logToolCall(config, {\n                tool: toolNames.move,\n                workspaceId,\n                sourcePath: normalizedSource,\n                destinationPath: normalizedDestination,\n                overwrite: !!destinationEntry,\n                success: true,\n                durationMs: Math.round(performance.now() - startedAt),\n            });\n            return {\n                content,\n                _meta: {\n                    tool: toolNames.move,\n                    card: {\n                        workspaceId,\n                        path: normalizedDestination,\n                        summary: {\n                            sourcePath: normalizedSource,\n                            destinationPath: normalizedDestination,\n                            overwritten: !!destinationEntry,\n                        },\n                    },\n                },\n                structuredContent: {\n                    result,\n                    sourcePath: normalizedSource,\n                    destinationPath: normalizedDestination,\n                    overwritten: !!destinationEntry,\n                },\n            };\n        });\n        registerAppTool(server, toolNames.delete, {\n            title: \"Delete file or directory\",\n            description: \"Delete one file, symlink, or directory inside a workspace. Deleting a non-empty directory requires recursive=true. The workspace root and .git are protected, and symlinked parent directories may not resolve outside the workspace. A symlink itself may be deleted without following its target.\",\n            inputSchema: {\n                workspaceId: z\n                    .string()\n                    .describe(workspaceIdDescription),\n                path: z\n                    .string()\n                    .describe(\"File, symlink, or directory path to delete, relative to the workspace root.\"),\n                recursive: z\n                    .boolean()\n                    .optional()\n                    .default(false)\n                    .describe(\"Required to delete a non-empty directory. Defaults to false.\"),\n            },\n            outputSchema: resultOutputSchema({\n                path: z.string(),\n                recursive: z.boolean(),\n            }),\n            ...toolWidgetDescriptorMeta(config, \"edit\"),\n            annotations: EDIT_TOOL_ANNOTATIONS,\n        }, async ({ workspaceId, path, recursive }) => {\n            const startedAt = performance.now();\n            const workspace = workspaces.getWorkspace(workspaceId);\n            const absolutePath = workspaces.resolvePath(workspace, path);\n            const entry = await lstatIfExists(absolutePath);\n            if (!entry) {\n                throw new Error(\`Path does not exist: \${path}\`);\n            }\n            await assertMutationPathSafe(workspace, absolutePath, path);\n            if (entry.isDirectory() && !entry.isSymbolicLink()) {\n                const children = await readdir(absolutePath);\n                if (children.length > 0 && !recursive) {\n                    throw new Error(\`Directory is not empty; set recursive=true to delete it: \${path}\`);\n                }\n                if (recursive)\n                    await rm(absolutePath, { recursive: true, force: false });\n                else\n                    await rmdir(absolutePath);\n            }\n            else {\n                await rm(absolutePath, { force: false });\n            }\n            const normalizedPath = workspaceRelativePath(workspace.root, absolutePath);\n            const result = \`Deleted \${normalizedPath}.\`;\n            const content = [textBlock(result)];\n            logToolCall(config, {\n                tool: toolNames.delete,\n                workspaceId,\n                path: normalizedPath,\n                recursive,\n                success: true,\n                durationMs: Math.round(performance.now() - startedAt),\n            });\n            return {\n                content,\n                _meta: {\n                    tool: toolNames.delete,\n                    card: {\n                        workspaceId,\n                        path: normalizedPath,\n                        summary: { recursive },\n                    },\n                },\n                structuredContent: {\n                    result,\n                    path: normalizedPath,\n                    recursive,\n                },\n            };\n        });\n`;
}

function copyToolBlock() {
    const block = mutationToolsBlock();
    const moveMarker = "        registerAppTool(server, toolNames.move, {";
    const moveIndex = block.indexOf(moveMarker);
    if (moveIndex < 0) throw new Error("Internal patch error: move tool marker not found.");
    return block.slice(0, moveIndex);
}

async function main() {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    let source = await readFile(serverPath, "utf8");

    const hasCopy = source.includes("registerAppTool(server, toolNames.copy");
    const hasMove = source.includes("registerAppTool(server, toolNames.move");
    const hasDelete = source.includes("registerAppTool(server, toolNames.delete");
    if (hasCopy && hasMove && hasDelete) {
        console.log(`[devspace-file-tools] copy/move/delete already present in @waishnav/devspace@${packageJson.version}`);
        return;
    }
    if (!supportedVersions.has(packageJson.version)) {
        throw new Error(`Unsupported @waishnav/devspace version ${packageJson.version}. Tested versions: ${[...supportedVersions].join(", ")}. Refusing to patch unknown generated output.`);
    }
    if (hasMove && hasDelete && !hasCopy) {
        const original = source;
        source = replaceOnce(
            source,
            'import { access, lstat, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";',
            'import { access, cp, lstat, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";',
            "filesystem copy import",
        );
        source = replaceOnce(
            source,
            '    edit: "edit",\n    move: "move",',
            '    edit: "edit",\n    copy: "copy",\n    move: "move",',
            "copy tool name",
        );
        source = replaceOnce(
            source,
            '        registerAppTool(server, toolNames.move, {',
            `${copyToolBlock()}        registerAppTool(server, toolNames.move, {`,
            "copy registration",
        );
        source = replaceOnce(
            source,
            'Prefer ${toolNames.edit} for targeted modifications, ${toolNames.write} only for new files or complete rewrites, ${toolNames.move} for moving or renaming existing files/directories, ${toolNames.delete} for explicit deletions, and ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that are better executed by the shell. Do not create, move, rename, or delete files with ${toolNames.shell}; avoid shell redirection, heredocs, tee, sed -i, perl -i, rm, mv, node/python/ruby scripts, or any command whose purpose is to write project files.',
            'Prefer ${toolNames.edit} for targeted modifications, ${toolNames.write} only for new files or complete rewrites, ${toolNames.copy} for copying existing files/directories, ${toolNames.move} for moving or renaming existing files/directories, ${toolNames.delete} for explicit deletions, and ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that are better executed by the shell. Do not create, copy, move, rename, or delete files with ${toolNames.shell}; avoid shell redirection, heredocs, tee, sed -i, perl -i, cp, rm, mv, node/python/ruby scripts, or any command whose purpose is to write project files.',
            "server copy instructions",
        );
        source = replaceCount(
            source,
            'Do not use ${toolNames.shell} to create, modify, move, rename, or delete files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, rm, mv, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes, ${toolNames.write} for new files or full rewrites, ${toolNames.move} for moving/renaming, and ${toolNames.delete} for deletions.',
            'Do not use ${toolNames.shell} to create, modify, copy, move, rename, or delete files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, cp, rm, mv, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes, ${toolNames.write} for new files or full rewrites, ${toolNames.copy} for copies, ${toolNames.move} for moving/renaming, and ${toolNames.delete} for deletions.',
            2,
            "bash copy descriptions",
        );
        source = replaceOnce(
            source,
            'Shell command to run. Must not create, modify, move, rename, or delete project files; use ${toolNames.edit}, ${toolNames.write}, ${toolNames.move}, or ${toolNames.delete} for file changes.',
            'Shell command to run. Must not create, modify, copy, move, rename, or delete project files; use ${toolNames.edit}, ${toolNames.write}, ${toolNames.copy}, ${toolNames.move}, or ${toolNames.delete} for file changes.',
            "bash copy input description",
        );

        await mkdir(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = join(backupDir, `server.js.${packageJson.version}.${stamp}.bak`);
        await copyFile(serverPath, backupPath);
        await writeFile(serverPath, source, "utf8");
        if (source === original) throw new Error("Patch made no changes unexpectedly.");
        console.log(`[devspace-file-tools] upgraded move/delete patch with copy for @waishnav/devspace@${packageJson.version}`);
        console.log(`[devspace-file-tools] backup: ${backupPath}`);
        return;
    }
    if (hasCopy || hasMove || hasDelete) {
        throw new Error("DevSpace copy/move/delete patch is partially applied in an unsupported state; reinstall the package before replaying the patch.");
    }

    const original = source;
    source = replaceOnce(
        source,
        'import { access, realpath } from "node:fs/promises";',
        'import { access, cp, lstat, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";\nimport { dirname, relative, sep } from "node:path";',
        "filesystem imports",
    );
    source = replaceOnce(
        source,
        '    edit: "edit",\n    grep: "grep",',
        '    edit: "edit",\n    copy: "copy",\n    move: "move",\n    delete: "delete",\n    grep: "grep",',
        "tool names",
    );
    source = replaceOnce(
        source,
        'const workspaceSkillOutputSchema = z.object({',
        `${mutationHelpers()}const workspaceSkillOutputSchema = z.object({`,
        "mutation helpers",
    );
    source = replaceOnce(
        source,
        '        });\n    }\n    if (config.toolMode === "codex") {\n        registerAppTool(server, "apply_patch", {',
        `        });\n${mutationToolsBlock()}    }\n    if (config.toolMode === "codex") {\n        registerAppTool(server, "apply_patch", {`,
        "copy/move/delete registration",
    );
    source = replaceOnce(
        source,
        'Prefer ${toolNames.edit} for targeted modifications, ${toolNames.write} only for new files or complete rewrites, and ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that are better executed by the shell. Do not create or modify files with ${toolNames.shell}; avoid shell redirection, heredocs, tee, sed -i, perl -i, node/python/ruby scripts, or any command whose purpose is to write project files.',
        'Prefer ${toolNames.edit} for targeted modifications, ${toolNames.write} only for new files or complete rewrites, ${toolNames.copy} for copying existing files/directories, ${toolNames.move} for moving or renaming existing files/directories, ${toolNames.delete} for explicit deletions, and ${toolNames.shell} for tests, builds, git inspection, package scripts, and commands that are better executed by the shell. Do not create, copy, move, rename, or delete files with ${toolNames.shell}; avoid shell redirection, heredocs, tee, sed -i, perl -i, cp, rm, mv, node/python/ruby scripts, or any command whose purpose is to write project files.',
        "server instructions",
    );
    source = replaceCount(
        source,
        'Do not use ${toolNames.shell} to create or modify files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes and ${toolNames.write} for new files or full rewrites.',
        'Do not use ${toolNames.shell} to create, modify, copy, move, rename, or delete files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, cp, rm, mv, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes, ${toolNames.write} for new files or full rewrites, ${toolNames.copy} for copies, ${toolNames.move} for moving/renaming, and ${toolNames.delete} for deletions.',
        2,
        "bash descriptions",
    );
    source = replaceOnce(
        source,
        'Shell command to run. Must not create or modify project files; use ${toolNames.edit} or ${toolNames.write} for file changes.',
        'Shell command to run. Must not create, modify, copy, move, rename, or delete project files; use ${toolNames.edit}, ${toolNames.write}, ${toolNames.copy}, ${toolNames.move}, or ${toolNames.delete} for file changes.',
        "bash input description",
    );

    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `server.js.${packageJson.version}.${stamp}.bak`);
    await copyFile(serverPath, backupPath);
    await writeFile(serverPath, source, "utf8");

    console.log(`[devspace-file-tools] applied copy/move/delete to @waishnav/devspace@${packageJson.version}`);
    console.log(`[devspace-file-tools] backup: ${backupPath}`);
    if (source === original) throw new Error("Patch made no changes unexpectedly.");
}

main().catch((error) => {
    console.error(`[devspace-file-tools] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
