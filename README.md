# 词阶 · Wordsteps

英语与日语间隔复习网页。手机、电脑使用同一登录账号同步学习进度。词库、登录、数据库和部署不依赖飞书。

## 学习与解锁

- 内置日常英语、四级、六级、雅思、托福、GRE，以及日语 N5–N1。实际数据规模见 `data/stats.json`。
- 每阶段约 100 词。掌握当前阶段至少 80% 后，可参加最多 20 题的过关测试，答对至少 80% 才解锁后续阶段。
- 英语与日语分别计算；相同词条跨词库只保存一份学习记录。英语基础完成后开放考试分支，日语按 N5–N1 顺序推进。
- FSRS 根据“忘了／有点难／记得／很熟”安排复习；每日先复习到期词，再学习新词。
- 掌握是产品判定：从首次学习起至少 7 天，至少 3 个不同日期成功回忆，最近回答为记得或很熟，最新复习间隔至少 7 天。首次看过或同日重复不等于掌握。
- 忘记会撤销当前掌握状态并重新安排复习；已经取得的关卡解锁永久保留。
- 每种语言默认每日 10 个新词，可统一调整为 5–50 个。日期按 Asia/Shanghai 计算。

## 开发

Node.js 22.13+，React/Vinext，Cloudflare Workers/D1，ts-fsrs。平台账号认证由 Sites 提供；可迁移的业务模型不含飞书 SDK、API 或凭证。

```sh
npm ci
npm test
npm run typecheck
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_amazing_old_lace.sql
npm run dev
```

本地开发访问 `/signin-with-chatgpt?return_to=/` 使用隔离的模拟用户；生产登录由平台处理。迁移只对新的本地数据库执行一次。生产数据库由部署流程应用迁移，测试数据不随源码上传。

## 数据来源

英语：[ECDICT](https://github.com/skywind3000/ECDICT)，仓库 MIT 许可。日语：[egg rolls JLPT](https://github.com/5mdld/anki-jlpt-decks)，CC BY-NC 4.0。日语数据限非商业使用；改编包括去 HTML、去重、稳定 ID 与关卡分组。保留原作者及链接，许可全文在 `public/licenses/`，固定来源版本及哈希在 `data/provenance.json`。

词库是社区整理，考试标签仅供参考，不表示官方完整考试大纲。语音使用设备提供的浏览器朗读能力，取决于设备是否安装对应语言声音。英语源不含可靠例句，因此仅在确有来源时显示例句。

项目设计见 `docs/design.md`。GitHub 仓库：https://github.com/IXYTYXI/sej。
