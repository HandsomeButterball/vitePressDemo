#!/usr/bin/env node
/**
 * Wiki 拉取（模拟流水线 / 可选真实 HTTP）
 *
 * 输出统一 JSON：`{ fetchedAt, pages: [...] }`，字段与 scripts/wiki-mock-data.json 一致。
 * 贵司 OpenAPI 若字段名不同，请改 normalizeApiPayload() 或单独写适配层。
 *
 * 用法:
 *   node scripts/wiki-fetch.mjs
 *   node scripts/wiki-fetch.mjs --out scripts/.wiki-cache/last-pages.json
 *
 * Mock（默认）:
 *   WIKI_USE_MOCK=true
 *
 * 单一 JSON 端点（CI 导出或网关已聚合为归一化结构）:
 *   WIKI_USE_MOCK=false WIKI_SOURCE_URL=https://... WIKI_TOKEN=xxx node scripts/wiki-fetch.mjs
 *
 * OpenAPI 文档可参考: https://worktile.apifox.cn/ （按实际「知识库/Wiki」分组调整 URL 与 normalize）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let outFile = path.join(ROOT, 'scripts', '.wiki-cache', 'last-pages.json');
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && argv[i + 1]) {
      outFile = path.resolve(ROOT, argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log(`wiki-fetch — 写出归一化 Wiki JSON

  --out <file>   输出路径（默认 scripts/.wiki-cache/last-pages.json）

环境变量:
  WIKI_USE_MOCK     默认 true；设为 false 走 HTTP
  WIKI_SOURCE_URL   GET 返回 JSON（可与 WIKI_TOKEN 联用）
  WIKI_TOKEN        可选，Authorization: Bearer
  WIKI_MOCK_PATH    模拟数据源（默认 scripts/wiki-mock-data.json）`);
      process.exit(0);
    }
  }
  return { outFile };
}

function logStep(step, detail) {
  console.log(`[wiki-fetch] ${step}${detail != null ? `: ${detail}` : ''}`);
}

/**
 * 将任意常见 API 外壳转为 { fetchedAt?, pages }
 * @param {unknown} json
 */
function normalizeApiPayload(json) {
  /** @param {{ fetchedAt?: string, pages: unknown[], vitepress?: unknown }} o */
  const withMeta = (o) => {
    if (json && typeof json === 'object' && 'vitepress' in json && json.vitepress != null) {
      return { ...o, vitepress: json.vitepress };
    }
    return o;
  };
  if (json && typeof json === 'object' && Array.isArray(/** @type {{pages:unknown}} */ (json).pages)) {
    return withMeta(/** @type {{ fetchedAt?: string, pages: unknown[] }} */ (json));
  }
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') {
    const d = json.data;
    if (Array.isArray(d.pages)) {
      const base = { fetchedAt: d.fetchedAt, pages: d.pages };
      if (d.vitepress != null) {
        return { ...base, vitepress: d.vitepress };
      }
      return withMeta(base);
    }
    if (Array.isArray(d.list)) {
      return { pages: d.list };
    }
    if (Array.isArray(d.items)) {
      return { pages: d.items };
    }
  }
  if (Array.isArray(json)) {
    return { pages: json };
  }
  throw new Error(
    '无法识别 API JSON 结构。请在 scripts/wiki-fetch.mjs 的 normalizeApiPayload() 中增加贵司 Wiki 返回体的映射。',
  );
}

async function fetchFromHttp(url, token) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }
  logStep('HTTP GET', url);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return normalizeApiPayload(json);
}

function readMockPayload() {
  const mockPath =
    process.env.WIKI_MOCK_PATH || path.join(ROOT, 'scripts', 'wiki-mock-data.json');
  logStep('使用 Mock 数据', path.relative(ROOT, mockPath));
  const raw = fs.readFileSync(mockPath, 'utf8');
  return JSON.parse(raw);
}

function simulatePipeline(useMock) {
  logStep('步骤 1/3', '获取访问凭证（Mock 下跳过真实 OAuth2 / Tenant Token 请求）');
  logStep('步骤 2/3', useMock ? '列出知识库页面（读取本地 JSON 代替 LIST API）' : 'LIST API 见 WIKI_SOURCE_URL');
  logStep('步骤 3/3', useMock ? '合并正文（mock 已含 bodyMarkdown）' : '若列表无正文，可在此扩展为逐页 GET 详情');
}

async function main() {
  const { outFile } = parseArgs(process.argv);
  const useMock = process.env.WIKI_USE_MOCK !== 'false';

  console.log(`[wiki-fetch] mode=${useMock ? 'mock' : 'http'}\n`);
  simulatePipeline(useMock);

  let payload;
  if (useMock) {
    payload = readMockPayload();
    if (!payload.fetchedAt) {
      payload.fetchedAt = new Date().toISOString();
    }
  } else {
    const url = process.env.WIKI_SOURCE_URL;
    if (!url) {
      console.error('WIKI_USE_MOCK=false 时必须设置 WIKI_SOURCE_URL（返回 JSON 的 URL）');
      process.exit(1);
    }
    const token = process.env.WIKI_TOKEN || '';
    payload = await fetchFromHttp(url, token);
    payload.fetchedAt = payload.fetchedAt || new Date().toISOString();
  }

  if (!Array.isArray(payload.pages)) {
    console.error('归一化结果缺少 pages 数组');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  logStep('已写入', path.relative(ROOT, outFile));
  console.log(
    `\n共 ${payload.pages.length} 条页面记录。wiki-sync 将按 type / 子节点 / 正文推断文件夹（不依赖 hidden）。下一步: node scripts/wiki-sync.mjs --source ${path.relative(ROOT, outFile)} --out docs --clean`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
