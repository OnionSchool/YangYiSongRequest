// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  typescript: { strict: true },

  modules: ['@pinia/nuxt'],

  // SPA 模式（与原有 Vite 部署方式一致）
  ssr: false,

  // 运行时配置
  runtimeConfig: {
    public: {
      apiBase: '/api',
    },
  },

  // 路径别名
  alias: {
    '@': '~',
    '@components': '~/components',
    '@pages': '~/pages',
    '@stores': '~/stores',
    '@composables': '~/composables',
    '@layouts': '~/layouts',
    '@assets': '~/assets',
    '@app': '~/app',
  },

  // CSS 配置
  css: ['~/assets/css/main.css'],

  // PostCSS 配置
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },

  // 应用配置
  app: {
    head: {
      title: '杨村一中校园广播电视台',
      meta: [
        { name: 'description', content: '在线点歌系统' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
});
