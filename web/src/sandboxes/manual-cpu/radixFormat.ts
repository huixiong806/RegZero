/**
 * 统一 CPU 舞台数值进制格式化纯函数（单一真源）：
 * 保证寄存器卡片、总线胶囊、ALU 输入输出引脚、访存地址/数值与写回胶囊始终保持同一进制视角，
 * 杜绝动画途中数值突然在十进制与十六进制之间跳变造成的割裂感。
 */

export type RegRadix = 'dec' | 'u32' | 'hex' | 'bin';

export const RADIX_LABEL: Record<RegRadix, string> = {
  dec: 'DEC',
  u32: 'U32',
  hex: 'HEX',
  bin: 'BIN',
};

/** 寄存器卡片格内展示值（HEX 显示完整 8 位 32-bit 十六进制，BIN 按 4 位分组双行展示）。 */
export function formatRegisterCardValue(val: number, radix: RegRadix, compact: boolean): string {
  const u32 = val >>> 0;
  if (radix === 'u32') return String(u32);
  if (radix === 'hex') {
    return `0x${u32.toString(16).toUpperCase().padStart(compact ? 4 : 8, '0')}`;
  }
  if (radix === 'bin') {
    const bits = u32.toString(2).padStart(32, '0');
    if (compact) return bits.slice(16).replace(/(.{4})/g, '$1 ').trim();
    const hi = bits.slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    const lo = bits.slice(16).replace(/(.{4})/g, '$1 ').trim();
    return `${hi}\n${lo}`;
  }
  return String(val);
}

/** 运动胶囊、ALU 引脚、访存状态与写回气泡用的紧凑数值格式（BIN 模式下用紧凑 HEX 保证胶囊不溢出）。 */
export function formatDatapathValue(val: number, radix: RegRadix): string {
  const u32 = val >>> 0;
  if (radix === 'u32') return String(u32);
  if (radix === 'hex' || radix === 'bin') {
    return `0x${u32.toString(16).toUpperCase()}`;
  }
  return String(val);
}

/** 将 32 位整数拆分为 4 个字节、每字节 2 组 4-bit（高字节在前），用于 BIN 竖排比特条按字节对齐着色。 */
export function splitBitsIntoBytes(val: number): [string, string][] {
  const bits = (val >>> 0).toString(2).padStart(32, '0');
  return [
    [bits.slice(0, 4), bits.slice(4, 8)],
    [bits.slice(8, 12), bits.slice(12, 16)],
    [bits.slice(16, 20), bits.slice(20, 24)],
    [bits.slice(24, 28), bits.slice(28, 32)],
  ];
}

/** 根据胶囊文本长度动态计算 SVG 椭圆胶囊宽度，防止长十六进制或负数被裁切。 */
export function calcPillWidth(text: string, minWidth = 38): number {
  return Math.max(minWidth, text.length * 6.8 + 14);
}
