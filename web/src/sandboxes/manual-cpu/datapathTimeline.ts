/**
 * 单周期 5 阶段 CPU 数据通路时间轴状态机（纯函数，零 React 依赖）。
 *
 * 将任意一条 `CpuPulseEvent` 拆解为按序推进的微阶段序列：
 * `fetch (取指) → decode (译码) → execute (执行) → [memory (仅访存指令)] → writeback (写回)`。
 */

import type { CpuPulseEvent } from './pulseModel';

export type DatapathStage = 'idle' | 'fetch' | 'decode' | 'execute' | 'memory' | 'writeback';
export type ActiveDatapathStage = Exclude<DatapathStage, 'idle'>;

/** 播放倍速档位：1x（慢速教学基准）/ 4x（流畅浏览过渡档）/ 16x（循环极速快进档）。 */
export const PLAYBACK_SPEEDS = [1, 4, 16] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** 1x 慢速教学基准下的各阶段毫秒时长（单一真源，供时间轴与 CSS/SVG 动画共享）。 */
export const STAGE_BASE_MS: Record<ActiveDatapathStage, number> = {
  fetch: 650,
  decode: 1200,
  execute: 1800,
  memory: 1200,
  writeback: 1500,
};

export interface StageFrame {
  stage: ActiveDatapathStage;
  /** 本阶段是否为旁路直通。 */
  bypass: boolean;
  /** 1x 速度下的基准毫秒时长。 */
  baseMs: number;
}

export const ALL_DATAPATH_STAGES: readonly { id: ActiveDatapathStage; label: string }[] = [
  { id: 'fetch', label: '取指' },
  { id: 'decode', label: '译码' },
  { id: 'execute', label: '执行' },
  { id: 'memory', label: '访存' },
  { id: 'writeback', label: '写回' },
];

/** 根据指令类型生成精确的执行阶段序列（当关卡显示访存模块时，非访存运算指令走短旁路直通，确保视觉数据流无断层）。 */
export function buildStageSequence(
  pulse: CpuPulseEvent,
  includeFetch: boolean,
  includeMemoryBypass = false,
): StageFrame[] {
  const frames: StageFrame[] = [];
  if (includeFetch) {
    frames.push({ stage: 'fetch', bypass: false, baseMs: STAGE_BASE_MS.fetch });
  }

  switch (pulse.kind) {
    case 'alu':
    case 'copy':
      frames.push({ stage: 'decode', bypass: false, baseMs: STAGE_BASE_MS.decode });
      frames.push({ stage: 'execute', bypass: false, baseMs: STAGE_BASE_MS.execute });
      if (includeMemoryBypass && pulse.destReg) {
        frames.push({
          stage: 'memory',
          bypass: true,
          baseMs: Math.round(STAGE_BASE_MS.memory * 0.45),
        });
      }
      if (pulse.destReg) {
        frames.push({ stage: 'writeback', bypass: false, baseMs: STAGE_BASE_MS.writeback });
      }
      break;
    case 'branch':
      frames.push({ stage: 'decode', bypass: false, baseMs: STAGE_BASE_MS.decode });
      frames.push({ stage: 'execute', bypass: false, baseMs: Math.round(STAGE_BASE_MS.execute * 0.85) });
      // 条件成立时进入 writeback 阶段：沿右侧轨道把新 PC 写回顶部指令盒（对称于左侧寄存器写回）
      if (pulse.branchTaken) {
        frames.push({ stage: 'writeback', bypass: false, baseMs: Math.round(STAGE_BASE_MS.writeback * 0.9) });
      }
      break;
    case 'jump':
      frames.push({ stage: 'execute', bypass: false, baseMs: Math.round(STAGE_BASE_MS.execute * 0.55) });
      frames.push({ stage: 'writeback', bypass: false, baseMs: Math.round(STAGE_BASE_MS.writeback * 0.9) });
      break;
    case 'load':
      frames.push({ stage: 'decode', bypass: false, baseMs: STAGE_BASE_MS.decode });
      // 与 execute 单一真源保持同长，确保 ALU 地址计算胶囊完整滑抵访存模块顶口
      frames.push({ stage: 'execute', bypass: false, baseMs: STAGE_BASE_MS.execute });
      frames.push({ stage: 'memory', bypass: false, baseMs: STAGE_BASE_MS.memory });
      frames.push({ stage: 'writeback', bypass: false, baseMs: STAGE_BASE_MS.writeback });
      break;
    case 'store':
      frames.push({ stage: 'decode', bypass: false, baseMs: STAGE_BASE_MS.decode });
      frames.push({ stage: 'execute', bypass: false, baseMs: STAGE_BASE_MS.execute });
      frames.push({ stage: 'memory', bypass: false, baseMs: STAGE_BASE_MS.memory });
      break;
    default:
      frames.push({ stage: 'execute', bypass: false, baseMs: Math.round(STAGE_BASE_MS.execute * 0.6) });
      break;
  }

  return frames;
}

/** 计算单个阶段在指定倍速下的持续毫秒数（下限 40ms，保证 16x 极速档顺滑不卡顿）。 */
export function getStageDurationMs(frame: StageFrame, speed: PlaybackSpeed): number {
  return Math.max(40, Math.round(frame.baseMs / speed));
}

/** 计算指定阶段在当前倍速下的动画秒数（支持按比例切分，如前半段入芯片 / 后半段出结果）。 */
export function getStageSeconds(
  stage: ActiveDatapathStage,
  speed: PlaybackSpeed,
  ratio = 1,
): number {
  const ms = Math.max(40, Math.round(STAGE_BASE_MS[stage] / speed));
  return (ms * ratio) / 1000;
}

/** 计算整条指令完整走完所有阶段所需的总毫秒数。 */
export function totalSequenceMs(frames: readonly StageFrame[], speed: PlaybackSpeed): number {
  let total = 0;
  for (const f of frames) total += getStageDurationMs(f, speed);
  return total;
}

/**
 * 计算本周期中 PC 视觉翻转的精确毫秒时刻：
 * - 发生跳转（branchTaken / jump）时，在写回胶囊爬升 58% 抵达顶部 PC 瞬间翻转；
 * - 顺序执行时，在整条指令动画收尾时切至下一行。
 */
export function getPcUpdateDelayMs(
  pulse: CpuPulseEvent,
  includeFetch: boolean,
  speed: PlaybackSpeed,
  includeMemoryBypass = false,
): number {
  const frames = buildStageSequence(pulse, includeFetch, includeMemoryBypass);
  const isTakenFlow =
    (pulse.kind === 'branch' || pulse.kind === 'jump') && Boolean(pulse.branchTaken);
  if (!isTakenFlow) {
    return totalSequenceMs(frames, speed);
  }
  let elapsed = 0;
  for (const f of frames) {
    const dur = getStageDurationMs(f, speed);
    if (f.stage === 'writeback') {
      return elapsed + Math.round(dur * 0.58);
    }
    elapsed += dur;
  }
  return elapsed;
}

/** 返回某个阶段在 5 阶段中的先后顺序（用于高亮「已经过」的数据通路）。 */
export function stageOrder(stage: DatapathStage): number {
  switch (stage) {
    case 'idle':
      return 0;
    case 'fetch':
      return 1;
    case 'decode':
      return 2;
    case 'execute':
      return 3;
    case 'memory':
      return 4;
    case 'writeback':
      return 5;
  }
}
