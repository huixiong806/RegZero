/**
 * 轻量多语言模块（零外部重型依赖，编译期校验全部词典键完整性）。
 *
 * 当前默认启用 `zh-CN`；后续新增语言只需：
 * 1. 新建 `en-US.ts` 并实现 `MessageCatalog`；
 * 2. 在 `CATALOGS` 中注册；
 * 3. 在设置里调用 `setLocale('en-US')`。
 */

import { zhCN, type MessageCatalog, type MessageKey } from './zh-CN';

export type Locale = 'zh-CN';

const CATALOGS: Record<Locale, MessageCatalog> = {
  'zh-CN': zhCN,
};

let activeLocale: Locale = 'zh-CN';

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

/** 查询词条并替换 `{key}` 占位参数；缺失时自动回退至默认中文词典。 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: Locale = activeLocale,
): string {
  const catalog = CATALOGS[locale] ?? zhCN;
  let template = catalog[key] ?? zhCN[key];
  if (!params) return template;
  for (const [k, v] of Object.entries(params)) {
    template = template.replaceAll(`{${k}}`, String(v));
  }
  return template;
}

export type { MessageCatalog, MessageKey };
