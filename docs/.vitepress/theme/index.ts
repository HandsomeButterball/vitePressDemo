import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { theme, useOpenapi, useTheme } from 'vitepress-openapi/client'
import 'vitepress-openapi/dist/style.css'

import spec from '../../public/ship-customer.openapi.json' with { type: 'json' }

export default {
  extends: DefaultTheme,
  async enhanceApp({ app }) {
    const openapi = useOpenapi({
      spec,
      config: {
        spec: {
          groupByTags: true,
        },
      },
    })

    useTheme({
      operation: {
        hiddenSlots: ['playground', 'try-it'],
      },
      codeSamples: {
        defaultLang: 'curl',
        availableLanguages: [
          ...useTheme().getCodeSamplesAvailableLanguages(['curl', 'javascript', 'python', 'php']),
          {
            lang: 'node',
            label: 'Node.js',
            highlighter: 'javascript',
            icon: '.js',
            target: 'node',
            client: 'fetch',
          },
          {
            lang: 'java',
            label: 'Java',
            highlighter: 'java',
            icon: '.java',
            target: 'java',
            client: 'okhttp',
          },
        ],
      },
    })

    theme.enhanceApp({ app, openapi })
  },
} satisfies Theme
