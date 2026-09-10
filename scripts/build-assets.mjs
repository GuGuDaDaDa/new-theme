/** Tailwind CLI and esbuild resource compilation. */
import { build } from 'esbuild';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { json, root, resolveProjectRoot, run } from './lib.mjs';

/** Compile CSS and split ES modules into generated inputs. @param {string} generated - Generated directory. @param {boolean} development - Emit source maps when true. @param {string} projectRoot - Project root containing source assets. @returns {Promise<void>} Completion. */
export async function buildAssets(
  generated,
  development = false,
  projectRoot = root,
) {
  const sourceRoot = resolveProjectRoot(projectRoot);
  await mkdir(path.join(generated, 'assets/css'), { recursive: true });
  await run(
    process.execPath,
    [
      path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
      '-i',
      path.join(sourceRoot, 'assets/css/main.css'),
      '-o',
      path.join(generated, 'assets/css/compiled.css'),
      ...(development ? [] : ['--minify']),
    ],
    sourceRoot,
  );
  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: ['assets/js/main.js'],
    outdir: path.join(generated, 'static/js'),
    nodePaths: [path.join(root, 'node_modules')],
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2022'],
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    sourcemap: development ? 'linked' : false,
    minify: !development,
  });
  const entry = Object.entries(result.metafile.outputs).find(
    ([, value]) => value.entryPoint === 'assets/js/main.js',
  );
  if (!entry) throw new Error('esbuild did not emit main entry');
  await json(path.join(generated, 'data/night_assets.json'), {
    main: `js/${path.basename(entry[0])}`,
  });
}
