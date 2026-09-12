/** Tailwind CLI and esbuild resource compilation. */
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { json, root, run } from './lib.mjs';

/** Compile CSS and split ES modules into generated inputs. @param {string} generated - Generated directory. @param {boolean} development - Emit source maps when true. @param {string} projectRoot - Project root containing source assets. @returns {Promise<void>} Completion. */
export async function buildAssets(
  generated,
  development = false,
  projectRoot = root,
) {
  const sourceRoot = path.resolve(projectRoot);
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
  const outputDir = path.join(generated, 'static/night-theme/js');
  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: ['assets/js/main.js'],
    outdir: outputDir,
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
    main: `night-theme/js/${path.basename(entry[0])}`,
  });
  // Only remove obsolete compiler outputs inside this dedicated asset directory.
  const emitted = new Set(
    Object.keys(result.metafile.outputs).map((file) =>
      path.resolve(sourceRoot, file),
    ),
  );
  for (const directory of [outputDir, path.join(outputDir, 'chunks')]) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, file.name);
      if (
        file.isFile() &&
        /\.js(?:\.map)?$/.test(file.name) &&
        !emitted.has(target)
      )
        await unlink(target);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildAssets(root, false, root);
}
