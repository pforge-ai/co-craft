import { app, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { friendlySkillTitle } from '../../src/core/taxonomy';
import type { SkillInfo } from '../../src/core/types';
import type { IpcHandlerMap } from './types';

export async function realpathSafe(target: string) {
  try {
    const { realpath } = await import('node:fs/promises');
    return await realpath(target);
  } catch {
    return resolve(target);
  }
}

export function parseSkillMarkdown(source: string, fallbackSlug: string) {
  const normalized = source.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = fmMatch ? fmMatch[1] : '';
  const body = (fmMatch ? fmMatch[2] : normalized).trim();
  const rawName = (fm.match(/^name:\s*(.+)$/m)?.[1] || fallbackSlug || 'custom-skill')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  const name = /^[a-z0-9]/.test(rawName) && rawName.length >= 2 ? rawName.slice(0, 48) : 'custom-skill';
  const description = (fm.match(/^description:\s*(.+)$/m)?.[1] || '').trim();
  return { name, description, body };
}

export async function listSkillsFromRoots(projectPath: string, resourcesPath: string): Promise<SkillInfo[]> {
  const result: SkillInfo[] = [];
  const seen = new Set<string>();
  const roots: [string, SkillInfo['scope']][] = [
    [join(projectPath, 'skills'), 'project'],
    [join(app.getPath('userData'), 'skills'), 'user'],
    [join(resourcesPath, 'skills'), 'builtin'],
  ];
  for (const [root, scope] of roots) {
    for (const f of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!f.isDirectory()) continue;
      const path = join(root, f.name, 'SKILL.md');
      try {
        const source = await readFile(path, 'utf8');
        const parsed = parseSkillMarkdown(source, f.name);
        if (seen.has(parsed.name)) continue;
        seen.add(parsed.name);
        result.push({
          name: parsed.name,
          title: friendlySkillTitle(parsed.name),
          description: parsed.description,
          path,
          scope,
          body: parsed.body,
        });
      } catch {}
    }
  }
  return result;
}

export const skillsIpcHandlers: IpcHandlerMap = {
  'skills.list': (_arg, ctx) => ctx.listSkills(),
  'skills.save': async (arg, ctx) => {
    const scope = arg.scope === 'user' ? 'user' : 'project';
    const rawSlug = String(arg.slug || arg.name || '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(rawSlug)) {
      throw new Error('Skill 标识仅支持 2~49 位小写字母、数字、中划线或下划线，且以字母或数字开头');
    }
    const description = String(arg.description || '').replace(/\r?\n/g, ' ').trim();
    const body = String(arg.body || '').trim();
    if (!description || !body) throw new Error('请填写 Skill 简介和规范正文');
    const root = scope === 'user' ? join(app.getPath('userData'), 'skills') : join(ctx.getStore().path, 'skills');
    const skillDir = join(root, rawSlug);
    await mkdir(skillDir, { recursive: true });
    const content = `---\nname: ${rawSlug}\ndescription: ${description}\n---\n\n${body}\n`;
    await writeFile(join(skillDir, 'SKILL.md'), content, 'utf8');
    return ctx.listSkills();
  },
  'skills.delete': async (arg, ctx) => {
    if (arg.scope === 'builtin') throw new Error('内置规范不支持删除，可在项目内新建覆盖');
    const scope = arg.scope === 'user' ? 'user' : 'project';
    const root = await realpathSafe(
      scope === 'user' ? join(app.getPath('userData'), 'skills') : join(ctx.getStore().path, 'skills'),
    );
    const list = await ctx.listSkills();
    const target = list.find((s) => s.scope === scope && s.name === String(arg.name || ''));
    if (!target) throw new Error('未找到指定的自定义 Skill');
    const skillFile = await realpathSafe(target.path);
    const skillDir = dirname(skillFile);
    if (dirname(skillDir) !== root) throw new Error('Skill 路径无效');
    await rm(skillDir, { recursive: true, force: true });
    return ctx.listSkills();
  },
  'skills.import': async (arg, ctx) => {
    const importKind: 'file' | 'folder' = arg.kind === 'folder' ? 'folder' : 'file';
    const scope = arg.scope === 'user' ? 'user' : 'project';
    const root = scope === 'user' ? join(app.getPath('userData'), 'skills') : join(ctx.getStore().path, 'skills');
    let sourcePath = arg.sourcePath ? String(arg.sourcePath) : '';
    if (!sourcePath) {
      const picked = await dialog.showOpenDialog(ctx.getWin(), {
        title: importKind === 'folder' ? '导入 Skill 目录（含 SKILL.md 与附属脚本）' : '导入 SKILL.md',
        properties: importKind === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(importKind === 'file' ? { filters: [{ name: 'Skill 文档', extensions: ['md'] }] } : {}),
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      sourcePath = picked.filePaths[0];
    }
    const info = await stat(sourcePath);
    if (info.isDirectory()) {
      const skillMdPath = join(sourcePath, 'SKILL.md');
      if (!existsSync(skillMdPath)) {
        throw new Error('所选目录根部未找到 SKILL.md，请选择包含 SKILL.md 的 Skill 文件夹');
      }
      const mdStat = await stat(skillMdPath);
      if (!mdStat.isFile() || mdStat.size > 512 * 1024) {
        throw new Error('SKILL.md 无效或体积超过 512KB 上限');
      }
      const raw = await readFile(skillMdPath, 'utf8');
      const parsed = parseSkillMarkdown(raw, basename(sourcePath));
      const destDir = join(root, parsed.name);
      await rm(destDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(destDir, { recursive: true });
      let totalBytes = 0;
      let fileCount = 0;
      const copyTree = async (src: string, dst: string) => {
        const entries = await readdir(src, { withFileTypes: true });
        for (const entry of entries) {
          if (['.git', 'node_modules', '.DS_Store', '__pycache__'].includes(entry.name)) continue;
          const sPath = join(src, entry.name);
          const dPath = join(dst, entry.name);
          const st = await lstat(sPath);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) {
            await mkdir(dPath, { recursive: true });
            await copyTree(sPath, dPath);
          } else if (st.isFile()) {
            fileCount++;
            totalBytes += st.size;
            if (fileCount > 200 || totalBytes > 20 * 1024 * 1024) {
              throw new Error('Skill 目录超出大小限制（最多 200 个文件 / 20MB）');
            }
            await copyFile(sPath, dPath);
          }
        }
      };
      await copyTree(sourcePath, destDir);
      await writeFile(
        join(destDir, 'SKILL.md'),
        `---\nname: ${parsed.name}\ndescription: ${parsed.description || parsed.name}\n---\n\n${parsed.body}\n`,
        'utf8',
      );
      return ctx.listSkills();
    }
    if (extname(sourcePath).toLowerCase() !== '.md') {
      throw new Error('仅支持导入 .md 格式的 Skill 文档或含 SKILL.md 的目录');
    }
    if (!info.isFile() || info.size > 512 * 1024) {
      throw new Error('Skill 文档无效或体积超过 512KB 上限');
    }
    const raw = await readFile(sourcePath, 'utf8');
    const parsed = parseSkillMarkdown(raw, basename(dirname(sourcePath)));
    const skillDir = join(root, parsed.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${parsed.name}\ndescription: ${parsed.description || parsed.name}\n---\n\n${parsed.body}\n`,
      'utf8',
    );
    return ctx.listSkills();
  },
  'skills.open': async (arg, ctx) => {
    const dir = arg?.scope === 'user' ? join(app.getPath('userData'), 'skills') : join(ctx.getStore().path, 'skills');
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  },
};
