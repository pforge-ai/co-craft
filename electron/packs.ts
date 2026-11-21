import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { compileComponent } from './code';
import { importMedia } from './media';
import type { ProjectStore } from './store';
import type { Asset, CodeComponent, EditOperation, Project } from '../src/core/types';
import type { PresetParameter } from '../src/core/presets';

interface PackTemplate {
  id: string;
  name: string;
  entry: string;
  durationSeconds: number;
  defaultProps?: CodeComponent['props'];
  parameters?: PresetParameter[];
}
interface PackAsset {
  id: string;
  path: string;
  name?: string;
  license?: string;
  sourceUrl?: string;
}
export interface MaterialPackManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  homepage?: string;
  templates?: PackTemplate[];
  assets?: PackAsset[];
}
export interface PackedComponent extends CodeComponent {
  pack: {
    id: string;
    name: string;
    version: string;
    author: string;
    license: string;
    durationSeconds: number;
    parameters?: PresetParameter[];
    sourceDirectory: string;
    fingerprint: string;
    entry: string;
  };
}
const identifier = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const sourceExtension = /\.(?:[cm]?[tj]sx?|json|md)$/i;
const mediaExtension = /\.(?:png|jpe?g|webp|svg|gif|avif|mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|flac)$/i;
const reservedKeys = new Set(['__proto__', 'prototype', 'constructor', 'assetUrl', 'assets', 'key', 'ref']);
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const validProp = (key: string) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && !reservedKeys.has(key);

function validateParameters(template: PackTemplate) {
  const defaults = template.defaultProps ?? {};
  if (typeof defaults !== 'object' || Array.isArray(defaults)) throw new Error('模板默认参数必须是对象');
  for (const [key, value] of Object.entries(defaults)) {
    if (
      !validProp(key) ||
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('模板默认参数需要有效的参数名和文字、有限数字或布尔值');
  }
  if (template.parameters !== undefined && !Array.isArray(template.parameters))
    throw new Error('模板参数定义必须是列表');
  const keys = new Set<string>();
  for (const parameter of template.parameters ?? []) {
    if (
      !parameter ||
      !validProp(parameter.key) ||
      keys.has(parameter.key) ||
      !text(parameter.label) ||
      !Object.hasOwn(defaults, parameter.key)
    )
      throw new Error('参数需要唯一名称、控件标签和默认值');
    keys.add(parameter.key);
    const value = defaults[parameter.key];
    switch (parameter.type) {
      case 'number': {
        if (
          typeof value !== 'number' ||
          ![parameter.min, parameter.max, parameter.step].every(
            (n) => n === undefined || Number.isFinite(n),
          ) ||
          (parameter.step !== undefined && parameter.step <= 0) ||
          value < (parameter.min ?? -Infinity) ||
          value > (parameter.max ?? Infinity)
        )
          throw new Error('数字参数的默认值、范围或步长无效');
        break;
      }
      case 'text':
        if (typeof value !== 'string') throw new Error('文字参数需要字符串默认值');
        break;
      case 'color':
        if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
          throw new Error('颜色参数需要六位十六进制色值');
        break;
      case 'boolean':
        if (typeof value !== 'boolean') throw new Error('开关参数需要布尔默认值');
        break;
      case 'select': {
        const options = parameter.options;
        if (
          !Array.isArray(options) ||
          !options.length ||
          options.some((o) => !o || !text(o.label) || typeof o.value !== 'string') ||
          new Set(options.map((o) => o.value)).size !== options.length ||
          !options.some((o) => o.value === value)
        )
          throw new Error('选项的默认值必须属于唯一的候选值列表');
        break;
      }
      default:
        throw new Error('素材包包含尚未支持的参数类型');
    }
  }
}

function validateManifest(pack: MaterialPackManifest) {
  if (
    !pack ||
    pack.schemaVersion !== 1 ||
    !text(pack.id) ||
    !identifier.test(pack.id) ||
    ![pack.name, pack.version, pack.author, pack.license].every(text)
  )
    throw new Error('素材包需要有效的清单、标识、版本、作者与许可');
  if (
    (pack.templates !== undefined && !Array.isArray(pack.templates)) ||
    (pack.assets !== undefined && !Array.isArray(pack.assets)) ||
    !(pack.templates?.length || pack.assets?.length)
  )
    throw new Error('请声明素材包内的模板或媒体');
  const templates = pack.templates ?? [],
    assets = pack.assets ?? [];
  const uniqueIds = (items: { id: string }[]) =>
    items.every((i) => i && text(i.id) && identifier.test(i.id)) &&
    new Set(items.map((i) => i.id)).size === items.length;
  if (!uniqueIds(templates) || !uniqueIds(assets)) throw new Error('模板和媒体需要各自唯一的标识');
  for (const template of templates) {
    if (
      !text(template.name) ||
      !Number.isFinite(template.durationSeconds) ||
      template.durationSeconds < 0.1 ||
      template.durationSeconds > 3600
    )
      throw new Error('模板需要名称与有效时长');
    if (
      !text(template.entry) ||
      basename(template.entry) !== template.entry ||
      !/\.[tj]sx?$/i.test(template.entry)
    )
      throw new Error('模板入口应位于素材包根目录，支持 JS、JSX、TS 或 TSX');
    validateParameters(template);
  }
  for (const asset of assets)
    if (!text(asset.path) || !mediaExtension.test(asset.path))
      throw new Error('素材包包含无法导入的媒体格式');
}

async function packageFile(root: string, name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name
      .split('/')
      .some(
        (part) => !part || part === '.' || part === '..' || part.startsWith('.') || part === 'node_modules',
      )
  )
    throw new Error('素材包文件必须使用目录内的相对路径');
  const path = resolve(root, name);
  if ((await realpath(path)) !== path || !(await stat(path)).isFile())
    throw new Error('素材包文件必须是目录内的普通文件');
  return path;
}

async function sourceFiles(root: string, sub = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = join(sub, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(root, name)));
    else if (entry.isFile() && sourceExtension.test(entry.name)) result.push(name);
  }
  return result;
}

async function snapshot(root: string, staged: string, manifest: MaterialPackManifest) {
  const names = new Set([...(await sourceFiles(root)), ...(manifest.assets ?? []).map((a) => a.path)]);
  const fingerprint = createHash('sha256');
  for (const name of [...names].sort()) {
    const source = await packageFile(root, name),
      target = join(staged, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    fingerprint.update(JSON.stringify([name, hash.digest('hex')]) + '\n');
  }
  // Ignore changes to the source folder after this snapshot. Detect a mixed
  // manifest if the author saved new declarations while files were copying.
  const packed = await readFile(join(staged, 'cocraft-pack.json'), 'utf8');
  if (JSON.stringify(JSON.parse(packed)) !== JSON.stringify(manifest))
    throw new Error('复制期间素材包发生变更，请重新导入');
  return fingerprint.digest('hex');
}

/** All validation and compilation use the staged copy. A completed directory is installed with one rename. */
export async function importMaterialPack(
  folder: string,
  projectPath: string,
  current?: Pick<Project, 'components' | 'assets'>,
): Promise<{
  operations: EditOperation[];
  packName: string;
  components: PackedComponent[];
  assets: Asset[];
}> {
  const root = await realpath(folder);
  const pack = JSON.parse(
    await readFile(await packageFile(root, 'cocraft-pack.json'), 'utf8'),
  ) as MaterialPackManifest;
  validateManifest(pack);
  const storage = join(await realpath(projectPath), 'components', 'packs');
  await mkdir(storage, { recursive: true });
  const stage = await mkdtemp(join(storage, '.import-'));
  try {
    const fingerprint = await snapshot(root, stage, pack),
      sourceDirectory = join(storage, `${pack.id}-${fingerprint}`);
    const assets: Asset[] = [],
      components: PackedComponent[] = [],
      operations: EditOperation[] = [];
    const assetIds = new Map<string, string>();
    for (const item of pack.assets ?? []) {
      const id = `asset_pack_${pack.id}_${item.id}_${fingerprint}`;
      assetIds.set(item.id, id);
      const saved = current?.assets.find((a) => a.id === id);
      if (saved) {
        assets.push(saved);
        continue;
      }
      const path = await packageFile(stage, item.path),
        probed = await importMedia(path, stage);
      let thumbnail: string | undefined;
      if (probed.thumbnail === path) thumbnail = join(sourceDirectory, item.path);
      else if (probed.thumbnail) {
        const dest = join(stage, '.previews', item.id + '.jpg');
        await mkdir(dirname(dest), { recursive: true });
        await rename(probed.thumbnail, dest);
        thumbnail = join(sourceDirectory, relative(stage, dest));
      }
      const asset: Asset = {
        ...probed,
        id,
        path: join(sourceDirectory, item.path),
        thumbnail,
        name: item.name || basename(item.path),
        source: {
          provider: pack.name,
          author: pack.author,
          license: item.license || pack.license,
          url: item.sourceUrl || pack.homepage,
        },
      };
      assets.push(asset);
      operations.push({ type: 'addAsset', asset });
    }
    for (const template of pack.templates ?? []) {
      const id = `pack_${pack.id}_${template.id}_${fingerprint}`;
      const saved = current?.components.find((c) => c.id === id) as PackedComponent | undefined;
      if (saved) {
        components.push(saved);
        continue;
      }
      const props: CodeComponent['props'] = { ...template.defaultProps };
      for (const [key, value] of Object.entries(props)) {
        if (typeof value !== 'string' || !value.startsWith('@asset/')) continue;
        const assetId = assetIds.get(value.slice(7));
        if (!assetId) throw new Error(`模板引用了未声明的素材 ${value}`);
        props[key] = assetId;
      }
      const entry = await readFile(await packageFile(stage, template.entry), 'utf8');
      const compiled = await compileComponent(entry, id, template.name, stage, props);
      const componentHash = createHash('sha256').update(compiled.hash).update(fingerprint).digest('hex');
      const component: PackedComponent = {
        ...compiled,
        hash: componentHash,
        pack: {
          id: pack.id,
          name: pack.name,
          version: pack.version,
          author: pack.author,
          license: pack.license,
          durationSeconds: template.durationSeconds,
          parameters: template.parameters,
          sourceDirectory,
          fingerprint,
          entry: template.entry,
        },
      };
      components.push(component);
      operations.push({ type: 'putComponent', component });
    }
    await rm(join(stage, '.cocraft'), { recursive: true, force: true });
    try {
      await rename(stage, sourceDirectory);
    } catch (error) {
      if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      // An identical import won the race or already belongs to an older revision.
    }
    return { packName: pack.name, components, assets, operations };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function safeAsciiSlug(input: string, fallbackPrefix: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-_.]+$/g, '')
    .slice(0, 36);
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 6);
  return cleaned ? `${cleaned}-${hash}`.slice(0, 63) : `${fallbackPrefix}-${hash}`;
}

export async function exportMaterialPack(
  store: ProjectStore,
  options: {
    targetDir: string;
    name?: string;
    assetIds?: string[];
    componentIds?: string[];
    vaultIds?: string[];
    author?: string;
    license?: string;
  },
): Promise<{ directory: string; manifest: MaterialPackManifest }> {
  const project = await store.project();
  const packName = options.name?.trim() || `${project.name}-素材包`;
  const packId = safeAsciiSlug(packName, 'cocraft-pack');
  const exportDir = join(resolve(options.targetDir), packId);
  await mkdir(join(exportDir, 'assets'), { recursive: true });

  const selectedAssetSet = new Set(options.assetIds || []);
  const selectedCompSet = new Set(options.componentIds || []);
  for (const vid of options.vaultIds || []) {
    const v = (project.vault || []).find((x) => x.id === vid);
    if (!v) continue;
    if (v.assetId) selectedAssetSet.add(v.assetId);
    for (const vr of v.variants || []) {
      if (vr.assetId) selectedAssetSet.add(vr.assetId);
    }
    if (v.rig?.componentId) selectedCompSet.add(v.rig.componentId);
    for (const clip of v.compound?.clips || []) {
      if (clip.assetId) selectedAssetSet.add(clip.assetId);
      if (clip.componentId) selectedCompSet.add(clip.componentId);
    }
  }
  const hasExplicitSelection =
    (options.assetIds?.length || 0) > 0 ||
    (options.componentIds?.length || 0) > 0 ||
    (options.vaultIds?.length || 0) > 0;
  const chosenAssets = hasExplicitSelection
    ? project.assets.filter((a) => selectedAssetSet.has(a.id) && a.path && existsSync(a.path))
    : project.assets.filter((a) => a.path && existsSync(a.path));
  const chosenComps =
    selectedCompSet.size > 0
      ? project.components.filter((c) => selectedCompSet.has(c.id))
      : [];

  const packAssets: PackAsset[] = [];
  const usedNames = new Set<string>();
  for (let idx = 0; idx < chosenAssets.length; idx++) {
    const a = chosenAssets[idx];
    const ext = extname(a.path) || (a.kind === 'audio' ? '.wav' : '.png');
    if (!mediaExtension.test(`f${ext}`)) continue;
    let fileBase = basename(a.path, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 32) || `asset-${idx + 1}`;
    let candidate = `${fileBase}${ext}`;
    while (usedNames.has(candidate)) {
      fileBase = `${fileBase}_${idx + 1}`;
      candidate = `${fileBase}${ext}`;
    }
    usedNames.add(candidate);
    const relPath = `assets/${candidate}`;
    await copyFile(a.path, join(exportDir, relPath));
    packAssets.push({
      id: safeAsciiSlug(a.id, `asset${idx + 1}`),
      path: relPath,
      name: a.name,
      license: typeof a.source?.license === 'string' ? a.source.license : undefined,
      sourceUrl: typeof a.source?.url === 'string' ? a.source.url : undefined,
    });
  }

  const packTemplates: PackTemplate[] = [];
  for (let idx = 0; idx < chosenComps.length; idx++) {
    const c = chosenComps[idx];
    const compSlug = safeAsciiSlug(c.name || c.id, `tpl${idx + 1}`);
    const entryFile = `${compSlug}.tsx`;
    await writeFile(join(exportDir, entryFile), c.source, 'utf8');
    const cleanProps: CodeComponent['props'] = {};
    for (const [k, v] of Object.entries(c.props || {})) {
      if (validProp(k) && (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) {
        cleanProps[k] = v;
      }
    }
    packTemplates.push({
      id: compSlug,
      name: c.name,
      entry: entryFile,
      durationSeconds: c.pack?.durationSeconds && c.pack.durationSeconds >= 0.1 ? c.pack.durationSeconds : 5,
      defaultProps: cleanProps,
    });
  }

  if (!packAssets.length && !packTemplates.length) {
    throw new Error('选中的素材均离线或无可打包的媒体与组件');
  }

  const manifest: MaterialPackManifest = {
    schemaVersion: 1,
    id: packId,
    name: packName,
    version: '1.0.0',
    author: options.author?.trim() || 'CoCraft Creator',
    license: options.license?.trim() || 'CC-BY-4.0',
    ...(packTemplates.length ? { templates: packTemplates } : {}),
    ...(packAssets.length ? { assets: packAssets } : {}),
  };
  validateManifest(manifest);
  await writeFile(join(exportDir, 'cocraft-pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { directory: exportDir, manifest };
}
