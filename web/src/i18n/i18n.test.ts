import { describe, expect, it } from 'vitest';
import { getLocale, t } from './index';

describe('i18n', () => {
  it('defaults to zh-CN and interpolates placeholders', () => {
    expect(getLocale()).toBe('zh-CN');
    expect(t('level.goalLabel')).toBe('本关目标');
    expect(t('level.nextLevel', { id: '1-2' })).toBe('下一关 1-2');
    expect(t('sandbox.history', { count: 3 })).toBe('操作记录 (3)');
  });
});
