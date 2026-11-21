import { mkdir, readFile, cp } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJSON, ProjectStore } from './store';
import { importMedia } from './media';
import { compileComponent } from './code';
import { uid, clone } from '../src/core/project';
import type {
  VaultItem,
  Asset,
  AssetVariant,
  CodeComponent,
  EditOperation,
  ProjectEnvelope,
  VaultPackMember,
  CompoundClipBundle,
} from '../src/core/types';

/**
 * Pure, story-free built-in Visual Styles (PRD §2.3).
 * Zero fake characters, zero hardcoded story content — pure design tokens ready for any project.
 */
function builtInStyles(): VaultItem[] {
  const now = '2026-11-18T00:00:00.000Z';
  return [
    {
      id: 'gstyle_cobalt_night',
      name: '深空钴蓝',
      entityKind: 'style',
      role: 'visual-style',
      tags: ['科技发布', '暗色高对比'],
      category: 'brand',
      subkind: 'brand-kit',
      description: '深海夜空底色搭配电光钴蓝与青翠双强调色，适合产品功能演示、系统架构与数据发布。',
      styleTokens: {
        primaryColor: '#3b82f6',
        secondaryColor: '#14b8a6',
        backgroundColor: '#0b101d',
        surfaceColor: '#131c31',
        inkColor: '#f8fafc',
        captionColor: '#f8fafc',
        lightingPreset: 'cyber-rim',
        cornerRadius: 16,
      },
      brand: {
        primaryColor: '#3b82f6',
        secondaryColor: '#14b8a6',
        backgroundColor: '#0b101d',
        captionColor: '#f8fafc',
      },
      version: 1,
      updatedAt: now,
    },
    {
      id: 'gstyle_warm_paper',
      name: '暖米纸白',
      entityKind: 'style',
      role: 'visual-style',
      tags: ['知识科普', '手绘白板', '浅色'],
      category: 'brand',
      subkind: 'brand-kit',
      description: '温润点阵纸白底色搭配墨蓝与琥珀标注色，适合原理科普、手绘状态推演与深度阅读。',
      styleTokens: {
        primaryColor: '#2563eb',
        secondaryColor: '#d97706',
        backgroundColor: '#fbf9f3',
        surfaceColor: '#ffffff',
        inkColor: '#0f172a',
        captionColor: '#0f172a',
        lightingPreset: 'porcelain-soft',
        cornerRadius: 14,
      },
      brand: {
        primaryColor: '#2563eb',
        secondaryColor: '#d97706',
        backgroundColor: '#fbf9f3',
        captionColor: '#0f172a',
      },
      version: 1,
      updatedAt: now,
    },
    {
      id: 'gstyle_obsidian_titanium',
      name: '黑曜钛金',
      entityKind: 'style',
      role: 'visual-style',
      tags: ['硬件拆解', '商业质感', '三维'],
      category: 'brand',
      subkind: 'brand-kit',
      description: '黑曜石哑光底搭配香槟钛金与冷银高光，适合硬件结构拆解、工业产品展示与品牌成片。',
      styleTokens: {
        primaryColor: '#f59e0b',
        secondaryColor: '#94a3b8',
        backgroundColor: '#09090c',
        surfaceColor: '#14151a',
        inkColor: '#f8fafc',
        captionColor: '#fef3c7',
        lightingPreset: 'titanium-dark',
        cornerRadius: 12,
      },
      brand: {
        primaryColor: '#f59e0b',
        secondaryColor: '#94a3b8',
        backgroundColor: '#09090c',
        captionColor: '#fef3c7',
      },
      version: 1,
      updatedAt: now,
    },
    {
      id: 'gstyle_mist_minimal',
      name: '浅雾极简',
      entityKind: 'style',
      role: 'visual-style',
      tags: ['清爽教程', '日常汇报', '浅色'],
      category: 'brand',
      subkind: 'brand-kit',
      description: '清透浅灰雾面底色搭配青碧主色，干净不抢戏，适合软件操作教程、口播知识分享与汇报。',
      styleTokens: {
        primaryColor: '#0d9488',
        secondaryColor: '#6366f1',
        backgroundColor: '#f1f5f9',
        surfaceColor: '#ffffff',
        inkColor: '#0f172a',
        captionColor: '#0f172a',
        lightingPreset: 'porcelain-soft',
        cornerRadius: 18,
      },
      brand: {
        primaryColor: '#0d9488',
        secondaryColor: '#6366f1',
        backgroundColor: '#f1f5f9',
        captionColor: '#0f172a',
      },
      version: 1,
      updatedAt: now,
    },
  ];
}

const LEGACY_FAKE_IDS = new Set([
  'gvault_subject_presenter',
  'gvault_recipe_teardown',
  'gvault_recipe_seecode',
  'gvault_brand_cobalt',
]);

export class GlobalVault {
  private indexFile: string;
  private filesDir: string;
  private initialized = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private libraryRoot: string) {
    this.indexFile = join(libraryRoot, 'vault.json');
    this.filesDir = join(libraryRoot, 'files');
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  async init() {
    if (this.initialized && existsSync(this.indexFile)) return;
    await mkdir(this.filesDir, { recursive: true });
    if (!existsSync(this.indexFile)) {
      await atomicJSON(this.indexFile, builtInStyles());
      this.initialized = true;
      return;
    }
    // Cleanly upgrade any v0.3 starter fake items while preserving all real user-created global assets!
    try {
      const raw = JSON.parse(await readFile(this.indexFile, 'utf8'));
      if (Array.isArray(raw)) {
        const userItems = raw.filter((x: VaultItem) => !LEGACY_FAKE_IDS.has(x.id));
        const styleIds = new Set(userItems.map((x: VaultItem) => x.id));
        const merged = [...builtInStyles().filter((s) => !styleIds.has(s.id)), ...userItems];
        if (merged.length !== raw.length || raw.some((x: VaultItem) => LEGACY_FAKE_IDS.has(x.id))) {
          await atomicJSON(this.indexFile, merged);
        }
      }
    } catch {
      await atomicJSON(this.indexFile, builtInStyles());
    }
    this.initialized = true;
  }

  async list(): Promise<VaultItem[]> {
    await this.init();
    try {
      const items = JSON.parse(await readFile(this.indexFile, 'utf8'));
      return Array.isArray(items) ? items : builtInStyles();
    } catch {
      return builtInStyles();
    }
  }

  private async saveAll(items: VaultItem[]) {
    await this.init();
    await atomicJSON(this.indexFile, items);
  }

  private async copyIntoLibrary(sourcePath: string): Promise<string> {
    await this.init();
    const hashObj = createHash('sha256');
    for await (const chunk of createReadStream(sourcePath)) hashObj.update(chunk);
    const hash = hashObj.digest('hex').slice(0, 12);
    const ext = extname(sourcePath).toLowerCase();
    const base = basename(sourcePath, ext)
      .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
      .slice(0, 32);
    const fileName = `${hash}-${base}${ext}`;
    const dest = join(this.filesDir, fileName);
    if (!existsSync(dest)) await cp(sourcePath, dest);
    return fileName;
  }

  async upsertGlobal(item: VaultItem): Promise<VaultItem[]> {
    return this.serial(async () => {
      const all = await this.list();
      const idx = all.findIndex((x) => x.id === item.id);
      if (idx < 0) all.unshift(item);
      else all[idx] = item;
      await this.saveAll(all);
      return all;
    });
  }

  async removeGlobal(id: string): Promise<VaultItem[]> {
    return this.serial(async () => {
      const all = (await this.list()).filter((x) => x.id !== id);
      await this.saveAll(all);
      return all;
    });
  }

  async promoteFromProject(
    store: ProjectStore,
    payload: {
      itemId?: string;
      assetId?: string;
      componentId?: string;
      item?: Partial<VaultItem>;
      pack?: { name: string; assetIds?: string[]; componentIds?: string[]; vaultIds?: string[] };
    },
  ): Promise<{ globalVault: VaultItem[]; promoted: VaultItem }> {
    const project = await store.project();
    const now = new Date().toISOString();

    if (payload.pack) {
      const members: VaultPackMember[] = [];
      for (const aid of payload.pack.assetIds || []) {
        const asset = project.assets.find((a) => a.id === aid);
        if (!asset || !existsSync(asset.path)) continue;
        const libraryFile = await this.copyIntoLibrary(asset.path);
        members.push({
          kind: 'asset',
          name: asset.name,
          role: asset.role,
          libraryFile,
          assetKind: asset.kind,
        });
      }
      for (const cid of payload.pack.componentIds || []) {
        const comp = project.components.find((c) => c.id === cid);
        if (!comp) continue;
        members.push({
          kind: 'component',
          name: comp.name,
          componentSource: comp.source,
          props: clone(comp.props),
        });
      }
      for (const vid of payload.pack.vaultIds || []) {
        const vi = (project.vault || []).find((v) => v.id === vid);
        if (!vi) continue;
        let libFile = vi.libraryFile;
        if (vi.assetId) {
          const va = project.assets.find((a) => a.id === vi.assetId);
          if (va && existsSync(va.path)) libFile = await this.copyIntoLibrary(va.path);
        }
        let clonedCompound: CompoundClipBundle | undefined;
        if (vi.compound) {
          clonedCompound = clone(vi.compound);
          clonedCompound.assetFiles = clonedCompound.assetFiles || {};
          for (const clip of clonedCompound.clips) {
            if (clip.assetId && !clonedCompound.assetFiles[clip.assetId]) {
              const ca = project.assets.find((a) => a.id === clip.assetId);
              if (ca && existsSync(ca.path)) {
                clonedCompound.assetFiles[clip.assetId] = await this.copyIntoLibrary(ca.path);
              }
            }
          }
        }
        members.push({
          kind: 'vault',
          name: vi.name,
          role: vi.role,
          libraryFile: libFile,
          assetKind: vi.assetKind,
          promptAnchor: vi.promptAnchor,
          textContent: vi.textContent,
          compound: clonedCompound,
        });
      }
      if (!members.length) throw new Error('选中的对象不含可打包的离线或有效资产');
      const promoted: VaultItem = {
        id: uid('gvault'),
        name: payload.pack.name.trim() || `素材包 (${members.length}项)`,
        entityKind: 'pack',
        role: 'backdrop',
        tags: ['素材包', `${members.length}项`],
        category: 'media',
        subkind: 'material-pack',
        description: `包含 ${members.length} 项媒体、组件与设定资产，支持跨项目一键解包引入。`,
        libraryFile: members.find((m) => m.libraryFile && (m.assetKind === 'image' || m.assetKind === 'video'))?.libraryFile,
        assetKind: members.find((m) => m.libraryFile && (m.assetKind === 'image' || m.assetKind === 'video'))?.assetKind,
        packItems: members,
        version: 1,
        updatedAt: now,
      };
      const globalVault = await this.upsertGlobal(promoted);
      return { globalVault, promoted };
    }

    if (payload.componentId) {
      const comp = project.components.find((c) => c.id === payload.componentId);
      if (!comp) throw new Error('未找到要存入全局库的动态组件');
      const isThree = /from\s+['"]three['"]|@remotion\/three/.test(comp.source);
      const promoted: VaultItem = {
        id: uid('gvault'),
        name: comp.name,
        entityKind: isThree ? 'three' : 'component',
        role: 'logic-diagram',
        tags: ['可调参数'],
        category: 'rig',
        subkind: isThree ? 'three-rig' : 'motion-rig',
        description: isThree ? '可复用三维空间装置组件' : '可复用参数化动态图形组件',
        rig: {
          componentName: comp.name,
          componentSource: comp.source,
          props: clone(comp.props),
        },
        version: 1,
        updatedAt: now,
      };
      const globalVault = await this.upsertGlobal(promoted);
      return { globalVault, promoted };
    }

    if (payload.assetId) {
      const asset = project.assets.find((a) => a.id === payload.assetId);
      if (!asset) throw new Error('未找到要存入全局库的资产');
      if (!existsSync(asset.path)) throw new Error('原资产文件已离线，请先重新定位文件');
      const libraryFile = await this.copyIntoLibrary(asset.path);
      const promoted: VaultItem = {
        id: uid('gvault'),
        name: asset.name,
        entityKind: asset.kind === 'model-3d' ? 'three' : asset.kind,
        role: asset.role || (asset.kind === 'model-3d' ? 'product' : 'footage'),
        tags: [...(asset.tags || [])],
        collection: asset.collection,
        category: asset.category || (asset.kind === 'model-3d' ? 'rig' : 'media'),
        subkind: asset.subkind || (asset.kind === 'model-3d' ? 'model-3d' : 'media'),
        description: `${asset.kind.toUpperCase()} 资产快照`,
        libraryFile,
        assetKind: asset.kind,
        version: 1,
        updatedAt: now,
      };
      const globalVault = await this.upsertGlobal(promoted);
      return { globalVault, promoted };
    }

    const existing = payload.itemId ? (project.vault || []).find((v) => v.id === payload.itemId) : undefined;
    const base = existing ? clone(existing) : payload.item;
    if (!base || !base.name || !base.category || !base.subkind) {
      throw new Error('缺少有效的资产实体信息');
    }
    let libraryFile = base.libraryFile;
    let assetKind = base.assetKind;
    if (base.assetId) {
      const linked = project.assets.find((a) => a.id === base.assetId);
      if (linked && existsSync(linked.path)) {
        libraryFile = await this.copyIntoLibrary(linked.path);
        assetKind = linked.kind;
      }
    }

    // Also snapshot each state variant's linked image/model file into Global Library!
    let variants: AssetVariant[] | undefined;
    if (base.variants?.length) {
      variants = [];
      for (const vr of base.variants) {
        let vrLibFile = vr.libraryFile;
        if (vr.assetId) {
          const va = project.assets.find((a) => a.id === vr.assetId);
          if (va && existsSync(va.path)) {
            vrLibFile = await this.copyIntoLibrary(va.path);
          }
        }
        variants.push({ ...clone(vr), assetId: undefined, libraryFile: vrLibFile });
      }
    }

    let promotedCompound: CompoundClipBundle | undefined;
    if (base.compound) {
      promotedCompound = clone(base.compound);
      const assetFiles: Record<string, string> = { ...(promotedCompound.assetFiles || {}) };
      for (const c of promotedCompound.clips) {
        if (c.assetId && !assetFiles[c.assetId]) {
          const ca = project.assets.find((a) => a.id === c.assetId);
          if (ca && existsSync(ca.path)) {
            assetFiles[c.assetId] = await this.copyIntoLibrary(ca.path);
          }
        }
      }
      promotedCompound.assetFiles = assetFiles;
    }

    const globalId = base.originGlobalId || uid('gvault');
    const prevGlobal = (await this.list()).find((g) => g.id === globalId);
    const promoted: VaultItem = {
      ...(base as VaultItem),
      id: globalId,
      assetId: undefined,
      libraryFile,
      assetKind,
      variants,
      ...(promotedCompound ? { compound: promotedCompound } : {}),
      version: (prevGlobal?.version || 0) + 1,
      updatedAt: now,
    };
    const globalVault = await this.upsertGlobal(promoted);
    return { globalVault, promoted };
  }

  async pullToProject(
    store: ProjectStore,
    globalItemId: string,
  ): Promise<{ envelope: ProjectEnvelope; item: VaultItem; asset?: Asset; component?: CodeComponent }> {
    const all = await this.list();
    const gItem = all.find((x) => x.id === globalItemId);
    if (!gItem) throw new Error('全局个人库中不存在该资产');
    const project = await store.project();
    const ops: EditOperation[] = [];
    let importedAsset: Asset | undefined;
    let compiledComp: CodeComponent | undefined;

    const stagedByLibFile = new Map<string, Asset>();
    const stageLibraryFile = async (libFile: string): Promise<Asset> => {
      if (!libFile || basename(libFile) !== libFile || libFile.includes('..') || libFile.includes('/')) {
        throw new Error('全局资产库文件名无效');
      }
      const cached = stagedByLibFile.get(libFile);
      if (cached) return cached;
      const srcPath = join(this.filesDir, libFile);
      if (!existsSync(srcPath)) throw new Error('全局资产库源文件缺失');
      const assetsDir = join(store.path, 'assets');
      await mkdir(assetsDir, { recursive: true });
      const targetPath = join(assetsDir, libFile);
      if (!existsSync(targetPath)) await cp(srcPath, targetPath);
      const a = await importMedia(targetPath, store.path);
      a.role = gItem.role;
      a.tags = gItem.tags ? [...gItem.tags] : undefined;
      a.category = gItem.category;
      a.subkind = gItem.subkind;
      ops.push({ type: 'addAsset', asset: a });
      stagedByLibFile.set(libFile, a);
      return a;
    };

    if (gItem.libraryFile && !gItem.packItems?.length) {
      importedAsset = await stageLibraryFile(gItem.libraryFile);
    }

    let hydratedVariants: AssetVariant[] | undefined;
    if (gItem.variants?.length) {
      hydratedVariants = [];
      for (const vr of gItem.variants) {
        let vrAssetId = vr.assetId;
        if (vr.libraryFile) {
          const va = await stageLibraryFile(vr.libraryFile);
          va.tags = vr.tags?.length ? [...vr.tags] : va.tags;
          vrAssetId = va.id;
        }
        hydratedVariants.push({ ...clone(vr), assetId: vrAssetId });
      }
    }

    if (gItem.packItems?.length) {
      for (const member of gItem.packItems) {
        let stagedAsset: Asset | undefined;
        if (member.libraryFile) {
          stagedAsset = await stageLibraryFile(member.libraryFile);
          stagedAsset.name = member.name || stagedAsset.name;
          if (member.role) stagedAsset.role = member.role;
          stagedAsset.collection = gItem.name;
        }
        if (member.kind === 'component' && member.componentSource) {
          const comp = await compileComponent(
            member.componentSource,
            uid('component'),
            member.name,
            store.path,
            member.props || {},
          );
          ops.push({ type: 'putComponent', component: comp });
        } else if (member.kind === 'vault') {
          let memberCompound = member.compound ? clone(member.compound) : undefined;
          if (memberCompound?.assetFiles) {
            const idMap = new Map<string, string>();
            for (const [oldAid, libFile] of Object.entries(memberCompound.assetFiles)) {
              const ma = await stageLibraryFile(libFile);
              idMap.set(oldAid, ma.id);
            }
            for (const clip of memberCompound.clips) {
              if (clip.assetId && idMap.has(clip.assetId)) clip.assetId = idMap.get(clip.assetId);
            }
            delete memberCompound.assetFiles;
          }
          if (memberCompound?.componentSources) {
            const compIdMap = new Map<string, string>();
            for (const [oldCid, srcInfo] of Object.entries(memberCompound.componentSources)) {
              const compiled = await compileComponent(
                srcInfo.source,
                uid('component'),
                srcInfo.name,
                store.path,
                srcInfo.props,
              );
              ops.push({ type: 'putComponent', component: compiled });
              compIdMap.set(oldCid, compiled.id);
            }
            for (const clip of memberCompound.clips) {
              if (clip.componentId && compIdMap.has(clip.componentId))
                clip.componentId = compIdMap.get(clip.componentId);
            }
          }
          ops.push({
            type: 'putVaultItem',
            item: {
              id: uid('pvault'),
              name: member.name,
              entityKind: memberCompound ? 'compound' : 'image',
              role: member.role || 'character',
              collection: gItem.name,
              tags: [gItem.name],
              category: memberCompound ? 'rig' : 'subject',
              subkind: memberCompound ? 'compound-clip' : 'character',
              assetId: stagedAsset?.id,
              assetKind: member.assetKind,
              promptAnchor: member.promptAnchor,
              textContent: member.textContent,
              compound: memberCompound,
              version: 1,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }
      const envelope = await store.edit({
        baseRevision: project.revision,
        name: `解包引入素材包「${gItem.name}」`,
        operations: ops,
      });
      return { envelope, item: clone(gItem) };
    }

    let hydratedCompound: CompoundClipBundle | undefined;
    if (gItem.compound) {
      hydratedCompound = clone(gItem.compound);
      const assetIdMap = new Map<string, string>();
      if (hydratedCompound.assetFiles) {
        for (const [oldAid, libFile] of Object.entries(hydratedCompound.assetFiles)) {
          const staged = await stageLibraryFile(libFile);
          assetIdMap.set(oldAid, staged.id);
        }
      }
      const compIdMap = new Map<string, string>();
      if (hydratedCompound.componentSources) {
        for (const [oldCid, srcInfo] of Object.entries(hydratedCompound.componentSources)) {
          const compiled = await compileComponent(
            srcInfo.source,
            uid('component'),
            srcInfo.name,
            store.path,
            srcInfo.props,
          );
          ops.push({ type: 'putComponent', component: compiled });
          compIdMap.set(oldCid, compiled.id);
        }
      }
      for (const clip of hydratedCompound.clips) {
        if (clip.assetId && assetIdMap.has(clip.assetId)) clip.assetId = assetIdMap.get(clip.assetId);
        if (clip.componentId && compIdMap.has(clip.componentId)) clip.componentId = compIdMap.get(clip.componentId);
      }
      delete hydratedCompound.assetFiles;
    }

    if (gItem.rig?.componentSource) {
      compiledComp = await compileComponent(
        gItem.rig.componentSource,
        uid('component'),
        gItem.rig.componentName || gItem.name,
        store.path,
        gItem.rig.props || {},
      );
      ops.push({ type: 'putComponent', component: compiledComp });
    }

    // Update existing copy in project if previously pulled from same globalId, else insert new
    const existingInProj = (project.vault || []).find((pv) => pv.originGlobalId === gItem.id);
    const projectVaultItem: VaultItem = {
      ...clone(gItem),
      id: existingInProj?.id || uid('pvault'),
      originGlobalId: gItem.id,
      assetId: importedAsset?.id || existingInProj?.assetId,
      variants: hydratedVariants,
      ...(hydratedCompound ? { compound: hydratedCompound } : {}),
      updatedAt: new Date().toISOString(),
    };
    ops.push({ type: 'putVaultItem', item: projectVaultItem });

    const envelope = await store.edit({
      baseRevision: project.revision,
      name: `${existingInProj ? '同步更新' : '从全局库引入'}「${gItem.name}」`,
      operations: ops,
    });
    return { envelope, item: projectVaultItem, asset: importedAsset, component: compiledComp };
  }
}
