import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: '校园广播点歌系统',
  description: '杨村一中校园广播电视台在线点歌系统文档',
  cleanUrls: true,
  themeConfig: {
    logo: '/mark.svg',
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '部署运维', link: '/operations/deployment' },
      { text: 'API 参考', link: '/reference/api' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '系统简介', link: '/guide/introduction' },
            { text: '本地开发', link: '/guide/development' },
          ],
        },
        {
          text: '管理使用',
          items: [{ text: '后台角色与工作流', link: '/guide/administration' }],
        },
      ],
      '/operations/': [
        {
          text: '部署运维',
          items: [
            { text: '部署与反向代理', link: '/operations/deployment' },
            { text: '音源、缓存与备份', link: '/operations/media-and-backup' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: 'API 响应与接口', link: '/reference/api' },
            { text: '架构与安全', link: '/reference/architecture' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/' }],
    search: { provider: 'local' },
    footer: {
      message: '内部部署与使用文档',
      copyright: '杨村一中校园广播电视台',
    },
  },
});
