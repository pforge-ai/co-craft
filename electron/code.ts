import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { CodeComponent } from '../src/core/types';
export async function compileComponent(
  source: string,
  id: string,
  name: string,
  cwd: string,
  props: CodeComponent['props'] = {},
  sourceDirectory = cwd,
): Promise<CodeComponent> {
  const unpacked = join(
    process.resourcesPath || '',
    'app.asar.unpacked',
    'node_modules',
    '@esbuild',
    `darwin-${process.arch}`,
    'bin',
    'esbuild',
  );
  if (existsSync(unpacked)) process.env.ESBUILD_BINARY_PATH = unpacked;
  const { build } = await import('esbuild');
  const root = await realpath(cwd);
  const resolveDir = await realpath(sourceDirectory);
  const subdir = relative(root, resolveDir);
  if (subdir === '..' || subdir.startsWith('../') || isAbsolute(subdir))
    throw new Error('组件入口必须位于工程工作区');
  const result = await build({
    absWorkingDir: cwd,
    stdin: { contents: source, loader: 'tsx', resolveDir, sourcefile: `${name}.tsx` },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'transform',
    external: [
      'react',
      'remotion',
      'react/jsx-runtime',
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/addons/loaders/GLTFLoader.js',
      '@remotion/three',
    ],
    logLevel: 'silent',
    plugins: [
      {
        name: 'project-files',
        setup(builder) {
          builder.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
            const path = await realpath(args.path);
            if (path !== root && !path.startsWith(root + '/')) throw new Error('组件依赖必须位于项目工作区');
            return undefined;
          });
        },
      },
    ],
  });
  const compiled = result.outputFiles[0].text;
  return {
    id,
    name,
    source,
    compiled,
    props,
    hash: createHash('sha256')
      .update(source + compiled)
      .digest('hex'),
  };
}
