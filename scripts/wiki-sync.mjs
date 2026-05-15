#!/usr/bin/env node
/**
 * Wiki 打平 JSON → VitePress Markdown（与 docgeniDemo 同源逻辑）
 *
 * - 语言根：path 为 zh-cn / en-us 的 hidden 节点；中文写入 docs/ 根下（无 zh-cn 前缀，对应 VitePress locales.root），英文写入 docs/en-us/…
 * - title 取自 name；有子节点时父页用 …/末段/index.md，否则 …/末段.md
 * - hidden 且有子文档的文件夹：写 …/<segment>/index.md，仅 front matter（无正文），避免侧栏再出现与顶栏同名的入口
 * - 同步结束后写入 docs/en-us/index.md（英文站点首页，避免 /en-us/ 空白；顶栏 Nexus 通过 config 的 logoLink 回根站 /）
 *
 *   node scripts/wiki-sync.mjs
 *   node scripts/wiki-sync.mjs --source ./scripts/wiki-mock-data.json --out ./docs --clean
 *   node scripts/wiki-sync.mjs --no-theme
 *
 * 环境变量: WIKI_SYNC_SOURCE、WIKI_SYNC_OUT、WIKI_SYNC_THEME_OUT、WIKI_SYNC_NO_THEME=1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const LOCALE_PATHS = new Set(['zh-cn', 'en-us']);

/** Wiki 中仍为 zh-cn；落盘到 docs 根目录，VitePress 用 locales.root，URL 无 /zh-cn */
const DEFAULT_WIKI_LOCALE = 'zh-cn';

function isDefaultWikiLocale(localeKey) {
  return localeKey === DEFAULT_WIKI_LOCALE;
}

/**
 * @param {string} localeKey
 * @param {string} routeUnderLocale posix segments joined
 * @param {boolean} hasVisibleChildren
 */
function wikiOutputDocRel(localeKey, routeUnderLocale, hasVisibleChildren) {
  if (isDefaultWikiLocale(localeKey)) {
    return hasVisibleChildren
      ? assertSafeDocRel(path.posix.join(routeUnderLocale, 'index.md'))
      : assertSafeDocRel(`${routeUnderLocale}.md`);
  }
  return hasVisibleChildren
    ? assertSafeDocRel(path.posix.join(localeKey, routeUnderLocale, 'index.md'))
    : assertSafeDocRel(path.posix.join(localeKey, `${routeUnderLocale}.md`));
}

function assertSafeSegment(seg, pageId) {
  const s = String(seg).trim();
  if (!s || s === '.' || s === '..') {
    throw new Error(`非法或空的 path 片段（页面 id=${pageId ?? 'unknown'}）`);
  }
  if (/[\\/]/.test(s) || /[\x00-\x1f]/.test(s) || s.includes('..')) {
    throw new Error(`path 片段含非法字符: ${JSON.stringify(s)}（id=${pageId ?? 'unknown'}）`);
  }
  return s;
}

function parseArgs(argv) {
  let source = process.env.WIKI_SYNC_SOURCE || path.join(ROOT, 'scripts', 'wiki-mock-data.json');
  let outDir = process.env.WIKI_SYNC_OUT || path.join(ROOT, 'docs');
  let themeOut =
    process.env.WIKI_SYNC_THEME_OUT ||
    path.join(ROOT, 'docs', '.vitepress', 'wiki-theme.generated.mjs');
  let noTheme = process.env.WIKI_SYNC_NO_THEME === '1' || process.env.WIKI_SYNC_NO_THEME === 'true';
  let clean = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && argv[i + 1]) {
      source = path.resolve(ROOT, argv[++i]);
    } else if (a === '--out' && argv[i + 1]) {
      outDir = path.resolve(ROOT, argv[++i]);
    } else if (a === '--theme-out' && argv[i + 1]) {
      themeOut = path.resolve(ROOT, argv[++i]);
    } else if (a === '--no-theme') {
      noTheme = true;
    } else if (a === '--clean') {
      clean = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`Wiki sync → VitePress（中文 root + en-us）

  --source <file>     Wiki JSON（默认 scripts/wiki-mock-data.json）
  --out <dir>         默认 docs；中文写入 <dir>/user-manual/...，英文 <dir>/en-us/...
  --theme-out <file>  默认 docs/.vitepress/wiki-theme.generated.mjs
  --no-theme          只写 .md，不写主题模块
  --clean             删除 <dir>/user-manual、<dir>/zh-cn、<dir>/en-us 下全部 .md 后写入

环境变量 WIKI_SYNC_SOURCE、WIKI_SYNC_OUT、WIKI_SYNC_THEME_OUT、WIKI_SYNC_NO_THEME`);
      process.exit(0);
    }
  }
  return { source, outDir, clean, themeOut, noTheme };
}

function assertSafeDocRel(relPosix) {
  const normalized = path.normalize(relPosix).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`非法文档相对路径: ${relPosix}`);
  }
  if (/[\x00-\x1f]/.test(normalized)) {
    throw new Error(`非法字符: ${relPosix}`);
  }
  return normalized;
}

function yamlDoubleQuoted(s) {
  if (s == null) {
    return '""';
  }
  const escaped = String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

/** @param {{ name?: string, description?: string, order?: number, path?: string, hidden?: boolean }} page */
/** @param {string | null} pathMetaLeaf */
function buildFrontMatter(page, pathMetaLeaf) {
  const lines = ['---'];
  const title = typeof page.name === 'string' && page.name.trim() ? page.name.trim() : page.path || 'Untitled';
  lines.push(`title: ${yamlDoubleQuoted(title)}`);
  if (page.description) {
    lines.push(`description: ${yamlDoubleQuoted(page.description)}`);
  }
  if (typeof page.order === 'number' && !Number.isNaN(page.order)) {
    lines.push(`order: ${page.order}`);
  }
  if (pathMetaLeaf) {
    lines.push(`path: ${yamlDoubleQuoted(pathMetaLeaf)}`);
  }
  if (page.hidden === true) {
    lines.push(`hidden: true`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function rmMarkdownUnder(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      rmMarkdownUnder(full);
      try {
        fs.rmdirSync(full);
      } catch {
        /* 保留非空目录 */
      }
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      fs.unlinkSync(full);
    }
  }
}

function chainRootToLeaf(page, byId) {
  const up = [];
  let cur = page;
  const seen = new Set();
  while (cur && typeof cur === 'object' && cur.id != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    up.push(cur);
    const pid = cur.parent_id;
    cur = pid != null && byId.has(pid) ? byId.get(pid) : null;
  }
  return up.reverse();
}

function resolveLocaleAndSegments(chain) {
  let localeIdx = -1;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const seg = typeof p?.path === 'string' ? p.path.trim() : '';
    if (LOCALE_PATHS.has(seg)) {
      localeIdx = i;
      break;
    }
  }
  if (localeIdx < 0) {
    return null;
  }
  const localeKey = chain[localeIdx].path.trim();
  const rest = chain.slice(localeIdx + 1);
  const segments = rest.map((p) => (typeof p.path === 'string' ? p.path.trim() : ''));
  return { localeKey, segments };
}

function pageToVpLink(localeKey, page, byId, parentIdsWithVisibleChildren) {
  const chain = chainRootToLeaf(page, byId);
  const resolved = resolveLocaleAndSegments(chain);
  if (!resolved || resolved.localeKey !== localeKey) {
    return null;
  }
  const segs = resolved.segments.map((s) => assertSafeSegment(s, page.id));
  const routePath = segs.join('/');
  const hasKids = parentIdsWithVisibleChildren.has(String(page.id));
  if (isDefaultWikiLocale(localeKey)) {
    const base = `/${routePath}`.replace(/\/+/g, '/');
    return hasKids ? (base.endsWith('/') ? base : `${base}/`) : base;
  }
  const base = `/${localeKey}/${routePath}`.replace(/\/+/g, '/');
  if (hasKids) {
    return base.endsWith('/') ? base : `${base}/`;
  }
  return base;
}

function sortByOrderThenPath(a, b) {
  const oa = typeof a.order === 'number' && !Number.isNaN(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const ob = typeof b.order === 'number' && !Number.isNaN(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (oa !== ob) {
    return oa - ob;
  }
  return String(a.path || '').localeCompare(String(b.path || ''));
}

function firstLinkInSidebar(items) {
  for (const it of items) {
    if (it.link) {
      return it.link;
    }
    if (it.items?.length) {
      const inner = firstLinkInSidebar(it.items);
      if (inner) {
        return inner;
      }
    }
  }
  return null;
}

/**
 * @param {string} localeKey
 * @param {string} channelFolderId
 * @param {any[]} pages
 * @param {Map<string, any>} byId
 * @param {Set<string>} parentIdsWithVisibleChildren
 */
function buildSidebarForChannel(localeKey, channelFolderId, pages, byId, parentIdsWithVisibleChildren) {
  const children = pages.filter((p) => p && !p.hidden && String(p.parent_id) === String(channelFolderId));
  children.sort(sortByOrderThenPath);
  const items = [];
  for (const child of children) {
    const link = pageToVpLink(localeKey, child, byId, parentIdsWithVisibleChildren);
    if (!link) {
      continue;
    }
    if (parentIdsWithVisibleChildren.has(String(child.id))) {
      const sub = pages.filter((p) => p && !p.hidden && String(p.parent_id) === String(child.id));
      sub.sort(sortByOrderThenPath);
      const folderLink = pageToVpLink(localeKey, child, byId, parentIdsWithVisibleChildren);
      const groupItems = [];
      for (const s of sub) {
        const sl = pageToVpLink(localeKey, s, byId, parentIdsWithVisibleChildren);
        if (sl) {
          groupItems.push({ text: s.name || s.path, link: sl });
        }
      }
      /** 父级同时 `link` + `items` + `collapsed`：标题可点进 index，右侧箭头展开子页（VitePress 默认主题支持） */
      items.push({
        text: child.name || child.path,
        ...(folderLink ? { link: folderLink } : {}),
        collapsed: false,
        items: groupItems,
      });
    } else {
      items.push({ text: child.name || child.path, link });
    }
  }
  return items;
}

function getLocaleRootPage(pages, localeKey) {
  return pages.find(
    (p) =>
      p &&
      typeof p === 'object' &&
      String(p.path).trim() === localeKey &&
      p.hidden === true &&
      LOCALE_PATHS.has(localeKey),
  );
}

function writeWikiThemeModule(themeOut, localesPayload) {
  const body = JSON.stringify(localesPayload, null, 2);
  const content = `// AUTO-GENERATED by scripts/wiki-sync.mjs — do not edit
/** 供 docs/.vitepress/config.mts：locales.root（中文）+ en-us 的 wiki 顶栏 + 侧栏 */
export default ${body};
`;
  fs.mkdirSync(path.dirname(themeOut), { recursive: true });
  fs.writeFileSync(themeOut, content, 'utf8');
}

function writeEnUsLandingPage(outDir) {
  const body = `---
layout: home
hero:
  name: Nexus
  text: Wiki → VitePress
  tagline: English locale — use the language menu for 中文
  actions:
    - theme: brand
      text: User Manual
      link: /en-us/user-manual/overview
    - theme: alt
      text: Site home (中文)
      link: /
---
`;
  const abs = path.join(outDir, 'en-us', 'index.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  console.log(`写入 ${path.relative(ROOT, abs)}（英文站点首页）`);
}

function main() {
  const { source, outDir, clean, themeOut, noTheme } = parseArgs(process.argv);

  if (!fs.existsSync(source)) {
    console.error(`找不到数据源: ${source}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(source, 'utf8');
  /** @type {{ pages?: unknown[], fetchedAt?: string }} */
  const data = JSON.parse(raw);
  const pages = Array.isArray(data.pages) ? data.pages : [];

  const byId = new Map();
  for (const p of pages) {
    if (p && typeof p === 'object' && p.id != null) {
      byId.set(String(p.id), p);
    }
  }

  const parentIdsWithVisibleChildren = new Set();
  for (const p of pages) {
    if (p && typeof p === 'object' && p.hidden !== true && p.parent_id != null) {
      parentIdsWithVisibleChildren.add(String(p.parent_id));
    }
  }

  if (clean) {
    rmMarkdownUnder(path.join(outDir, 'user-manual'));
    for (const loc of LOCALE_PATHS) {
      rmMarkdownUnder(path.join(outDir, loc));
    }
    console.log(`已清理 ${path.relative(ROOT, outDir)} 下 user-manual、zh-cn、en-us 中的 .md`);
  }

  let written = 0;
  let skippedHidden = 0;
  let skippedNoPath = 0;
  let skippedNoLocale = 0;
  const usedRoutes = new Set();

  for (const page of pages) {
    if (!page || typeof page !== 'object') {
      continue;
    }
    if (page.hidden === true) {
      skippedHidden++;
      continue;
    }
    if (typeof page.path !== 'string' || !page.path.trim()) {
      console.warn('跳过无 path 的条目', page.id ?? '');
      skippedNoPath++;
      continue;
    }

    const chain = chainRootToLeaf(page, byId);
    const resolved = resolveLocaleAndSegments(chain);
    if (!resolved) {
      console.warn('跳过无法归属 zh-cn / en-us 的条目', page.id ?? '', page.path);
      skippedNoLocale++;
      continue;
    }

    const { localeKey, segments } = resolved;
    let safeSegments;
    try {
      safeSegments = segments.map((s) => assertSafeSegment(s, page.id));
    } catch (e) {
      console.warn(String(e.message || e));
      continue;
    }

    const routeUnderLocale = safeSegments.join('/');
    const pathMetaLeaf = safeSegments[safeSegments.length - 1];
    const hasVisibleChildren = parentIdsWithVisibleChildren.has(String(page.id));
    const docRel = wikiOutputDocRel(localeKey, routeUnderLocale, hasVisibleChildren);
    if (usedRoutes.has(docRel)) {
      console.warn('路由重复，后写覆盖:', docRel, 'id=', page.id);
    }
    usedRoutes.add(docRel);

    const body =
      typeof page.bodyMarkdown === 'string'
        ? page.bodyMarkdown
        : typeof page.body === 'string'
          ? page.body
          : localeKey === 'zh-cn'
            ? '_（无正文）_\n'
            : '_（No content）_\n';

    const absPath = path.join(outDir, ...docRel.split('/'));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    const fm = buildFrontMatter(page, pathMetaLeaf);
    const metaComment = `<!-- wikiSync: id=${page.id} locale=${localeKey} route=${routeUnderLocale} -->\n`;
    fs.writeFileSync(absPath, `${fm}\n${metaComment}${body.endsWith('\n') ? body : `${body}\n`}`, 'utf8');
    written++;
    console.log(`写入 ${path.relative(ROOT, absPath)}`);
  }

  let folderIndexWritten = 0;
  const emittedCategoryIndex = new Set();
  for (const folder of pages) {
    if (!folder || typeof folder !== 'object' || folder.hidden !== true) {
      continue;
    }
    if (typeof folder.path !== 'string' || !folder.path.trim()) {
      continue;
    }
    if (LOCALE_PATHS.has(folder.path.trim())) {
      continue;
    }
    if (!parentIdsWithVisibleChildren.has(String(folder.id))) {
      continue;
    }
    let seg;
    try {
      seg = assertSafeSegment(folder.path, folder.id);
    } catch {
      continue;
    }
    const chain = chainRootToLeaf(folder, byId);
    const resolved = resolveLocaleAndSegments(chain);
    if (!resolved) {
      continue;
    }
    const { localeKey } = resolved;
    const docRel = isDefaultWikiLocale(localeKey)
      ? assertSafeDocRel(path.posix.join(seg, 'index.md'))
      : assertSafeDocRel(path.posix.join(localeKey, seg, 'index.md'));
    if (usedRoutes.has(docRel) || emittedCategoryIndex.has(docRel)) {
      continue;
    }
    emittedCategoryIndex.add(docRel);
    usedRoutes.add(docRel);

    const absPath = path.join(outDir, ...docRel.split('/'));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const fm = buildFrontMatter(
      {
        name: folder.name,
        description: folder.description,
        order: typeof folder.order === 'number' && !Number.isNaN(folder.order) ? folder.order : undefined,
      },
      seg,
    );
    fs.writeFileSync(absPath, fm, 'utf8');
    folderIndexWritten++;
    console.log(`写入分类索引 ${path.relative(ROOT, absPath)}`);
  }

  /** 主题：按语言生成顶栏 Wiki 入口 + 侧栏（路径与 md 一致） */
  if (!noTheme) {
    /** 仅删除旧版 docs/zh-cn/index.md；保留并覆盖 docs/en-us/index.md（由下方 writeEnUsLanding 写入） */
    const legacyZhIndex = path.join(outDir, 'zh-cn', 'index.md');
    if (fs.existsSync(legacyZhIndex)) {
      fs.unlinkSync(legacyZhIndex);
      console.log(`已删除 ${path.relative(ROOT, legacyZhIndex)}（旧版中文语言首页）`);
    }
    const localesPayload = { locales: {} };
    for (const loc of LOCALE_PATHS) {
      const vpLocaleKey = isDefaultWikiLocale(loc) ? 'root' : loc;
      const lr = getLocaleRootPage(pages, loc);
      if (!lr) {
        localesPayload.locales[vpLocaleKey] = { wikiNavItem: null, wikiSidebars: {} };
        continue;
      }
      const channels = pages.filter(
        (p) =>
          p &&
          p.hidden === true &&
          String(p.parent_id) === String(lr.id) &&
          parentIdsWithVisibleChildren.has(String(p.id)),
      );
      channels.sort(sortByOrderThenPath);
      if (channels.length === 0) {
        localesPayload.locales[vpLocaleKey] = { wikiNavItem: null, wikiSidebars: {} };
        continue;
      }
      /** @type {Record<string, unknown[]>} */
      const wikiSidebars = {};
      let primaryNav = null;
      for (const ch of channels) {
        const groupItems = buildSidebarForChannel(loc, ch.id, pages, byId, parentIdsWithVisibleChildren);
        const chPath = String(ch.path).trim().replace(/^\/+|\/+$/g, '');
        const prefix = (isDefaultWikiLocale(loc) ? `/${chPath}/` : `/${loc}/${chPath}/`).replace(/\/+/g, '/');
        const first =
          firstLinkInSidebar(groupItems) ||
          (isDefaultWikiLocale(loc) ? `/${chPath}/` : `/${loc}/${chPath}/`).replace(/\/+/g, '/');
        if (!primaryNav) {
          const channelBase = (
            isDefaultWikiLocale(loc) ? `/${chPath}/` : `/${loc}/${chPath}/`
          ).replace(/\/+/g, '/');
          const activeMatch =
            '^' +
            channelBase.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
          primaryNav = { text: ch.name || ch.path, link: first, activeMatch };
        }
        if (channels.length === 1) {
          wikiSidebars[prefix] = groupItems;
        } else {
          wikiSidebars[prefix] = [
            {
              text: ch.name || ch.path,
              collapsed: false,
              items: groupItems,
            },
          ];
        }
      }
      localesPayload.locales[vpLocaleKey] = {
        wikiNavItem: primaryNav,
        wikiSidebars,
      };
    }
    writeWikiThemeModule(themeOut, localesPayload);
    console.log(`写入 ${path.relative(ROOT, themeOut)}`);
  }

  writeEnUsLandingPage(outDir);

  console.log(
    `\n完成: 写入 ${written} 个页面, 分类索引 ${folderIndexWritten}; 跳过 hidden=${skippedHidden}, 无 path=${skippedNoPath}, 无语言根=${skippedNoLocale}。数据源: ${path.relative(ROOT, source)}`,
  );
  if (data.fetchedAt) {
    console.log(`fetchedAt: ${data.fetchedAt}`);
  }
  console.log('\n下一步: npm run docs:dev 或 npm run docs:build');
}

main();
