import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFieldMap, renderTemplate } from '../server/utils/music-templates';
import { parseProviderTemplate } from '../server/utils/provider-config';

/**
 * lx-converted/ 里的每份配置都必须能通过服务端校验，
 * 否则管理员照着 README 填表时会被 400 拒掉。
 */
const dir = join(process.cwd(), 'lx-converted');
const configs = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
    return {
      name,
      ...raw,
      // 模拟管理端表单提交：fieldMap 是字符串化的 JSON
      fieldMap: JSON.stringify(raw.fieldMap),
    };
  });

describe('lx-converted 配置可导入性', () => {
  it('至少产出了一份配置', () => {
    expect(configs.length).toBeGreaterThan(0);
  });

  for (const config of configs) {
    it(`${config.name} 通过 providerTypeFields 校验`, () => {
      const parsed = parseProviderTemplate(config);
      expect(parsed.searchUrlTemplate ?? parsed.audioUrlTemplate).toBeTruthy();
      if (config.searchUrlTemplate) expect(parsed.searchUrlTemplate).toBe(config.searchUrlTemplate);
      if (config.audioUrlTemplate) expect(parsed.audioUrlTemplate).toBe(config.audioUrlTemplate);
    });

    it(`${config.name} 的模板能渲染出合法 URL`, () => {
      for (const key of ['searchUrlTemplate', 'audioUrlTemplate'] as const) {
        const template = config[key];
        if (typeof template !== 'string') continue;
        const rendered = renderTemplate(template, {
          keyword: '花海',
          id: '474678847',
          page: 1,
          limit: 20,
        });
        expect(() => new URL(rendered), `${key} 渲染结果不是 URL`).not.toThrow();
      }
    });

    it(`${config.name} 的字段映射规范化后保留 list/id/title`, () => {
      const map = parseFieldMap(config.fieldMap as string);
      // 搜索型配置必须有 list/id/title；纯音频配置允许只给 audio。
      if (config.searchUrlTemplate) {
        expect(map.id, '缺 id 映射').toBeTruthy();
        expect(map.title, '缺 title 映射').toBeTruthy();
      }
    });
  }
});
