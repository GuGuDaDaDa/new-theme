/** Shared process and filesystem helpers for scaffold commands. */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
/** Resolve a project root and keep it inside the theme workspace. @param {string} projectRoot - Requested project root. @returns {string} Canonical project root. */
export function resolveProjectRoot(projectRoot = root) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim())
    throw new TypeError('projectRoot must be a non-empty path');
  const workspace = realpathSync(root);
  const candidate = realpathSync(path.resolve(projectRoot));
  const relative = path.relative(workspace, candidate);
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    (relative &&
      relative !== '.build' &&
      !relative.startsWith(`.build${path.sep}`))
  ) {
    throw new Error(
      `projectRoot must be the theme root or a managed .build child: ${projectRoot}`,
    );
  }
  return candidate;
}

/** Resolve a path for a managed directory without following an escaping symlink. @param {string} file - Candidate path. @returns {string} Canonical or safely parent-resolved path. */
function resolveManagedTarget(file) {
  const absolute = path.resolve(file);
  if (existsSync(absolute)) return realpathSync(absolute);
  return path.join(
    realpathSync(path.dirname(absolute)),
    path.basename(absolute),
  );
}

/** Run a child process without shell interpolation. @param {string} command - Executable. @param {string[]} args - Arguments. @param {string} projectRoot - Working project root. @returns {Promise<void>} Exit status. */
export function run(command, args, projectRoot = root) {
  const cwd = resolveProjectRoot(projectRoot);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    let diagnostics = '';
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`${command} exited: ${code ?? signal}\n${diagnostics}`),
          ),
    );
  });
}
/** Write a generated file, creating its directory. @param {string} file - Absolute filename. @param {string} text - Contents. @returns {Promise<void>} Completion. */
export async function write(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
/** Write JSON data. @param {string} file - Filename. @param {unknown} data - Serializable data. @returns {Promise<void>} Completion. */
export async function json(file, data) {
  await write(file, `${JSON.stringify(data, null, 2)}\n`);
}
/** List files recursively, ignoring absent optional directories. @param {string} dir - Directory. @returns {Promise<string[]>} Sorted paths. */
export async function files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Symlinks are not supported in build inputs: ${path.join(dir, entry.name)}`,
      );
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else result.push(file);
  }
  return result.sort();
}
/** Remove only managed build paths. @param {string} file - Absolute managed path. @param {string} projectRoot - Project root that owns the path. @returns {Promise<void>} Completion. */
export async function removeGenerated(file, projectRoot = root) {
  const owner = resolveProjectRoot(projectRoot);
  const target = resolveManagedTarget(file);
  const relative = path.relative(owner, target);
  if (
    !['.generated', '.build', 'public'].some(
      (name) => relative === name || relative.startsWith(`${name}${path.sep}`),
    )
  ) {
    throw new Error(`Refusing to remove unmanaged path: ${file}`);
  }
  await rm(target, { recursive: true, force: true });
}
/** Read JSON. @param {string} file - Filename. @returns {Promise<any>} Parsed value. */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}
