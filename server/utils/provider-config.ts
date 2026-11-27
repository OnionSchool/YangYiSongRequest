import { badRequest } from './errors';
import { METING_CAPABILITIES } from './music-sources';
import type { MetingCapability, ProviderType } from './music-sources';
import { SOURCES } from './domain';
import type { SourceId } from './domain';
import { parseFieldMap } from './music-templates';

/** 模板类 provider 的四个 URL 模板与字段映射，来自管理端表单。 */
export interface ProviderTemplateInput {
  searchUrlTemplate?: unknown;
  detailUrlTemplate?: unknown;
  audioUrlTemplate?: unknown;
  coverUrlTemplate?: unknown;
  fieldMap?: unknown;
  metadataCapable?: unknown;
}

export interface ParsedProviderTemplate {
  searchUrlTemplate: string | null;
  detailUrlTemplate: string | null;
  audioUrlTemplate: string | null;
  coverUrlTemplate: string | null;
  fieldMap: string | null;
  metadataCapable: boolean;
}

const TEMPLATE_MAX_LENGTH = 2048;
const FIELD_MAP_MAX_LENGTH = 4096;

export function parseProviderType(value: unknown): ProviderType {
  return value === 'template' ? 'template' : 'meting';
}

export function validPlatforms(value: unknown): SourceId[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (platform): platform is SourceId =>
          typeof platform === 'string' && (SOURCES as readonly string[]).includes(platform)
      )
    ),
  ];
}

export function validCapabilities(value: unknown): MetingCapability[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (capability): capability is MetingCapability =>
          typeof capability === 'string' &&
          (METING_CAPABILITIES as readonly string[]).includes(capability)
      )
    ),
  ];
}

function templateValue(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('BAD_TEMPLATE', `${label}格式无效`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > TEMPLATE_MAX_LENGTH) {
    throw badRequest('BAD_TEMPLATE', `${label}不能超过 ${TEMPLATE_MAX_LENGTH} 个字符`);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw badRequest('BAD_TEMPLATE', `${label}必须是 http(s) 地址`);
  }
  return trimmed;
}

/** 校验模板 provider 的必填项：至少要有一个搜索模板才能建出来。 */
export function parseProviderTemplate(input: ProviderTemplateInput): ParsedProviderTemplate {
  const searchUrlTemplate = templateValue(input.searchUrlTemplate, '搜索地址模板');
  const detailUrlTemplate = templateValue(input.detailUrlTemplate, '详情地址模板');
  const audioUrlTemplate = templateValue(input.audioUrlTemplate, '音频地址模板');
  const coverUrlTemplate = templateValue(input.coverUrlTemplate, '封面地址模板');

  let fieldMap: string | null = null;
  if (input.fieldMap !== undefined && input.fieldMap !== null && input.fieldMap !== '') {
    if (typeof input.fieldMap !== 'string') throw badRequest('BAD_FIELD_MAP', '字段映射格式无效');
    const trimmed = input.fieldMap.trim();
    if (trimmed.length > FIELD_MAP_MAX_LENGTH) {
      throw badRequest('BAD_FIELD_MAP', `字段映射不能超过 ${FIELD_MAP_MAX_LENGTH} 个字符`);
    }
    if (trimmed) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
      } catch {
        throw badRequest('BAD_FIELD_MAP', '字段映射必须是 JSON 对象');
      }
      // 通过解析器回写规范化后的 JSON，顺带丢掉不认识的键。
      fieldMap = JSON.stringify(parseFieldMap(trimmed));
    }
  }

  return {
    searchUrlTemplate,
    detailUrlTemplate,
    audioUrlTemplate,
    coverUrlTemplate,
    fieldMap,
    metadataCapable: input.metadataCapable !== false,
  };
}

/** 从请求体里抽出 provider 公共字段，供新建和更新共用。 */
export function providerTypeFields(
  body: Record<string, unknown>,
  type: ProviderType
): {
  searchUrlTemplate?: string | null;
  detailUrlTemplate?: string | null;
  audioUrlTemplate?: string | null;
  coverUrlTemplate?: string | null;
  fieldMap?: string | null;
  metadataCapable?: number;
} {
  if (type !== 'template') return {};
  const parsed = parseProviderTemplate(body);
  if (!parsed.searchUrlTemplate) {
    throw badRequest('BAD_TEMPLATE', '模板音源必须填写搜索地址模板');
  }
  return {
    searchUrlTemplate: parsed.searchUrlTemplate,
    detailUrlTemplate: parsed.detailUrlTemplate,
    audioUrlTemplate: parsed.audioUrlTemplate,
    coverUrlTemplate: parsed.coverUrlTemplate,
    fieldMap: parsed.fieldMap,
    metadataCapable: parsed.metadataCapable ? 1 : 0,
  };
}
