# 词阶内部界面完善实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent UI areas. Root integrates and verifies the complete application.

**Goal:** 保留用户确认的米白、鼠尾草绿与珊瑚色风格，完善全部内部页面的控件、可读性、响应式布局及操作反馈。

**Architecture:** 继续使用现有 Next.js/React 页面与接口。页面专属样式按 AI、概览页面、学习窗口分文件；公共布局、按钮、焦点和弹窗由根任务统一。采用已有 Radix 组件处理选择菜单和弹窗的键盘、焦点及嵌套浮层，不改学习、额度、认证或 AI 计费逻辑。

**Tech Stack:** Next.js 16、React 19、TypeScript、Radix UI、普通 CSS、现有 Node/SQLite 测试。

## 设计范围

- 品牌、导航名称和主色延续；正文约 14px，辅助信息 12–13px，移动端表单 16px，主要点击区域至少 44px。用颜色与字重建立层次，减少极浅色小字。
- AI：替换截图中的系统下拉菜单，清晰展示服务、模型、可用状态和剩余额度；优化报告、空对话、话题入口、消息与输入框。切换选项不调用付费接口，保留无限额账号语义。
- 今日、词库、成长、设置：统一卡片间距、数字与文字层级、阶段状态和操作排列；手机上自动堆叠，长标题可换行；没有数据时给出准确说明。
- 背词、测验、每日词量：优化任务进度、单词内容、评分按钮、结果与跨天选择展示；保留所有加载、失败、重试和禁用保护。
- 公共界面：导航当前态清楚，键盘焦点可见，弹窗可关闭并恢复焦点，嵌套选择菜单不误关学习窗口，减少动态效果偏好受尊重。

## 实施任务

- [x] Root：完善 `app/components/wordsteps-app.tsx`、`ui.tsx`，添加 `app/internal-ui.css` 并在 `app/layout.tsx` 引入。保留组件 API；用 Radix Dialog 管理浮层，外部点击不取消学习。
- [x] AI：完善 `app/components/ai-learning.tsx`；添加 `ai-learning.css`；使用 Radix Select 的 Trigger、Portal、Content、Item 与键盘语义，模型名称在窄屏可截断/换行。
- [x] 概览：完善 `today.tsx`、`library.tsx`、`progress.tsx`、`settings.tsx`；添加 `page-polish.css`，改善原有内容的排列与文本，不修改服务端或状态规则。
- [x] 学习：完善 `study-session.tsx`、`exam-session.tsx`、`daily-quota.tsx`、`daily-quota.css`；添加 `session-polish.css`，在 390px 和桌面上检查按钮、长词、答案与结果。
- [x] Root：检查各任务的范围和代码质量，修复实际发现的问题。

## 验收与交付

- [x] `npm test` 91/91、`npm run typecheck` 通过；修改文件 ESLint 无新增诊断，现有业务回归全部保留。
- [x] `NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=/study npm run build` 成功；`npm run test:integration` 验证原业务流程。
- [x] 仅用本机原生 Node、临时 SQLite、虚构账号与本地 AI 响应夹具检查界面，不调用付费模型，不打开 Docker，不部署远程。
- [x] 浏览器检查桌面和 390px 手机的所有导航页、模型菜单、键盘/Escape、学习弹窗、输入/选中/禁用/错误状态；实际无页面横向溢出。
- [x] 保存关键页面截图并清理临时服务。交付目标：现有 `codex/docker-ai` 分支与既有 PR。


## 验收记录（2026-10-15）

- 基于远程 `f39eaaf` 完成 UI 修改，保留初始账号 `dailyLimit: null` 不限额语义；普通账号实际显示 0/30 次。未改服务端、调度、解锁、额度持久化或 AI 请求/重试/幂等逻辑。
- 正常今日页优先展示学习入口；跨天待选择时，额度确认仍排在学习入口前。每日额度组件保持挂载，状态与提交保护不变。
- 91 项自动测试、类型检查、Next.js 生产构建、现有原生 Node HTTP 验收通过。另用 standalone 产物（同 Docker 入口）在 127.0.0.1 实际打开应用。
- 11 个修改 TSX 的 ESLint 与 HEAD 基线一致：3 个 `react-hooks/set-state-in-effect` 错误（Study、Exam、WordstepsApp）和 2 个原有依赖警告；其余 8 个修改 TSX 无诊断。本次不调整既有加载逻辑或关闭 lint 规则。
- 1280px 桌面与 390px 手机逐页检查；320px 额外检查 AI 菜单与输入框，无页面横向溢出。检查词库筛选后的英日切换、成长明细 14 行表格、日语无记录状态、设置修改/保存反馈。
- 手机实际完成 11 张背词卡和 20 题测验，检查评分保存、结果回看、额度入口和首次 +10。临时跨天夹具分别验证保留 20 和重置 10，记录保留提示准确。
- AI 本地模拟响应验证报告生成、聊天错误与编辑重发；更换模型、切换 Tab 和刷新状态不产生模型请求。全部使用本地 mock，未使用真实密钥或外部付费接口。
- Radix Select 支持键盘选择；Tabs 支持左右键。嵌套菜单第一次 Escape 仅关菜单、第二次关闭弹窗并恢复触发按钮。学习完成跳转额度后焦点保留在 `daily-quota`。修正复审发现的异步焦点恢复竞态。
- 修正 Tailwind `outline` 同名工具类导致的双边框，同时实际确认键盘焦点仍显示 2px 边框。临时服务和 SQLite 已清理，未启动 Docker 或部署远程。
- 本机截图（忽略提交）：`outputs/ui-polish/ai-desktop.jpg`、`today-desktop.jpg`、`study-mobile.jpg`。截图使用虚构测试记录。
