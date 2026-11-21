import { describe, expect, it } from 'vitest';
import type { ManualCpuSandboxConfig } from '../../engine/types';
import {
  applyAluOperation,
  applyDirectCopy,
  collectUsedSyntaxPatterns,
  createManualCpuState,
  undoManualCpu,
} from './model';
import { buildStageSequence, getPcUpdateDelayMs, totalSequenceMs } from './datapathTimeline';
import { applyPcTrackStep, stepPcTrackWithPulse } from './pcTrackModel';
import { executedOpToPulse, mapSimRegsToAbi } from './pulseModel';

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

  it('maps simulator xN regs to ABI names and converts ExecutedOpDto into visual pulse events', () => {
    const abiRegs = mapSimRegsToAbi({ x5: 3, x6: 5, x7: 0xffffffff });
    expect(abiRegs.t0).toBe(3);
    expect(abiRegs.t1).toBe(5);
    expect(abiRegs.t2).toBe(-1);

    const pulse = executedOpToPulse(
      {
        kind: 'alu',
        op: 'addi',
        symbol: '+',
        line: 2,
        nextLine: 3,
        rs1: 't0',
        rs1Val: 5,
        imm: 7,
        rd: 't1',
        rdOldVal: 0,
        rdNewVal: 12,
      },
      1,
    );
    expect(pulse.leftSource).toEqual({ kind: 'reg', name: 't0', value: 5 });
    expect(pulse.rightSource).toEqual({ kind: 'const', label: '7', value: 7 });
    expect(pulse.destReg).toBe('t1');
    expect(pulse.oldDestVal).toBe(0);
    expect(pulse.newDestVal).toBe(12);

    const frames = buildStageSequence(pulse, true);
    expect(frames.map((f) => f.stage)).toEqual([
      'fetch',
      'decode',
      'execute',
      'writeback',
    ]);
    expect(totalSequenceMs(frames, 4)).toBeLessThan(totalSequenceMs(frames, 1));
    expect(totalSequenceMs(frames, 16)).toBeLessThan(totalSequenceMs(frames, 4));

    // 条件跳转成立时应包含 writeback 阶段写回 PC，且 PC 翻转时机早于整条指令结束
    const takenBranch = executedOpToPulse(
      {
        kind: 'branch',
        op: 'blt',
        symbol: '<',
        line: 2,
        nextLine: 6,
        rs1: 't0',
        rs1Val: 4,
        rs2: 't1',
        rs2Val: 9,
        branchTaken: true,
      },
      2,
    );
    const branchFrames = buildStageSequence(takenBranch, true);
    expect(branchFrames.map((f) => f.stage)).toEqual(['fetch', 'decode', 'execute', 'writeback']);
    expect(getPcUpdateDelayMs(takenBranch, true, 1)).toBeLessThan(totalSequenceMs(branchFrames, 1));
  });

  it('runs bug-fix pcTrack slot puzzle: falls through when nop, passes when fixed to j done, and emits pulses', () => {
    const cfg: ManualCpuSandboxConfig = {
      type: 'manual-cpu',
      modules: ['regs', 'pcTrack'],
      focusRegs: ['t0', 't1', 't2'],
      pcTrack: {
        failHint: '被穿透覆盖了',
        successHint: '修好了',
        program: [
          { op: 'blt', a: 't0', b: 't1', target: 'add_one', asm: 'blt t0, t1, add_one' },
          { op: 'addi', dst: 't2', src: 't0', imm: -2, asm: 'addi t2, t0, -2' },
          {
            op: 'nop',
            asm: '(空位)',
            slotOptions: [
              { label: '空位', op: 'nop', asm: '(空位)' },
              { label: 'j done', op: 'j', target: 'done', asm: 'j done' },
            ],
          },
          { label: 'add_one', op: 'addi', dst: 't2', src: 't0', imm: 1, asm: 'addi t2, t0, 1' },
          { label: 'done', op: 'halt', asm: '(结束)' },
        ],
      },
      warmupPuzzle: {
        prompt: 'fix bug',
        initial: { regs: { t0: 12, t1: 10, t2: 0 } },
        goal: { regs: { t2: 10 } },
      },
    };

    // 未修补（槽位 2 = 0 即 nop）：t2 先算成 10 再被 add_one 覆盖成 13 → 失败提示
    let s = createManualCpuState(cfg);
    let step = stepPcTrackWithPulse(s, cfg, { 2: 0 }, 1);
    expect(step.pulse?.kind).toBe('branch');
    expect(step.pulse?.branchTaken).toBe(false);
    s = step.state;
    step = stepPcTrackWithPulse(s, cfg, { 2: 0 }, 2);
    expect(step.pulse?.kind).toBe('alu');
    expect(step.state.regs.t2).toBe(10);
    s = step.state;
    step = stepPcTrackWithPulse(s, cfg, { 2: 0 }, 3); // nop fall-through
    expect(step.pulse).toBeNull();
    s = step.state;
    step = stepPcTrackWithPulse(s, cfg, { 2: 0 }, 4); // add_one overwrites 10 -> 13!
    expect(step.state.regs.t2).toBe(13);
    s = step.state;
    step = stepPcTrackWithPulse(s, cfg, { 2: 0 }, 5); // halt
    expect(step.state.halted).toBe(true);
    expect(step.state.completed).toBe(false);
    expect(step.state.feedback?.message).toBe('被穿透覆盖了');

    // 修补为 j done（槽位 2 = 1）：跳过 add_one，成功保住 t2 = 10
    s = createManualCpuState(cfg);
    s = stepPcTrackWithPulse(s, cfg, { 2: 1 }, 1).state;
    s = stepPcTrackWithPulse(s, cfg, { 2: 1 }, 2).state;
    step = stepPcTrackWithPulse(s, cfg, { 2: 1 }, 3);
    expect(step.pulse?.kind).toBe('jump');
    expect(step.state.pcIndex).toBe(4); // skipped add_one directly to done
    s = stepPcTrackWithPulse(step.state, cfg, { 2: 1 }, 4).state;
    expect(s.halted).toBe(true);
    expect(s.completed).toBe(true);
    expect(s.regs.t2).toBe(10);
  });
});
