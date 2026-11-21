import type {
  ManualCpuSandboxConfig,
  PcTrackInstruction,
} from '../../engine/types';
import {
  i32,
  isGoalMet,
  pushUndo,
  type ManualCpuState,
} from './model';
import type { CpuPulseEvent } from './pulseModel';

const MAX_PC_TRACK_STEPS = 20;

/** 根据玩家对某个「修 Bug 槽位」的当前选择，解析出实际执行的指令。 */
export function resolvePcTrackInstruction(
  inst: PcTrackInstruction,
  choiceIndex?: number,
): PcTrackInstruction {
  const opts = inst.slotOptions;
  if (!opts || opts.length === 0) return inst;
  const opt = opts[choiceIndex ?? 0] ?? opts[0]!;
  return {
    ...inst,
    op: opt.op,
    a: opt.a ?? inst.a,
    b: opt.b ?? inst.b,
    target: opt.target,
    asm: opt.asm,
  };
}

/** 评估一条 `pcTrack` 条件分支指令的条件真假。 */
export function evaluateBranchCondition(
  inst: PcTrackInstruction,
  regs: Record<string, number>,
): boolean {
  const a = i32(regs[inst.a ?? ''] ?? 0);
  const b = i32(regs[inst.b ?? ''] ?? 0);
  switch (inst.op) {
    case 'blt':
      return a < b;
    case 'bge':
      return a >= b;
    case 'beq':
      return a === b;
    case 'bne':
      return a !== b;
    default:
      return false;
  }
}

export interface PcTrackStepOutcome {
  state: ManualCpuState;
  pulse: CpuPulseEvent | null;
}

/**
 * 推进 `pcTrack` 示范/修 Bug 轨道一步，并同步生成可驱动统一 CPU 舞台的 `CpuPulseEvent`。
 * 保持纯函数设计，零 React 依赖，便于单元测试。
 */
export function stepPcTrackWithPulse(
  state: ManualCpuState,
  config: ManualCpuSandboxConfig,
  slotChoices: Record<number, number> = {},
  pulseNonce = 1,
  playerChoice?: 'taken' | 'not-taken',
): PcTrackStepOutcome {
  const program = config.pcTrack?.program;
  if (!program || state.halted) return { state, pulse: null };

  if (state.recordings.length >= MAX_PC_TRACK_STEPS) {
    return {
      state: {
        ...state,
        halted: true,
        completed: false,
        feedback: {
          tone: 'warn',
          message: '陷入死循环了！PC 一直在绕圈停不下来，换一个跳转目标试试。',
        },
      },
      pulse: null,
    };
  }

  const rawInst = program[state.pcIndex];
  if (!rawInst) return { state, pulse: null };
  const inst = resolvePcTrackInstruction(rawInst, slotChoices[state.pcIndex]);

  const findLabelIndex = (label: string): number =>
    program.findIndex((item) => item.label === label);

  if (inst.op === 'nop') {
    const explanation = '空位没有跳转，PC 顺着滑向下一行！';
    return {
      state: {
        ...state,
        pcIndex: state.pcIndex + 1,
        recordings: [...state.recordings, { asm: inst.asm, summary: explanation, explanation }],
        undoStack: pushUndo(state),
        lastWrittenReg: null,
        lastWrittenMem: null,
        feedback: { tone: 'info', message: explanation },
      },
      pulse: null,
    };
  }

  if (inst.op === 'blt' || inst.op === 'bge' || inst.op === 'beq' || inst.op === 'bne') {
    const taken = evaluateBranchCondition(inst, state.regs);
    const sym =
      inst.op === 'blt' ? '<' : inst.op === 'bge' ? '≥' : inst.op === 'beq' ? '=' : '≠';
    const aName = inst.a ?? 't0';
    const bName = inst.b ?? 't1';
    const aVal = i32(state.regs[aName] ?? 0);
    const bVal = i32(state.regs[bName] ?? 0);

    if (playerChoice !== undefined && (playerChoice === 'taken') !== taken) {
      return {
        state: {
          ...state,
          feedback: {
            tone: 'warn',
            message: `再看一眼比较结果：${aName}(${aVal}) ${sym} ${bName}(${bVal}) 当前是「${taken ? '成立' : '不成立'}」的！`,
          },
        },
        pulse: null,
      };
    }

    const nextPc = taken ? findLabelIndex(inst.target ?? '') : state.pcIndex + 1;
    const safePc = nextPc >= 0 ? nextPc : state.pcIndex + 1;
    const explanation = taken
      ? `${aName}(${aVal}) ${sym} ${bName}(${bVal}) 成立 → 跳到 ${inst.target}:`
      : `${aName}(${aVal}) ${sym} ${bName}(${bVal}) 不成立 → 顺序下一行`;

    const pulse: CpuPulseEvent = {
      nonce: pulseNonce,
      kind: 'branch',
      op: inst.op,
      symbol: sym,
      asmText: inst.asm,
      line: state.pcIndex + 1,
      nextLine: safePc + 1,
      leftSource: { kind: 'reg', name: aName, value: aVal },
      rightSource: { kind: 'reg', name: bName, value: bVal },
      branchTaken: taken,
    };

    return {
      state: {
        ...state,
        pcIndex: safePc,
        recordings: [...state.recordings, { asm: inst.asm, summary: explanation, explanation }],
        undoStack: pushUndo(state),
        lastWrittenReg: null,
        lastWrittenMem: null,
        feedback: { tone: 'info', message: explanation },
      },
      pulse,
    };
  }

  if (inst.op === 'j') {
    const targetIdx = findLabelIndex(inst.target ?? '');
    const safePc = targetIdx >= 0 ? targetIdx : state.pcIndex + 1;
    const isBackward = targetIdx >= 0 && targetIdx <= state.pcIndex;
    const explanation = isBackward
      ? `往回跳到 ${inst.target}:（形成循环！）`
      : `无条件跳到 ${inst.target}:（跳过中间代码）`;

    const pulse: CpuPulseEvent = {
      nonce: pulseNonce,
      kind: 'jump',
      op: 'j',
      symbol: '跳转',
      asmText: inst.asm,
      line: state.pcIndex + 1,
      nextLine: safePc + 1,
      branchTaken: true,
    };

    return {
      state: {
        ...state,
        pcIndex: safePc,
        recordings: [...state.recordings, { asm: inst.asm, summary: explanation, explanation }],
        undoStack: pushUndo(state),
        lastWrittenReg: null,
        lastWrittenMem: null,
        feedback: { tone: 'info', message: explanation },
      },
      pulse,
    };
  }

  if (inst.op === 'halt') {
    const completed = isGoalMet(config, state.caseIndex, state.regs, state.memory, true);
    return {
      state: {
        ...state,
        halted: true,
        recordings: [
          ...state.recordings,
          { asm: inst.asm, summary: '运行结束', explanation: '运行结束' },
        ],
        undoStack: pushUndo(state),
        lastWrittenReg: null,
        lastWrittenMem: null,
        completed,
        feedback: completed
          ? {
              tone: 'success',
              message:
                config.pcTrack?.successHint ??
                '修好了！程序已按预期跑出目标结果。',
            }
          : {
              tone: 'warn',
              message:
                config.pcTrack?.failHint ??
                '运行结束，但结果不符合预期——点开空位换一条跳转指令再试！',
            },
      },
      pulse: null,
    };
  }

  const nextRegs = { ...state.regs };
  const dst = inst.dst ?? '';
  const oldVal = i32(state.regs[dst] ?? 0);
  let val = 0;
  let pulse: CpuPulseEvent | null = null;

  if (inst.op === 'mv') {
    const srcName = inst.src ?? 't0';
    const srcVal = i32(state.regs[srcName] ?? 0);
    val = srcVal;
    pulse = {
      nonce: pulseNonce,
      kind: 'alu',
      op: 'addi',
      symbol: '+',
      asmText: inst.asm,
      line: state.pcIndex + 1,
      nextLine: state.pcIndex + 2,
      leftSource: { kind: 'reg', name: srcName, value: srcVal },
      rightSource: { kind: 'const', label: '0', value: 0 },
      destReg: dst,
      oldDestVal: oldVal,
      newDestVal: val,
    };
  } else if (inst.op === 'addi') {
    const srcName = inst.src ?? 't0';
    const srcVal = i32(state.regs[srcName] ?? 0);
    const imm = inst.imm ?? 0;
    val = i32(srcVal + imm);
    pulse = {
      nonce: pulseNonce,
      kind: 'alu',
      op: 'addi',
      symbol: '+',
      asmText: inst.asm,
      line: state.pcIndex + 1,
      nextLine: state.pcIndex + 2,
      leftSource: { kind: 'reg', name: srcName, value: srcVal },
      rightSource: { kind: 'const', label: String(imm), value: imm },
      destReg: dst,
      oldDestVal: oldVal,
      newDestVal: val,
    };
  } else if (inst.op === 'add' || inst.op === 'sub') {
    const aName = inst.a ?? 't0';
    const bName = inst.b ?? 't1';
    const aVal = i32(state.regs[aName] ?? 0);
    const bVal = i32(state.regs[bName] ?? 0);
    val = inst.op === 'add' ? i32(aVal + bVal) : i32(aVal - bVal);
    pulse = {
      nonce: pulseNonce,
      kind: 'alu',
      op: inst.op,
      symbol: inst.op === 'add' ? '+' : '-',
      asmText: inst.asm,
      line: state.pcIndex + 1,
      nextLine: state.pcIndex + 2,
      leftSource: { kind: 'reg', name: aName, value: aVal },
      rightSource: { kind: 'reg', name: bName, value: bVal },
      destReg: dst,
      oldDestVal: oldVal,
      newDestVal: val,
    };
  }

  if (dst && dst !== 'zero') {
    nextRegs[dst] = val;
  }

  const summary = `存入 ${dst} ← ${val}`;
  return {
    state: {
      ...state,
      regs: nextRegs,
      pcIndex: state.pcIndex + 1,
      recordings: [...state.recordings, { asm: inst.asm, summary, explanation: `${dst} ← ${val}` }],
      undoStack: pushUndo(state),
      lastWrittenReg: dst || null,
      lastWrittenMem: null,
      feedback: { tone: 'info', message: summary },
    },
    pulse,
  };
}

/** 兼容旧签名：仅返回推进后的状态。 */
export function applyPcTrackStep(
  state: ManualCpuState,
  config: ManualCpuSandboxConfig,
  playerChoice?: 'taken' | 'not-taken',
): ManualCpuState {
  return stepPcTrackWithPulse(state, config, {}, 1, playerChoice).state;
}
