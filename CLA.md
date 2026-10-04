# 贡献者许可协议（CLA）

> **本项目采用 [Harmony CLA 1.0](https://www.harmonyagreements.org/) 的官方标准文本** ✓
> —— 由 Project Harmony 起草（**CC BY 3.0** 许可发布），本项目**逐字采用、不改条款**。
>
> 📄 **官方文本（已逐字存档，请以它们为准）**：
> - 个人：**[`docs/cla/ha-cla-i-v1.pdf`](docs/cla/ha-cla-i-v1.pdf)**（Harmony Individual CLA 1.0）
> - 实体：**[`docs/cla/ha-cla-e-v1.pdf`](docs/cla/ha-cla-e-v1.pdf)**（Harmony Entity CLA 1.0）
>
> 说明与适用法律见 **[`docs/cla/README.md`](docs/cla/README.md)** ✓

---

## 为什么用 Harmony 而不是自拟条款

- **是现成的、律师起草的文本** ⇒ 不需要本项目自行起草法律条款；
- **被大量开源项目使用** ⇒ 社区对它的含义有共识，签字摩擦低；
- **只做"许可"不做"转让"**（区别于 CAA）⇒ 你**保留**自己贡献的版权，只是授权项目使用与再许可；
- 常用它实现**双授权**（AGPL + 商业授权）—— 这也是本项目 [`COMMERCIAL_LICENSE.md`](COMMERCIAL_LICENSE.md) 的前提。

## 适用范围（本项目政策）

| 你的改动落点 | 需要 |
| --- | --- |
| **核心**：`src/main/**`、`src/preload/**`、`src/renderer/**`、`src/shared/**`、`tests/**`、`scripts/**` | **签署 Harmony CLA**（个人或实体） |
| **接口 / 模板 / 模块 / 文档**：`src/contracts/**`、`templates/**`、`modules/**`、`sdk/**`、`docs/**` | 仅 **DCO**（`git commit -s`，见 [`DCO`](DCO)） |

**写模块不需要签任何协议** ✓ —— 模块作者使用 **MIT 的 SDK**
（[`sdk/`](sdk/README.md) 或独立仓库 [eclipselive-sdk](https://github.com/LuminaMilkyWay/eclipselive-sdk)），
协议自选（可闭源收费）。详见根 [`NOTICE`](NOTICE) 第 3 节。

## 未签署的贡献

未签署的 PR **不会被合并到核心落点**（这是不可逆的：先合并再补签**不能**追溯授权，
会让项目永久失去对该部分的商业再许可能力）。改动 MIT 落点则无需签署。

## 关于本文件的历史

本文件曾包含一份**自拟**的 CLA 草案（含留空的"适用法律"条款）。
现**已被 Harmony 官方文本取代** ✓ —— 自拟文本不再使用，历史上未据此收取任何贡献。
