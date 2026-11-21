import { describe, expect, it } from 'vitest';
import type { LevelSummary, UserProgress, WikiEntry } from '../engine/types';
import {
  buildKnowledgeState,
  filterWikiEntries,
  getLevelNewConcepts,
} from './knowledge';

function makeLevel(
  id: string,
  concepts: string[],
  opts: { passed?: boolean; unlocked?: boolean; prerequisites?: string[] } = {},
): LevelSummary {
  return {
    id,
    chapter: 1,
    order: 1,
    kind: 'lesson',
    title: id,
    language: 'asm',
    mode: 'online',
    allowLocalFile: true,
    prerequisites: opts.prerequisites ?? [],
    concepts,
    passed: opts.passed ?? false,
    unlocked: opts.unlocked ?? false,
    attempts: 0,
  };
}

function makeProgress(freeExplore = false): UserProgress {
  return {
    version: 1,
    lastModified: '2026-11-21T00:00:00Z',
    levels: {},
    settings: { showHints: true, freeExplore },
  };
}

const SAMPLE_WIKI: WikiEntry[] = [
  {
    topic: 'rv32-registers',
    title: '寄存器速查',
    order: 1,
    unlockAny: ['register'],
    sections: [
      {
        id: 'reg-table',
        kind: 'table',
        unlockAny: ['register'],
        columns: [
          { id: 'abi', label: '名称', unlockAny: [] },
          { id: 'xName', label: '硬件编号', unlockAny: ['reg-hardware-id'] },
          { id: 'role', label: '用途', unlockAny: [] },
        ],
        rows: [
          { id: 't0-t2', unlockAny: ['register'], cells: { abi: 't0-t2', xName: 'x5-x7', role: '临时' } },
          { id: 'zero', unlockAny: ['zero'], cells: { abi: 'zero', xName: 'x0', role: '恒为 0' } },
          { id: 'sp', unlockAny: ['stack'], cells: { abi: 'sp', xName: 'x2', role: '栈指针' } },
        ],
      },
    ],
  },
  {
    topic: 'rv32-branch',
    title: '分支与循环',
    order: 2,
    unlockAny: ['pc', 'blt'],
    sections: [
      {
        id: 'intro',
        kind: 'markdown',
        unlockAny: ['blt'],
        markdown: 'blt 介绍',
      },
    ],
  },
];

describe('domain/knowledge', () => {
  it('hides unlearned wiki topics, table rows, xName column, and sp/x5 UI on level 1-1', () => {
    const levels = [
      makeLevel('1-1', ['register', 'add'], { unlocked: true }),
      makeLevel('1-2', ['immediate', 'addi', 'zero'], { prerequisites: ['1-1'] }),
      makeLevel('1-6', ['pc', 'blt'], { prerequisites: ['1-2'] }),
    ];

    const knowledge = buildKnowledgeState(levels, makeProgress(false), '1-1');
    expect(knowledge.ui.showRegXName).toBe(false);
    expect(knowledge.ui.showAllRegsToggle).toBe(false);
    expect(knowledge.ui.showHexToggle).toBe(false);
    expect(knowledge.ui.showUntrackedNonZeroRegs).toBe(false);
    expect(knowledge.ui.showEcallSuffix).toBe(false);
    expect(knowledge.ui.showDebugControls).toBe(false);
    expect(knowledge.ui.showMemoryPanel).toBe(false);

    const visible = filterWikiEntries(SAMPLE_WIKI, knowledge);
    // 1-6 的分支词条应完全隐藏
    expect(visible.map((e) => e.topic)).toEqual(['rv32-registers']);

    const table = visible[0]!.sections[0]!;
    expect(table.kind).toBe('table');
    if (table.kind === 'table') {
      // 未学 reg-hardware-id 时隐藏硬件编号列
      expect(table.columns.map((c) => c.id)).toEqual(['abi', 'role']);
      // 1-1 只看得到 t0-t2，看不到 zero 和 sp
      expect(table.rows.map((r) => r.id)).toEqual(['t0-t2']);
    }
  });

  it('grows wiki rows progressively when 1-2 unlocks and marks new concepts', () => {
    const levels = [
      makeLevel('1-1', ['register', 'add'], { passed: true, unlocked: true }),
      makeLevel('1-2', ['immediate', 'addi', 'zero'], { unlocked: true, prerequisites: ['1-1'] }),
    ];

    const knowledge = buildKnowledgeState(levels, makeProgress(false), '1-2');
    const newConcepts = getLevelNewConcepts(levels, '1-2');
    expect(newConcepts.has('zero')).toBe(true);
    expect(newConcepts.has('register')).toBe(false);

    const visible = filterWikiEntries(SAMPLE_WIKI, knowledge, newConcepts);
    const table = visible[0]!.sections[0]!;
    if (table.kind === 'table') {
      expect(table.rows.map((r) => r.id)).toEqual(['t0-t2', 'zero']);
      expect(table.rows[0]!.isNew).toBe(false);
      expect(table.rows[1]!.isNew).toBe(true);
    }
  });

  it('reveals full wiki and hardware UI details when freeExplore is enabled', () => {
    const levels = [makeLevel('1-1', ['register', 'add'], { unlocked: true })];
    const knowledge = buildKnowledgeState(levels, makeProgress(true));

    expect(knowledge.ui.showRegXName).toBe(true);
    expect(knowledge.ui.showAllRegsToggle).toBe(true);
    expect(knowledge.ui.showHexToggle).toBe(true);
    expect(knowledge.ui.showUntrackedNonZeroRegs).toBe(true);

    const visible = filterWikiEntries(SAMPLE_WIKI, knowledge);
    expect(visible.map((e) => e.topic)).toEqual(['rv32-registers', 'rv32-branch']);
    const table = visible[0]!.sections[0]!;
    if (table.kind === 'table') {
      expect(table.columns.map((c) => c.id)).toEqual(['abi', 'xName', 'role']);
      expect(table.rows.map((r) => r.id)).toEqual(['t0-t2', 'zero', 'sp']);
    }
  });
});
