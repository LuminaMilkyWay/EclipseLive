## 贡献协议（必选其一 · 按改动落点）

- [ ] 我改动了**核心落点**（`src/main/**`、`src/preload/**`、`src/renderer/**`、`src/shared/**`、`tests/**`、`scripts/**`）
      —— 我已阅读并同意 [`CLA.md`](../CLA.md)，并在此声明：
      `I have read the CLA in CLA.md and I agree to it.` ／ `Signed: 姓名 <邮箱>`
- [ ] 我改动了**接口 / 模板 / 模块 / 文档落点**（`src/contracts/**`、`templates/**`、`modules/**`、`docs/**`）
      —— 我的每个提交都带 `Signed-off-by`（DCO，见 [`DCO`](../DCO)）

> 说明：**DCO 不授予本项目商业再许可权**（那是 CLA 的作用）。
> 因此只要改动触及核心落点，就必须走 CLA 一栏。

## 自查（提交前）

- [ ] 已跑 `npx tsc --noEmit`（web + node）
- [ ] 已跑 `npx vitest run`
- [ ] 已跑 `npx electron-vite build`（**必须先于集成**）
- [ ] 已跑 `npx playwright test`
- [ ] 技术细节已写入 `CHANGELOG.md`；若有用户可感知变化，已写入 `RELEASE_NOTES.md`
- [ ] 未删除任何测试；若改了断言，已在提交信息中说明**为何**（并保持语义不变或按新需求更新）

## 变更说明

<!-- 做了什么 / 为什么 / 影响面 / 回滚方法 -->
