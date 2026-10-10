# 词阶 · Wordsteps

英语与日语间隔复习网页，手机和电脑共用独立账号。应用使用 Docker、自有服务器和 SQLite 持久化，不依赖飞书、ChatGPT 登录或 Cloudflare D1。

## 学习与 AI

- 25,076 个独立英日词条，11 套词库，411 个阶段；每阶段最多 100 词。
- 掌握当前阶段至少 80%，再通过最多 20 题、正确率至少 80% 的测验，才解锁后续阶段。
- FSRS 按“忘了／有点难／记得／很熟”安排间隔复习；到期词优先，每种语言默认每日 10 个新词。
- 掌握要求学习跨度至少 7 天、至少 3 个不同日期成功回忆、最近为记得或很熟、最新间隔至少 7 天。同日反复点击不会直接变成掌握；已经获得的解锁永久保留。
- AI 可生成近期学习报告与薄弱词分析、单词记忆提示和例句，并进行英日对话练习。仅在主动点击时调用，不影响考试评分、掌握率或解锁。
- Claude（Anthropic Messages）和 OpenAI（Chat Completions）分别配置，支持兼容网关。每日每账号总计 30 次、并发 1 次、45 秒超时；缓存命中不计额度。已发出的失败请求可能已产生上游费用，因此计额度，重复请求不会重复调用。

## 开发与验证

Node.js 24.13+。

```sh
npm ci
npm test
npm run typecheck
NEXT_PUBLIC_BASE_PATH=/study npm run build
npm run test:integration
```

集成测试自动启动临时服务器，使用随机测试密码和临时 SQLite，验证登录、配额、解锁、重启持久化、退出；不连接生产数据库。开发启动需要 `AUTH_PASSWORD_HASH` 或 `AUTH_PASSWORD_HASH_FILE`，以及 `APP_ORIGIN`；密码 hash 用 `scripts/hash-password.mjs` 从 stdin 生成，原密码不要写入命令参数。

## Docker 部署

部署入口目标为 `https://xairlab.com/study`。配置和运维步骤见 [部署说明](docs/deployment.md)。Dockerfile 内含测试和生产构建；应用非 root 运行，数据库使用独立持久卷。服务仅监听宿主机回环地址 `127.0.0.1:3100`，由现有反向代理接入域名。

```sh
cp .env.example .env
# 按部署说明准备 secrets/ 下的密码 hash 和 API 密钥文件
# 不要把秘密放入 Git、镜像或前端代码

docker compose up -d --build
docker compose ps
```

当前账号为单人模式，不开放注册。`AUTH_USERNAME` 默认 `yc`；密码须另行设置，不复用 SSH 密码。OpenAI 未配置独立 key 时显示未配置。已有 Sites 版本的数据不会自动转移；如已有真实进度，需按账号核实后单独迁移。

## 数据来源

英语：[ECDICT](https://github.com/skywind3000/ECDICT)，MIT。日语：[egg rolls JLPT](https://github.com/5mdld/anki-jlpt-decks)，CC BY-NC 4.0，仅非商业用途。改编包括去 HTML、去重、稳定 ID 和关卡分组；署名与许可在 `public/licenses/`，固定版本及哈希在 `data/provenance.json`。

考试标签是社区整理，不代表官方完整考试大纲。朗读使用设备语音；英语源未提供可靠例句，词库不会伪造例句，AI 原创例句单独标识。
