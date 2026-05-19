import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress/theme'
import wikiTheme from './wiki-theme.generated.mjs'

const zh = wikiTheme.locales?.root ?? wikiTheme.locales?.['zh-cn'] ?? {}
const en = wikiTheme.locales?.['en-us'] ?? {}

/** 与 Vite / VitePress 文档站一致的默认站点图标（public/logo.svg） */
const siteLogo: DefaultTheme.Config['logo'] = '/logo.svg'

/** 默认主题本地搜索文案（中文 root）；en-us 未配置时使用组件内置英文 */
const zhLocalSearchTranslations: NonNullable<
  DefaultTheme.LocalSearchOptions['translations']
> = {
  button: {
    buttonText: '搜索',
    buttonAriaLabel: '搜索文档',
  },
  modal: {
    displayDetails: '显示完整列表',
    resetButtonTitle: '清除搜索',
    backButtonTitle: '关闭搜索',
    /** 与模板拼接为：{本段} "关键词" */
    noResultsText: '无匹配结果：',
    footer: {
      selectText: '选择',
      selectKeyAriaLabel: '回车键',
      navigateText: '在结果间移动',
      navigateUpKeyAriaLabel: '上方向键',
      navigateDownKeyAriaLabel: '下方向键',
      closeText: '关闭',
      closeKeyAriaLabel: 'Esc 键',
    },
  },
}

/** wiki-sync 顶栏：优先 wikiNav 数组（含下拉），兼容旧版单个 wikiNavItem */
function navFromWiki(locale: Record<string, unknown>): DefaultTheme.NavItem[] {
  const list = locale.wikiNav as DefaultTheme.NavItem[] | undefined
  if (Array.isArray(list) && list.length > 0) {
    return list
  }
  const single = locale.wikiNavItem as DefaultTheme.NavItem | null | undefined
  return single ? [single] : []
}

/** 兼容 wiki-sync 生成的 wikiSidebars（对象）或旧版 wikiSidebar（数组） */
function sidebarFromWiki(
  locale: Record<string, unknown>,
  legacyPrefix: string,
): DefaultTheme.Config['sidebar'] {
  const map = locale.wikiSidebars as Record<string, DefaultTheme.SidebarItem[]> | undefined
  if (map && typeof map === 'object' && Object.keys(map).length > 0) {
    return map
  }
  const list = locale.wikiSidebar as DefaultTheme.SidebarItem[] | undefined
  return { [legacyPrefix]: Array.isArray(list) ? list : [] }
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Nexus',
  description: 'VitePress + Wiki sync（中文默认 + en-us）',
  /** 路由不带 .html，与 wiki-sync 生成的 path 一致，如 /reference/manifest/overview */
  cleanUrls: true,
  /**
   * 本地搜索必须写在顶层 themeConfig：VitePress 的 local-search 插件只读
   * `site.themeConfig.search`，不会读 locales.*.themeConfig（多语言下否则搜索不启用）。
   */
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: zhLocalSearchTranslations,
          },
        },
      },
    },
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        logo: siteLogo,
        logoLink: '/',
        nav: navFromWiki(zh as Record<string, unknown>),
        sidebar: sidebarFromWiki(zh as Record<string, unknown>, '/user-manual/'),
        socialLinks: [{ icon: 'github', link: 'https://github.com/vuejs/vitepress' }],
      },
    },
    'en-us': {
      label: 'English',
      lang: 'en-US',
      /** 语言 URL 前缀；须为 `/en-us/`，勿写具体文档路径，否则顶栏 Nexus 与语言切换会异常 */
      link: '/en-us/',
      themeConfig: {
        logo: siteLogo,
        /** 英文文档内点 Nexus 回到根站首页（与中文首页一致） */
        logoLink: '/',
        nav: navFromWiki(en as Record<string, unknown>),
        sidebar: sidebarFromWiki(en as Record<string, unknown>, '/en-us/user-manual/'),
        socialLinks: [{ icon: 'github', link: 'https://github.com/vuejs/vitepress' }],
      },
    },
  },
})
