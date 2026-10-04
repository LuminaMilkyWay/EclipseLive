# core/credentials

安全凭据存储（任务卡 T9）。契约见 `src/contracts/credentials.ts`（ICredentialStore / CredentialRecord）。

## 职责

- 通用加密键值对：未来云账号 token、API key 的唯一归宿（OBS 密码今日已用——`obs:password` 优先于 `core.obs.password` 配置明文）
- **注入式 cipher**：核心零 Electron 依赖（单测注入 AES-256-GCM）；组装根用 `electron-cipher.ts`（safeStorage：Windows DPAPI / macOS Keychain / Linux libsecret）
- 密文先于落盘：`userData/credentials/credentials.json`（version + entries{ciphertext, weak, updatedAt}）；原子写 tmp+rename；写入串行队列
- 损坏文件 → `.bak` 备份后空库重建；解密失败 → `get` 返回 null 不抛出（单条坏记录不拖垮库）
- `list()` 仅元数据（key/weak/updatedAt）；键 ≤256 字符、值 ≤64KB 校验

## 红线

- **明文与密文都不落日志**——仅键名与元数据（logger 脱敏管道之外的第二道约束：根本不传）
- OS 加密不可用时回退明文并如实标记 `weak`（Windows DPAPI 恒可用，回退防备异常环境）

## 测试

- `tests/unit/credentials.spec.ts`（8 例：往返/落盘无明文/元数据/删除/跨实例持久化/损坏备份/weak 标记/解密失败/校验）
- `tests/integration/credentials-wiring.spec.ts`（真实 Electron safeStorage 往返探针 roundtrip:true）
