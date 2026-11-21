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

/** 玩家在 `pcTrack` 模块中亲自决策并推进 PC 指针一步。 */
export function applyPcTrackStep(
  state: ManualCpuState,
  config: ManualCpuSandboxConfig,
  playerChoice?: 'taken' | 'not-taken',
): ManualCpuState {
  const program = config.pcTrack?.program;
  if (!program || state.halted) return state;

  const inst = program[state.pcIndex];
  if (!inst) return state;

  const findLabelIndex = (label: string): number =>
    program.findIndex((item) => item.label === label);

  if (inst.op === 'blt' || inst.op === 'bge' || inst.op === 'beq' || inst.op === 'bne') {
    const taken = evaluateBranchCondition(inst, state.regs);
    const chosenTaken = playerChoice === 'taken';
    if (playerChoice !== undefined && chosenTaken !== taken) {
      const aVal = i32(state.regs[inst.a ?? ''] ?? 0);
      const bVal = i32(state.regs[inst.b ?? ''] ?? 0);
      const sym =
        inst.op === 'blt' ? '<' : inst.op === 'bge' ? '>=' : inst.op === 'beq' ? '==' : '!=';
      return {
        ...state,
        feedback: {
          tone: 'warn',
          message: `再看一眼比较结果：${inst.a}(${aVal}) ${sym} ${inst.b}(${bVal}) 当前是「${taken ? '成立' : '不成立'}」的！`,
        },
      };
    }

    const nextPc = taken ? findLabelIndex(inst.target ?? '') : state.pcIndex + 1;
    const safePc = nextPc >= 0 ? nextPc : state.pcIndex + 1;
    const explanation = taken
      ? `条件成立 → PC 跳到 ${inst.target}:`
      : '条件不成立 → PC 顺序执行下一行';

    return {
      ...state,
      pcIndex: safePc,
      recordings: [...state.recordings, { asm: inst.asm, summary: explanation, explanation }],
      undoStack: pushUndo(state),
      lastWrittenReg: null,
      lastWrittenMem: null,
      feedback: { tone: 'info', message: explanation },
    };
  }

  if (inst.op === 'j') {
    const targetIdx = findLabelIndex(inst.target ?? '');
    const isBackward = targetIdx >= 0 && targetIdx <= state.pcIndex;
    const explanation = isBackward
      ? `无条件往回跳到 ${inst.target}:（形成循环！）`
      : `无条件跳到 ${inst.target}:（跳过中间分支）`;
    return {
      ...state,
      pcIndex: targetIdx >= 0 ? targetIdx : state.pcIndex + 1,
      recordings: [...state.recordings, { asm: inst.asm, summary: explanation, explanation }],
      undoStack: pushUndo(state),
      lastWrittenReg: null,
      lastWrittenMem: null,
      feedback: { tone: 'info', message: explanation },
    };
  }

  if (inst.op === 'halt') {
    const completed = isGoalMet(config, state.caseIndex, state.regs, state.memory, true);
    return {
      ...state,
      halted: true,
      recordings: [
        ...state.recordings,
        { asm: inst.asm, summary: '程序运行结束', explanation: '程序运行结束' },
      ],
      undoStack: pushUndo(state),
      lastWrittenReg: null,
      lastWrittenMem: null,
      completed,
      feedback: completed
        ? { tone: 'success', message: '流程走通！你已经亲手扮演 PC 完整跑出了目标结果。' }
        : { tone: 'warn', message: '程序已结束，但目标寄存器尚未达到期望值，可以重置再试。' },
    };
  }

  const nextRegs = { ...state.regs };
  const dst = inst.dst ?? '';
  let val = 0;
  if (inst.op === 'mv') {
    val = i32(state.regs[inst.src ?? ''] ?? 0);
  } else if (inst.op === 'add') {
    val = i32((state.regs[inst.a ?? ''] ?? 0) + (state.regs[inst.b ?? ''] ?? 0));
  } else if (inst.op === 'sub') {
    val = i32((state.regs[inst.a ?? ''] ?? 0) - (state.regs[inst.b ?? ''] ?? 0));
  } else if (inst.op === 'addi') {
    val = i32((state.regs[inst.src ?? ''] ?? 0) + (inst.imm ?? 0));
  }
  if (dst && dst !== 'zero') {
    nextRegs[dst] = val;
  }

  const summary = `存入 ${dst} ← ${val}`;
  return {
    ...state,
    regs: nextRegs,
    pcIndex: state.pcIndex + 1,
    recordings: [...state.recordings, { asm: inst.asm, summary, explanation: `${dst} ← ${val}` }],
    undoStack: pushUndo(state),
    lastWrittenReg: dst || null,
    lastWrittenMem: null,
    feedback: { tone: 'info', message: summary },
  };
}
