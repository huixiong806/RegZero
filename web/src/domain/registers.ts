/**
 * RV32IM 32 个通用寄存器的规范映射与格式化工具（纯函数，无 UI 依赖）。
 */

export interface RegisterInfo {
  index: number;
  xName: string;
  abi: string;
  group: 'special' | 'temp' | 'arg' | 'saved';
}

export const RV32_REGISTERS: readonly RegisterInfo[] = [
  { index: 0, xName: 'x0', abi: 'zero', group: 'special' },
  { index: 1, xName: 'x1', abi: 'ra', group: 'special' },
  { index: 2, xName: 'x2', abi: 'sp', group: 'special' },
  { index: 3, xName: 'x3', abi: 'gp', group: 'special' },
  { index: 4, xName: 'x4', abi: 'tp', group: 'special' },
  { index: 5, xName: 'x5', abi: 't0', group: 'temp' },
  { index: 6, xName: 'x6', abi: 't1', group: 'temp' },
  { index: 7, xName: 'x7', abi: 't2', group: 'temp' },
  { index: 8, xName: 'x8', abi: 's0', group: 'saved' },
  { index: 9, xName: 'x9', abi: 's1', group: 'saved' },
  { index: 10, xName: 'x10', abi: 'a0', group: 'arg' },
  { index: 11, xName: 'x11', abi: 'a1', group: 'arg' },
  { index: 12, xName: 'x12', abi: 'a2', group: 'arg' },
  { index: 13, xName: 'x13', abi: 'a3', group: 'arg' },
  { index: 14, xName: 'x14', abi: 'a4', group: 'arg' },
  { index: 15, xName: 'x15', abi: 'a5', group: 'arg' },
  { index: 16, xName: 'x16', abi: 'a6', group: 'arg' },
  { index: 17, xName: 'x17', abi: 'a7', group: 'arg' },
  { index: 18, xName: 'x18', abi: 's2', group: 'saved' },
  { index: 19, xName: 'x19', abi: 's3', group: 'saved' },
  { index: 20, xName: 'x20', abi: 's4', group: 'saved' },
  { index: 21, xName: 'x21', abi: 's5', group: 'saved' },
  { index: 22, xName: 'x22', abi: 's6', group: 'saved' },
  { index: 23, xName: 'x23', abi: 's7', group: 'saved' },
  { index: 24, xName: 'x24', abi: 's8', group: 'saved' },
  { index: 25, xName: 'x25', abi: 's9', group: 'saved' },
  { index: 26, xName: 'x26', abi: 's10', group: 'saved' },
  { index: 27, xName: 'x27', abi: 's11', group: 'saved' },
  { index: 28, xName: 'x28', abi: 't3', group: 'temp' },
  { index: 29, xName: 'x29', abi: 't4', group: 'temp' },
  { index: 30, xName: 'x30', abi: 't5', group: 'temp' },
  { index: 31, xName: 'x31', abi: 't6', group: 'temp' },
];

const BY_KEY = new Map<string, RegisterInfo>();
for (const reg of RV32_REGISTERS) {
  BY_KEY.set(reg.xName, reg);
  BY_KEY.set(reg.abi, reg);
}
BY_KEY.set('fp', RV32_REGISTERS[8]!);

/** 将任意别名（如 `t0` / `x5` / `zero`）归一为标准 `xN` 键。 */
export function normalizeRegKey(name: string): string {
  const info = BY_KEY.get(name.trim().toLowerCase());
  return info ? info.xName : name;
}

/** 查寄存器元信息（支持 `t0` 与 `x5`）。 */
export function getRegisterInfo(name: string): RegisterInfo | undefined {
  return BY_KEY.get(name.trim().toLowerCase());
}

/** 将无符号 32 位值转为有符号 32 位整数。 */
export function toSigned32(val: number): number {
  return val | 0;
}

/** 将 32 位整数格式化为 `0x00000000`。 */
export function formatHex32(val: number): string {
  return `0x${(val >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/** 按选定进制格式化寄存器值。 */
export function formatRegValue(val: number, radix: 'dec' | 'hex'): string {
  return radix === 'hex' ? formatHex32(val) : String(toSigned32(val));
}

/**
 * 将判题 Diff 中的硬件寄存器编号（如 `寄存器 x7`）按渐进披露开关转为对新手友好的 ABI 名称（如 `寄存器 t2`）。
 */
export function formatDiffSubject(what: string, showRegXName: boolean): string {
  if (showRegXName) return what;
  return what.replace(/\bx(3[01]|[12]?[0-9])\b/g, (match) => {
    const info = BY_KEY.get(match);
    return info ? info.abi : match;
  });
}
