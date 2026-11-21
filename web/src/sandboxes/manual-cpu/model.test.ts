import { describe, expect, it } from 'vitest';
import type { ManualCpuSandboxConfig } from '../../engine/types';
import {
  applyAluOperation,
  applyDirectCopy,
  collectUsedSyntaxPatterns,
  createManualCpuState,
  undoManualCpu,
} from './model';
import { applyPcTrackStep } from './pcTrackModel';

describe('sandboxes/manual-cpu/model', () => {
  it('records add instruction and detects goal completion', () => {
    const cfg: ManualCpuSandboxConfig = {
      type: 'manual-cpu',
      modules: ['regs', 'alu'],
      recordToAsm: true,
      focusRegs: ['t0', 't1', 't2'],
      aluOps: ['+'],
      warmupPuzzle: {
        prompt: 'add t0 and t1 into t2',
        initial: { regs: { t0: 3, t1: 5, t2: 0 } },
        goal: { regs: { t2: 8 } },
      },
    };
    let s = createManualCpuState(cfg);
    s = applyAluOperation(s, cfg, { kind: 'reg', name: 't0' }, '+', { kind: 'reg', name: 't1' }, 't2');
    expect(s.regs.t2).toBe(8);
    expect(s.completed).toBe(true);
    expect(s.recordings[0]?.asm).toBe('add t2, t0, t1');
    expect(s.recordings[0]?.summary).toContain('存入 t2(8)');
    const patterns = collectUsedSyntaxPatterns(s.recordings);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.op).toBe('add');
    expect(patterns[0]?.slots[0]).toEqual({ label: '存入', role: 'dest' });
  });

  it('warns when overwriting unbacked value in swap puzzle and supports undo', () => {
    const cfg: ManualCpuSandboxConfig = {
      type: 'manual-cpu',
      modules: ['regs', 'alu'],
      recordToAsm: true,
      focusRegs: ['t0', 't1', 't2', 't3'],
      aluOps: ['-'],
      allowCopy: true,
      warmupPuzzle: {
        prompt: 'swap',
        initial: { regs: { t0: 10, t1: 3, t2: 0, t3: 0 } },
        goal: { regs: { t0: 3, t1: 10, t2: 7 } },
        guards: ['warnOverwriteLostValue'],
      },
    };
    let s = createManualCpuState(cfg);
    // 直接把 t1 写进 t0，没备份 t0(10) → 应触发警告
    s = applyDirectCopy(s, cfg, { kind: 'reg', name: 't1' }, 't0');
    expect(s.feedback?.tone).toBe('warn');
    expect(s.feedback?.message).toContain('覆盖');

    // 撤销后恢复 t0 = 10
    s = undoManualCpu(s);
    expect(s.regs.t0).toBe(10);
    expect(s.recordings).toHaveLength(0);
  });

  it('supports in-place 3-step swap without temp register (1-4S)', () => {
    const cfg: ManualCpuSandboxConfig = {
      type: 'manual-cpu',
      modules: ['regs', 'alu'],
      recordToAsm: true,
      focusRegs: ['t0', 't1'],
      aluOps: ['+', '-'],
      warmupPuzzle: {
        prompt: 'in-place swap',
        initial: { regs: { t0: 10, t1: 3 } },
        goal: { regs: { t0: 3, t1: 10 } },
      },
    };
    let s = createManualCpuState(cfg);
    s = applyAluOperation(s, cfg, { kind: 'reg', name: 't0' }, '+', { kind: 'reg', name: 't1' }, 't0');
    s = applyAluOperation(s, cfg, { kind: 'reg', name: 't0' }, '-', { kind: 'reg', name: 't1' }, 't1');
    s = applyAluOperation(s, cfg, { kind: 'reg', name: 't0' }, '-', { kind: 'reg', name: 't1' }, 't0');
    expect(s.completed).toBe(true);
    expect(s.recordings.map((r) => r.asm)).toEqual([
      'add t0, t0, t1',
      'sub t1, t0, t1',
      'sub t0, t0, t1',
    ]);
  });

  it('guides pcTrack branch decisions and backward loop jumps', () => {
    const cfg: ManualCpuSandboxConfig = {
      type: 'manual-cpu',
      modules: ['regs', 'pcTrack'],
      focusRegs: ['t0', 't1', 't2'],
      pcTrack: {
        program: [
          { op: 'blt', a: 't0', b: 't1', target: 'use_t1', asm: 'blt t0, t1, use_t1' },
          { op: 'mv', dst: 't2', src: 't0', asm: 'mv t2, t0' },
          { op: 'j', target: 'done', asm: 'j done' },
          { label: 'use_t1', op: 'mv', dst: 't2', src: 't1', asm: 'mv t2, t1' },
          { label: 'done', op: 'halt', asm: 'ecall' },
        ],
      },
      warmupPuzzle: {
        prompt: 'max',
        initial: { regs: { t0: 4, t1: 9, t2: 0 } },
        goal: { regs: { t2: 9 } },
      },
    };

    let s = createManualCpuState(cfg);
    // 选错分支（4 < 9 成立却点不成立）应拒绝推进并给提示
    const wrong = applyPcTrackStep(s, cfg, 'not-taken');
    expect(wrong.pcIndex).toBe(0);
    expect(wrong.feedback?.tone).toBe('warn');

    // 选对跳转 → 跳过 mv t2, t0 与 j done 直达 use_t1
    s = applyPcTrackStep(s, cfg, 'taken');
    expect(s.pcIndex).toBe(3);
    s = applyPcTrackStep(s, cfg);
    expect(s.regs.t2).toBe(9);
    s = applyPcTrackStep(s, cfg);
    expect(s.halted).toBe(true);
    expect(s.completed).toBe(true);
  });
});
