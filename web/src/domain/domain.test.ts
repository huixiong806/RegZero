import { describe, expect, it } from 'vitest';
import { buildChapterSpine, nextRecommendedLevel } from './dag';
import {
  getReadonlyLineSet,
  joinHiddenSuffix,
  splitHiddenReadonlySuffix,
  touchesReadonlyLines,
} from './editorConstraints';
import { formatDiffSubject, formatRegValue, normalizeRegKey, toSigned32 } from './registers';
import type { LevelSummary } from '../engine/types';

function makeSummary(partial: Partial<LevelSummary> & { id: string }): LevelSummary {
  return {
    chapter: 1,
    order: 1,
    kind: 'lesson',
    title: partial.id,
    language: 'asm',
    mode: 'online',
    allowLocalFile: true,
    prerequisites: [],
    concepts: [],
    passed: false,
    unlocked: false,
    attempts: 0,
    ...partial,
  };
}

describe('domain/registers', () => {
  it('normalizes ABI aliases to canonical xN names', () => {
    expect(normalizeRegKey('t0')).toBe('x5');
    expect(normalizeRegKey('zero')).toBe('x0');
    expect(normalizeRegKey('sp')).toBe('x2');
    expect(normalizeRegKey('x7')).toBe('x7');
  });

  it('formats signed 32-bit integers in dec and hex', () => {
    expect(toSigned32(0xffffffff)).toBe(-1);
    expect(formatRegValue(0xffffffff, 'dec')).toBe('-1');
    expect(formatRegValue(0xffffffff, 'hex')).toBe('0xFFFFFFFF');
  });

  it('rewrites raw hardware register names in diff labels when showRegXName is false', () => {
    expect(formatDiffSubject('寄存器 x7', false)).toBe('寄存器 t2');
    expect(formatDiffSubject('寄存器 x5', false)).toBe('寄存器 t0');
    expect(formatDiffSubject('寄存器 x7', true)).toBe('寄存器 x7');
  });
});

describe('domain/dag', () => {
  it('attaches side challenge nodes beside their prerequisite main node', () => {
    const levels: LevelSummary[] = [
      makeSummary({ id: '1-4', order: 4, kind: 'practice', passed: true, unlocked: true }),
      makeSummary({
        id: '1-4S',
        order: 4.5,
        kind: 'challenge',
        prerequisites: ['1-4'],
        unlocked: true,
      }),
      makeSummary({
        id: '1-5',
        order: 5,
        kind: 'lesson',
        prerequisites: ['1-4'],
        unlocked: true,
      }),
    ];

    const spine = buildChapterSpine(levels);
    expect(spine).toHaveLength(2);
    expect(spine[0]!.main.id).toBe('1-4');
    expect(spine[0]!.sideChallenges.map((c) => c.id)).toEqual(['1-4S']);
    expect(spine[1]!.main.id).toBe('1-5');
    // 主线推荐优先于支线
    expect(nextRecommendedLevel(levels)?.id).toBe('1-5');
  });
});

describe('domain/editorConstraints', () => {
  it('protects readonlyPrefix and readonlySuffix lines while allowing middle edits', () => {
    const bounds = { readonlyPrefix: 1, readonlySuffix: 1 };
    expect(touchesReadonlyLines(3, 1, 1, bounds)).toBe(true);
    expect(touchesReadonlyLines(3, 3, 3, bounds)).toBe(true);
    expect(touchesReadonlyLines(3, 2, 2, bounds)).toBe(false);
    expect(getReadonlyLineSet(4, bounds)).toEqual(new Set([1, 4]));
  });

  it('splits and rejoins hidden ecall readonly suffix cleanly', () => {
    const full = '# 任务\n\necall';
    const split = splitHiddenReadonlySuffix(full, 1, true);
    expect(split.visibleCode).toBe('# 任务\n');
    expect(split.hiddenSuffix).toBe('ecall');
    expect(split.visibleReadonlySuffix).toBe(0);
    expect(joinHiddenSuffix('# 任务\nadd t2, t0, t1', split.hiddenSuffix)).toBe(
      '# 任务\nadd t2, t0, t1\necall',
    );
  });
});
