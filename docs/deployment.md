# 自有服务器部署

## 运行结构

`https://xairlab.com/study` → 既有 Caddy → `127.0.0.1:3100` → Wordsteps Docker 容器。

应用本身不占用主站的 80/443 端口。Next 的 `/study` 前缀在构建时确定，反向代理应保留此路径，不能用 `handle_path` 去掉前缀。修改前缀需重新构建镜像。

## 首次准备

服务器需安装 Docker Engine 与 Compose。将源码放在独立目录（例如 `/opt/wordsteps`），保留既有站点配置。复制 `.env.example` 为 `.env`，保持 `APP_ORIGIN=https://xairlab.com`，不带路径或末尾斜杠。

在源码目录下创建仅部署者可操作的 `secrets/`，文件须让容器用户 UID 1000 可读：

| 文件 | 内容 |
|---|---|
| `auth_password_hash` | 使用 `scripts/hash-password.mjs` 由 stdin 接收至少 12 字符的独立登录密码，输出 scrypt hash。这是初始账号 `AUTH_USERNAME` 的密码 |
| `registration_code` | 可选，8–128 个字符的单行邀请码。没有有效邀请码时关闭注册；每个注册账号单独计算每天 30 次 AI 额度 |
| `anthropic_api_key` | Claude 接口的真实密钥 |
| `openai_api_key` | OpenAI 接口的真实密钥；未提供可为空 |

不要复用 SSH root 密码。不要把密码放进命令行参数；交互读取后经 stdin 传给 hash 脚本。仅将 hash 保存到指定文件。密钥通过受保护的输入方式写入对应运行时文件，不写入源码或 `.env.example`。建议秘密文件属主 UID 1000、权限 0400；目录由 root 管理。`.gitignore` 与 `.dockerignore` 均排除该目录。

升级已有部署时可以暂不添加 `registration_code`。邀请码缺失、不可读、格式无效，或同时配置 `REGISTRATION_CODE` 与 `REGISTRATION_CODE_FILE` 时，注册接口返回 503「注册尚未开放」，已有账号仍可登录，健康检查仍验证必需的账号密码配置与数据库。有效的 `auth_password_hash` 始终必需；健康检查成功不代表注册已开放。

`.env` 中可以更换 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。base URL 支持带或不带 `/v1`，不能带用户信息、查询参数或跳转；服务不会跟随 API 重定向。两个提供者不共享 key，不会静默回退。

部署样例的 OpenAI 模型为 `gpt-6-luna`，已于 2026-10-10 使用独立密钥通过指定网关的真实 Chat Completions 请求验证。样例只保存模型标识；上线时仍须注入运行时密钥。

## 启动与接入

```sh
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3100/study/api/health
```

健康检查同时验证账号配置和数据库。未配置有效密码 hash 时返回 503，避免把无认证应用当作已就绪。

备份现有 Caddy 配置，将 `deploy/Caddyfile.fragment` 中的匹配路由合并进现有 `xairlab.com` 站点块，不替换主站。通过 `caddy validate` 后再使用现有服务的平滑 reload 方式加载。若 Caddy 自己也在容器中，`127.0.0.1` 指向代理容器自身。本机 Caddy 与应用同在 `apps_internal` 网络，upstream 使用容器名 `wordsteps:3000`。

最后检查 HTTPS 下登录、背词、AI 报告以及主站原有页面。远程未成功执行这些步骤前，不应声称已部署。

## 新增独立管理员

管理员当前拥有 AI 不限次数的权限，仍受并发、超时、阶段解锁和账号数据隔离约束。学习进度各自保存，不复制初始账号的进度。新增管理员仅通过服务器命令操作，普通注册不能指定角色。

先升级并确认应用健康，使 `0004_user_roles.sql` 迁移生效；初始账号自动标记为管理员，已有普通账号保持普通权限。然后在服务器的项目目录，通过隐藏输入将至少 12 位密码传入容器命令。密码不要写在命令行、脚本或仓库中。

```bash
read -rsp '新管理员密码（至少 12 位）: ' WORDSTEPS_NEW_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$WORDSTEPS_NEW_ADMIN_PASSWORD" | docker compose exec -T app node scripts/create-admin.mjs --username another-admin
unset WORDSTEPS_NEW_ADMIN_PASSWORD
```

用户名允许 2–32 位英文字母、数字、下划线或连字符。命令只在已升级的现有数据库中创建新管理员；同名账号（不区分大小写）或初始账号保留名会被拒绝，不会覆盖密码或提升已有账号。成功输出只包含用户名、角色及创建状态，数据库只存 scrypt 哈希。

## 数据、备份与升级

数据库位于容器 `/data/wordsteps.sqlite`，Compose 命名卷为 `wordsteps_learning_data`。普通 `docker compose down` 不删除数据；不要使用 `down -v`。每次启动自动按顺序执行新增迁移；已应用迁移有校验和，不要修改旧迁移文件。

一致性备份可在容器内使用 SQLite 的 `VACUUM INTO` 将快照写入 `/data` 下一个尚不存在的备份路径，再从容器复制出来。不要在应用写入时只复制主 `.sqlite` 文件而遗漏 WAL。备份包含学习记录和会话数据，应限制访问。

升级前保存数据快照及当前镜像 ID。新版本通过测试、构建和健康检查后再切换；应用镜像可回退，但数据库变更应根据迁移兼容性处理，不盲目覆盖数据库。

独立版本不读取旧站点的身份请求头。若需迁移旧站点真实进度，先确认旧账号与新固定账号 `owner` 的对应关系，再做事务导入。
