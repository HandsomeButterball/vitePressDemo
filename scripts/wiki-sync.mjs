#!/usr/bin/env node
/**
 * Wiki 打平 JSON → VitePress Markdown（与 docgeniDemo 同源逻辑）
 *
 * - 语言根：path 为 zh-cn / en-us 的文件夹节点；中文写入 docs/ 根下（无 zh-cn 前缀），英文写入 docs/en-us/…
 * - title 取自 name；有子节点时父页用 …/末段/index.md，否则 …/末段.md
 * - 文件夹节点（不依赖 API 的 hidden）：type===2、无正文但有子节点、或语言根；写 …/<segment>/index.md
 * - 同步结束后写入 docs/index.md、docs/en-us/index.md（首页按钮链到 wikiNav 首个入口）
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

/** @param {{ name?: string, description?: string, order?: number, path?: string, isFolder?: boolean }} page */
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
  if (isWikiFolder(page)) {
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

function pageToVpLink(localeKey, page, byId, parentIdsWithVisibleChildren, foldedPageIds) {
  if (foldedPageIds?.has(String(page.id))) {
    const parent = byId.get(String(page.parent_id));
    if (parent) {
      return pageToVpLink(
        localeKey,
        parent,
        byId,
        parentIdsWithVisibleChildren,
        foldedPageIds,
      );
    }
  }
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

/** Wiki API 原始条目 → 统一 pages 字段（兼容 _id / position / type） */
function slugFromWikiName(name) {
  if (name == null || !String(name).trim()) {
    return 'page';
  }
  const paren = String(name).match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    return paren[1]
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '');
}

function normalizeWikiPage(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = raw.id ?? raw._id;
  if (id == null) {
    return null;
  }
  const order =
    typeof raw.order === 'number' && !Number.isNaN(raw.order)
      ? raw.order
      : typeof raw.position === 'number' && !Number.isNaN(raw.position)
        ? raw.position
        : undefined;
  let path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : '';
  if (!path) {
    path = slugFromWikiName(raw.name);
  }
  const type = raw.type ?? raw.page_type ?? raw.pageType;
  return {
    ...raw,
    id: String(id),
    path,
    ...(type !== undefined && type !== null ? { type } : {}),
    ...(order !== undefined ? { order } : {}),
    parent_id: raw.parent_id ?? null,
    parent_ids: Array.isArray(raw.parent_ids) ? raw.parent_ids : [],
  };
}

function normalizeWikiPages(rawPages) {
  const out = [];
  for (const p of rawPages) {
    const n = normalizeWikiPage(p);
    if (n) {
      out.push(n);
    }
  }
  return enrichWikiPages(out);
}

/** Wiki 正文（多字段兼容） */
function wikiPageBody(page) {
  const v =
    page?.bodyMarkdown ?? page?.body ?? page?.content ?? page?.markdown ?? page?.body_markdown ?? '';
  return typeof v === 'string' ? v.trim() : '';
}

function isLocaleRootPage(page) {
  const pathKey = String(page?.path ?? '').trim();
  if (!LOCALE_PATHS.has(pathKey)) {
    return false;
  }
  return page.parent_id == null || page.parent_id === '';
}

function wikiTypeIsFolder(type) {
  return type === 2 || type === '2' || type === 'folder';
}

function wikiTypeIsDocument(type) {
  return type === 1 || type === '1' || type === 'page' || type === 'document';
}

/**
 * 推断文件夹 vs 文档页（不依赖 API hidden）：
 * - type 2 / folder → 文件夹
 * - zh-cn、en-us 语言根 → 文件夹
 * - 有子节点且无正文 → 文件夹（频道、CLI 分组等）
 * - type 1 且有正文 → 文档（即使有子节点，如 build + list）
 */
function enrichWikiPages(pages) {
  const childCount = new Map();
  for (const p of pages) {
    if (p.parent_id != null && String(p.parent_id)) {
      const pid = String(p.parent_id);
      childCount.set(pid, (childCount.get(pid) || 0) + 1);
    }
  }
  for (const p of pages) {
    const hasKids = (childCount.get(String(p.id)) || 0) > 0;
    const body = wikiPageBody(p);
    const localeRoot = isLocaleRootPage(p);
    const type = p.type;
    let isFolder = false;
    if (localeRoot) {
      isFolder = true;
    } else if (wikiTypeIsFolder(type)) {
      isFolder = true;
    } else if (wikiTypeIsDocument(type) && body) {
      isFolder = false;
    } else if (hasKids && !body) {
      isFolder = true;
    } else if (p.hidden === true) {
      isFolder = true;
    }
    p.isFolder = isFolder;
  }
  return pages;
}

function isWikiFolder(page) {
  return page?.isFolder === true;
}

function isWikiDocument(page) {
  return Boolean(page && !isWikiFolder(page));
}

function escapeRegExp(s) {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** 侧栏去重：分组名与页面名一致时视为同一入口（如 CLI(cli) 文件夹 + 同名文档） */
function normalizeWikiDisplayName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase();
}

function wikiNamesEqual(a, b) {
  return normalizeWikiDisplayName(a?.name ?? a) === normalizeWikiDisplayName(b?.name ?? b);
}

/** 分组下直接子级里与分组同名的首个可见文档页 */
function findSameNamePageUnderFolder(folder, pages, parentIdsWithVisibleChildren) {
  const nodes = getTreeChildNodes(pages, folder.id, parentIdsWithVisibleChildren);
  for (const n of nodes) {
    if (!parentIdsWithVisibleChildren.has(String(n.id)) && wikiNamesEqual(n, folder)) {
      return n;
    }
  }
  return null;
}

/** 与分组同名的文档合并进分组 index.md，不再单独生成 intro/overview 一层路径 */
function buildFoldedPageIds(pages, parentIdsWithVisibleChildren) {
  const folded = new Set();
  for (const folder of pages) {
    if (!folder || !isWikiFolder(folder)) {
      continue;
    }
    if (!parentIdsWithVisibleChildren.has(String(folder.id))) {
      continue;
    }
    const same = findSameNamePageUnderFolder(folder, pages, parentIdsWithVisibleChildren);
    if (same) {
      folded.add(String(same.id));
    }
  }
  return folded;
}

/** 从侧栏子树中去掉与分组同名的重复叶子（分组标题即页面入口） */
function pruneSameNameFromSidebarItems(items, folderNode, sameNameLink) {
  const folderLabel = normalizeWikiDisplayName(folderNode.name || folderNode.path);
  const out = [];
  for (const it of items) {
    if (it.items?.length) {
      const nested = pruneSameNameFromSidebarItems(it.items, folderNode, sameNameLink);
      if (nested.length > 0) {
        out.push({ ...it, items: nested });
      }
      continue;
    }
    if (sameNameLink && it.link === sameNameLink) {
      continue;
    }
    if (normalizeWikiDisplayName(it.text) === folderLabel) {
      continue;
    }
    out.push(it);
  }
  return out;
}

/**
 * 频道下直接子节点：可见页，或 hidden 但有子文档的文件夹
 * @param {any[]} pages
 * @param {string} parentId
 * @param {Set<string>} parentIdsWithVisibleChildren
 */
function getTreeChildNodes(pages, parentId, parentIdsWithVisibleChildren) {
  return pages
    .filter((p) => p && String(p.parent_id) === String(parentId))
    .filter((p) => isWikiDocument(p) || parentIdsWithVisibleChildren.has(String(p.id)))
    .sort(sortByOrderThenPath);
}

/** 频道下是否「全是分组文件夹」（子项也都是分组）→ 顶栏用下拉 */
function channelUsesNavDropdown(channelId, pages, parentIdsWithVisibleChildren) {
  const children = getTreeChildNodes(pages, channelId, parentIdsWithVisibleChildren);
  if (children.length === 0) {
    return false;
  }
  return children.every((c) => isWikiFolder(c) && parentIdsWithVisibleChildren.has(String(c.id)));
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
 * 递归侧栏（支持 hidden 分组文件夹与多级嵌套，如 reference/cli/build/list）
 * @param {string} localeKey
 * @param {string} parentId
 */
function buildSidebarTree(
  localeKey,
  parentId,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  const children = getTreeChildNodes(pages, parentId, parentIdsWithVisibleChildren);
  const items = [];
  for (const child of children) {
    if (foldedPageIds?.has(String(child.id))) {
      continue;
    }
    const hasKids = parentIdsWithVisibleChildren.has(String(child.id));
    if (hasKids) {
      const sameNamePage = findSameNamePageUnderFolder(
        child,
        pages,
        parentIdsWithVisibleChildren,
      );
      let groupItems = buildSidebarTree(
        localeKey,
        child.id,
        pages,
        byId,
        parentIdsWithVisibleChildren,
        foldedPageIds,
      );
      const pageLink = sameNamePage
        ? pageToVpLink(localeKey, child, byId, parentIdsWithVisibleChildren, foldedPageIds)
        : null;
      if (sameNamePage && pageLink) {
        groupItems = pruneSameNameFromSidebarItems(groupItems, child, pageLink);
      }
      const folderLink =
        pageLink ||
        pageToVpLink(localeKey, child, byId, parentIdsWithVisibleChildren, foldedPageIds);
      if (groupItems.length === 0) {
        if (folderLink) {
          items.push({ text: child.name || child.path, link: folderLink });
        }
      } else {
        items.push({
          text: child.name || child.path,
          ...(folderLink ? { link: folderLink } : {}),
          collapsed: false,
          items: groupItems,
        });
      }
    } else {
      const link = pageToVpLink(
        localeKey,
        child,
        byId,
        parentIdsWithVisibleChildren,
        foldedPageIds,
      );
      if (link) {
        items.push({ text: child.name || child.path, link });
      }
    }
  }
  return items;
}

function buildSidebarForChannel(
  localeKey,
  channelFolderId,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  return buildSidebarTree(
    localeKey,
    channelFolderId,
    pages,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
}

/** VitePress 侧栏前缀：频道下某一一级分组，如 /reference/cli/ */
function sectionSidebarPrefix(localeKey, channelPath, groupPath) {
  const ch = String(channelPath).trim().replace(/^\/+|\/+$/g, '');
  const gp = String(groupPath).trim().replace(/^\/+|\/+$/g, '');
  if (isDefaultWikiLocale(localeKey)) {
    return `/${ch}/${gp}/`.replace(/\/+/g, '/');
  }
  return `/${localeKey}/${ch}/${gp}/`.replace(/\/+/g, '/');
}

/** 分组首页链接（合并进 index.md 的同名文档仍指向 /reference/cli/ 等） */
function sectionGroupLandingLink(
  localeKey,
  groupFolder,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  return pageToVpLink(
    localeKey,
    groupFolder,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
}

/** 分组侧栏顶部的「概览」入口（合并掉的 intro/overview 仍要在侧栏展示） */
function sectionGroupOverviewSidebarEntry(
  localeKey,
  groupFolder,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  const link = sectionGroupLandingLink(
    localeKey,
    groupFolder,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
  if (!link) {
    return null;
  }
  const sameNamePage = findSameNamePageUnderFolder(
    groupFolder,
    pages,
    parentIdsWithVisibleChildren,
  );
  return {
    text: sameNamePage?.name || groupFolder.name || groupFolder.path,
    link,
  };
}

/**
 * 顶栏下拉频道：每个一级分组独立侧栏（点 CLI 只显示 cli 子树，不混入 manifest）
 */
function buildSidebarForSectionGroup(
  localeKey,
  groupFolder,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  let items = buildSidebarTree(
    localeKey,
    groupFolder.id,
    pages,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
  const overview = sectionGroupOverviewSidebarEntry(
    localeKey,
    groupFolder,
    pages,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
  if (overview) {
    if (items.length === 0) {
      items = [overview];
    } else if (!items.some((it) => it.link === overview.link)) {
      items = [overview, ...items];
    }
  } else if (items.length === 0) {
    const link = sectionGroupLandingLink(
      localeKey,
      groupFolder,
      byId,
      parentIdsWithVisibleChildren,
      foldedPageIds,
    );
    if (link) {
      items = [{ text: groupFolder.name || groupFolder.path, link }];
    }
  }
  return items;
}

function registerSplitChannelSidebars(
  wikiSidebars,
  localeKey,
  channel,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  const groups = getTreeChildNodes(pages, channel.id, parentIdsWithVisibleChildren);
  const chPath = String(channel.path).trim();
  for (const g of groups) {
    const prefix = sectionSidebarPrefix(localeKey, chPath, g.path);
    wikiSidebars[prefix] = buildSidebarForSectionGroup(
      localeKey,
      g,
      pages,
      byId,
      parentIdsWithVisibleChildren,
      foldedPageIds,
    );
  }
}

/**
 * 顶栏下拉：列出频道下各一级分组的首个文档链接（类似 Atlassian Reference 菜单）
 */
function buildNavDropdownForChannel(
  localeKey,
  channel,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  const groups = getTreeChildNodes(pages, channel.id, parentIdsWithVisibleChildren);
  const items = [];
  for (const g of groups) {
    const link =
      sectionGroupLandingLink(
        localeKey,
        g,
        byId,
        parentIdsWithVisibleChildren,
        foldedPageIds,
      ) ||
      firstLinkInSidebar(
        buildSidebarTree(
          localeKey,
          g.id,
          pages,
          byId,
          parentIdsWithVisibleChildren,
          foldedPageIds,
        ),
      ) ||
      pageToVpLink(localeKey, g, byId, parentIdsWithVisibleChildren, foldedPageIds);
    if (link) {
      items.push({ text: g.name || g.path, link });
    }
  }
  const chPath = String(channel.path).trim().replace(/^\/+|\/+$/g, '');
  const channelBase = (
    isDefaultWikiLocale(localeKey) ? `/${chPath}/` : `/${localeKey}/${chPath}/`
  ).replace(/\/+/g, '/');
  return {
    text: channel.name || channel.path,
    items,
    activeMatch: '^' + escapeRegExp(channelBase),
  };
}

function buildNavLinkForChannel(
  localeKey,
  channel,
  pages,
  byId,
  parentIdsWithVisibleChildren,
  foldedPageIds,
) {
  const groupItems = buildSidebarForChannel(
    localeKey,
    channel.id,
    pages,
    byId,
    parentIdsWithVisibleChildren,
    foldedPageIds,
  );
  const chPath = String(channel.path).trim().replace(/^\/+|\/+$/g, '');
  const first =
    firstLinkInSidebar(groupItems) ||
    (isDefaultWikiLocale(localeKey) ? `/${chPath}/` : `/${localeKey}/${chPath}/`).replace(/\/+/g, '/');
  const channelBase = (
    isDefaultWikiLocale(localeKey) ? `/${chPath}/` : `/${localeKey}/${chPath}/`
  ).replace(/\/+/g, '/');
  return {
    text: channel.name || channel.path,
    link: first,
    activeMatch: '^' + escapeRegExp(channelBase),
  };
}

function getLocaleRootPage(pages, localeKey) {
  return pages.find(
    (p) => p && typeof p === 'object' && String(p.path).trim() === localeKey && isLocaleRootPage(p),
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

/** 从 wiki-sync 生成的顶栏取首个文档入口（用于首页按钮，避免手写路径） */
function firstNavDocLink(wikiNav) {
  if (!Array.isArray(wikiNav)) {
    return null;
  }
  for (const item of wikiNav) {
    if (item?.link) {
      return item.link;
    }
    if (Array.isArray(item.items)) {
      for (const sub of item.items) {
        if (sub?.link) {
          return sub.link;
        }
      }
    }
  }
  return null;
}

function writeRootLandingPage(outDir, zhDocLink, enDocLink) {
  const docLink = zhDocLink || '/user-manual/overview';
  const enLink = enDocLink || '/en-us/user-manual/overview';
  const body = `---
layout: home
hero:
  name: Nexus
  text: Wiki → VitePress
  tagline: 中文为默认站点；英文见语言切换
  actions:
    - theme: brand
      text: 进入文档
      link: ${docLink}
    - theme: alt
      text: English
      link: ${enLink}
---
`;
  const abs = path.join(outDir, 'index.md');
  fs.writeFileSync(abs, body, 'utf8');
  console.log(`写入 ${path.relative(ROOT, abs)}（中文站点首页）`);
}

function writeEnUsLandingPage(outDir, enDocLink) {
  const docLink = enDocLink || '/en-us/user-manual/overview';
  const body = `---
layout: home
hero:
  name: Nexus
  text: Wiki → VitePress
  tagline: English locale — use the language menu for 中文
  actions:
    - theme: brand
      text: User Manual
      link: ${docLink}
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
  const pages = normalizeWikiPages(Array.isArray(data.pages) ? data.pages : []);

  const byId = new Map();
  for (const p of pages) {
    byId.set(String(p.id), p);
  }

  /** 直接父级 + 向上追溯到语言根：保证 reference 等中间频道文件夹能被识别 */
  const parentIdsWithVisibleChildren = new Set();
  for (const p of pages) {
    if (p && typeof p === 'object' && isWikiDocument(p) && p.parent_id != null) {
      let cur = String(p.parent_id);
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        parentIdsWithVisibleChildren.add(cur);
        const parent = byId.get(cur);
        cur = parent?.parent_id != null ? String(parent.parent_id) : '';
      }
    }
  }

  if (clean) {
    rmMarkdownUnder(path.join(outDir, 'user-manual'));
    rmMarkdownUnder(path.join(outDir, 'reference'));
    for (const loc of LOCALE_PATHS) {
      rmMarkdownUnder(path.join(outDir, loc));
    }
    console.log(
      `已清理 ${path.relative(ROOT, outDir)} 下 user-manual、reference、zh-cn、en-us 中的 .md`,
    );
  }

  const foldedPageIds = buildFoldedPageIds(pages, parentIdsWithVisibleChildren);

  let written = 0;
  let skippedFolder = 0;
  let skippedFolded = 0;
  let skippedNoPath = 0;
  let skippedNoLocale = 0;
  const usedRoutes = new Set();

  for (const page of pages) {
    if (!page || typeof page !== 'object') {
      continue;
    }
    if (isWikiFolder(page)) {
      skippedFolder++;
      continue;
    }
    if (foldedPageIds.has(String(page.id))) {
      const chainFold = chainRootToLeaf(page, byId);
      const resolvedFold = resolveLocaleAndSegments(chainFold);
      if (resolvedFold) {
        const routeFold = resolvedFold.segments
          .map((s) => assertSafeSegment(s, page.id))
          .join('/');
        const staleRel = wikiOutputDocRel(
          resolvedFold.localeKey,
          routeFold,
          parentIdsWithVisibleChildren.has(String(page.id)),
        );
        const stalePath = path.join(outDir, ...staleRel.split('/'));
        if (fs.existsSync(stalePath)) {
          fs.unlinkSync(stalePath);
          console.log(`删除已合并到分组 index 的旧页 ${path.relative(ROOT, stalePath)}`);
        }
      }
      skippedFolded++;
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
    if (!folder || typeof folder !== 'object' || !isWikiFolder(folder)) {
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
    const chain = chainRootToLeaf(folder, byId);
    const resolved = resolveLocaleAndSegments(chain);
    if (!resolved) {
      continue;
    }
    const { localeKey, segments } = resolved;
    let safeSegments;
    try {
      safeSegments = segments.map((s) => assertSafeSegment(s, folder.id));
    } catch {
      continue;
    }
    const routeUnderLocale = safeSegments.join('/');
    const docRel = wikiOutputDocRel(localeKey, routeUnderLocale, true);
    if (usedRoutes.has(docRel) || emittedCategoryIndex.has(docRel)) {
      continue;
    }
    emittedCategoryIndex.add(docRel);
    usedRoutes.add(docRel);

    const absPath = path.join(outDir, ...docRel.split('/'));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const pathMetaLeaf = safeSegments[safeSegments.length - 1];
    const sameNamePage = findSameNamePageUnderFolder(
      folder,
      pages,
      parentIdsWithVisibleChildren,
    );
    const fmSource = sameNamePage
      ? {
          name: sameNamePage.name,
          description: sameNamePage.description,
          order:
            typeof sameNamePage.order === 'number' && !Number.isNaN(sameNamePage.order)
              ? sameNamePage.order
              : undefined,
        }
      : {
          name: folder.name,
          description: folder.description,
          order:
            typeof folder.order === 'number' && !Number.isNaN(folder.order)
              ? folder.order
              : undefined,
        };
    const fm = buildFrontMatter(fmSource, pathMetaLeaf);
    let indexBody = '';
    if (sameNamePage) {
      indexBody =
        typeof sameNamePage.bodyMarkdown === 'string'
          ? sameNamePage.bodyMarkdown
          : typeof sameNamePage.body === 'string'
            ? sameNamePage.body
            : localeKey === 'zh-cn'
              ? '_（无正文）_\n'
              : '_（No content）_\n';
      const metaComment = `<!-- wikiSync: id=${sameNamePage.id} locale=${localeKey} route=${routeUnderLocale} (merged index) -->\n`;
      indexBody = metaComment + (indexBody.endsWith('\n') ? indexBody : `${indexBody}\n`);
    }
    fs.writeFileSync(absPath, `${fm}${indexBody}`, 'utf8');
    folderIndexWritten++;
    console.log(
      sameNamePage
        ? `写入分组页（合并同名文档） ${path.relative(ROOT, absPath)}`
        : `写入分类索引 ${path.relative(ROOT, absPath)}`,
    );
  }

  /** 主题：按语言生成顶栏 Wiki 入口 + 侧栏（路径与 md 一致） */
  let localesPayload = null;
  if (!noTheme) {
    /** 仅删除旧版 docs/zh-cn/index.md；保留并覆盖 docs/en-us/index.md（由下方 writeEnUsLanding 写入） */
    const legacyZhIndex = path.join(outDir, 'zh-cn', 'index.md');
    if (fs.existsSync(legacyZhIndex)) {
      fs.unlinkSync(legacyZhIndex);
      console.log(`已删除 ${path.relative(ROOT, legacyZhIndex)}（旧版中文语言首页）`);
    }
    localesPayload = { locales: {} };
    for (const loc of LOCALE_PATHS) {
      const vpLocaleKey = isDefaultWikiLocale(loc) ? 'root' : loc;
      const lr = getLocaleRootPage(pages, loc);
      if (!lr) {
        localesPayload.locales[vpLocaleKey] = { wikiNav: [], wikiNavItem: null, wikiSidebars: {} };
        continue;
      }
      const channels = pages.filter(
        (p) =>
          p &&
          isWikiFolder(p) &&
          String(p.parent_id) === String(lr.id) &&
          parentIdsWithVisibleChildren.has(String(p.id)),
      );
      channels.sort(sortByOrderThenPath);
      if (channels.length === 0) {
        localesPayload.locales[vpLocaleKey] = { wikiNav: [], wikiNavItem: null, wikiSidebars: {} };
        continue;
      }
      /** @type {Record<string, unknown[]>} */
      const wikiSidebars = {};
      /** @type {unknown[]} */
      const wikiNav = [];
      for (const ch of channels) {
        const chPath = String(ch.path).trim().replace(/^\/+|\/+$/g, '');
        const prefix = (isDefaultWikiLocale(loc) ? `/${chPath}/` : `/${loc}/${chPath}/`).replace(/\/+/g, '/');
        const usesDropdown = channelUsesNavDropdown(
          ch.id,
          pages,
          parentIdsWithVisibleChildren,
        );
        if (usesDropdown) {
          wikiNav.push(
            buildNavDropdownForChannel(
              loc,
              ch,
              pages,
              byId,
              parentIdsWithVisibleChildren,
              foldedPageIds,
            ),
          );
          registerSplitChannelSidebars(
            wikiSidebars,
            loc,
            ch,
            pages,
            byId,
            parentIdsWithVisibleChildren,
            foldedPageIds,
          );
        } else {
          const groupItems = buildSidebarForChannel(
            loc,
            ch.id,
            pages,
            byId,
            parentIdsWithVisibleChildren,
            foldedPageIds,
          );
          wikiNav.push(
            buildNavLinkForChannel(
              loc,
              ch,
              pages,
              byId,
              parentIdsWithVisibleChildren,
              foldedPageIds,
            ),
          );
          wikiSidebars[prefix] = groupItems;
        }
      }
      localesPayload.locales[vpLocaleKey] = {
        wikiNav,
        wikiNavItem: wikiNav[0] ?? null,
        wikiSidebars,
      };
    }
    writeWikiThemeModule(themeOut, localesPayload);
    console.log(`写入 ${path.relative(ROOT, themeOut)}`);
  }

  const zhNav = localesPayload?.locales?.root?.wikiNav;
  const enNav = localesPayload?.locales?.['en-us']?.wikiNav;
  writeRootLandingPage(outDir, firstNavDocLink(zhNav), firstNavDocLink(enNav));
  writeEnUsLandingPage(outDir, firstNavDocLink(enNav));

  console.log(
    `\n完成: 写入 ${written} 个页面, 分类索引 ${folderIndexWritten}; 跳过文件夹=${skippedFolder}, 合并到分组 index=${skippedFolded}, 无 path=${skippedNoPath}, 无语言根=${skippedNoLocale}。数据源: ${path.relative(ROOT, source)}`,
  );
  if (data.fetchedAt) {
    console.log(`fetchedAt: ${data.fetchedAt}`);
  }
  console.log('\n下一步: npm run docs:dev 或 npm run docs:build');
}

main();
