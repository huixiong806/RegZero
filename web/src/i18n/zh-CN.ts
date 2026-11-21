/**
 * 简体中文默认 UI 词典（多语言扩展基准）。
 *
 * 新增其他语言（如 `en-US.ts`）时只需导出满足 `MessageCatalog` 类型的同名键集合，
 * TypeScript 编译期会自动校验是否遗漏任何词条。
 */
export const zhCN = {
  'nav.skillTree': '关卡技能树',
  'nav.playground': '自由练习',
  'nav.wiki': '概念图鉴',
  'nav.freeExplore': '自由探索',
  'nav.freeExploreTitle': '开启后无需前置即可跳关，并展示全部图鉴与底层硬件信息',

  'level.goalLabel': '本关目标',
  'level.stepSandbox': '先动手试算',
  'level.stepCode': '写下指令并提交',
  'level.rules': '规则',
  'level.hints': '提示',
  'level.wiki': '图鉴',
  'level.nextLevel': '下一关 {id}',
  'level.backToTree': '返回技能树',
  'level.loading': '正在加载关卡 {id}…',
  'level.loadFailed': '无法加载关卡 {id}',
  'level.editorGuide': '结合左侧指令格式与上方本关目标，在编辑器中写下你的代码，然后点「运行并提交」。',
  'level.kind.lesson': '概念',
  'level.kind.practice': '巩固',
  'level.kind.challenge': '支线',

  'briefing.ariaLabel': '{id} 开场引导',
  'briefing.skip': '跳过',
  'briefing.prev': '上一页',
  'briefing.next': '下一页',
  'briefing.start': '开始本关',
  'briefing.replay': '重播引导',
  'briefing.slideAria': '第 {n} 页',

  'drawer.rulesTab': '规则说明',
  'drawer.hintsTab': '3 级提示',
  'drawer.beforePrefix': '初始：',
  'drawer.afterPrefix': '目标：',

  'sandbox.inputSlot': '输入',
  'sandbox.destSlot': '存入',
  'sandbox.constCard': '常量',
  'sandbox.execute': '执行',
  'sandbox.history': '操作记录 ({count})',
  'sandbox.goCode': '去写指令',
  'sandbox.syntaxTitle': '对应指令格式',

  'playground.availableOps': '可用指令',
  'playground.runAndSubmit': '运行并提交',
  'playground.submit': '提交验证',
  'playground.tryRun': '试运行',
  'playground.run': '运行',
  'playground.debug': '单步调试',
  'playground.runResult': '运行结果',
  'playground.regsTitle': '寄存器状态',
} as const;

export type MessageKey = keyof typeof zhCN;
export type MessageCatalog = Record<MessageKey, string>;
