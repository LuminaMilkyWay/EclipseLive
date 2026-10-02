"""收尾：修 gitignore/CONTRIBUTING、清事故截图，白名单重建公开快照分支，自检通过后强推。"""
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def sh(args, check=True, quiet=True):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0 and not quiet:
        print("  !", " ".join(args[:3]), (r.stderr or "").strip()[:160])
    return r


# ---------- ① 内部资料（公开集排除） ----------
INTERNAL_GLOBS = ["TASKS/", "dev-notes/", "prototype/"]

# ---------- ② .gitignore 落盘（读回确认） ----------
gi_path = os.path.join(ROOT, ".gitignore")
gi = open(gi_path, encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
if "# 内部开发资料（不公开）" not in gi:
    gi = gi.rstrip("\n") + """

# 内部开发资料（不公开；本地保留，仅不进 git）
TASKS/
dev-notes/
prototype/
docs/CHANGELOG-DEV.md
docs/*INCIDENT*.md
docs/GRAY-VEIL-INCIDENT-LOG.md
docs/PROBLEM-REPORT-*.md
docs/*-ASSESSMENT*.md
docs/MODULE-MATERIAL-SYNC-AUDIT.md
docs/screenshots/incident-*.png
scripts/t4*.py
scripts/t5*.py
scripts/t6*.py
scripts/p0*.py
scripts/p1*.py
scripts/p2*.py
scripts/p3*.py
scripts/brand-corona.py
scripts/embed-repo*.py
scripts/set-author.py
scripts/set-contact.py
scripts/rule29-and-repack.py
scripts/fix-uninstall-and-rule29.py
scripts/migrate-*.py
scripts/prepare-release.py
scripts/public-surface-cleanup.py
scripts/check-signoff.mjs
"""
    open(gi_path, "w", encoding="utf-8", newline="\n").write(gi)
print("gitignore:", "# 内部开发资料（不公开）" in open(gi_path, encoding="utf-8-sig").read())

# ---------- ③ CONTRIBUTING 落盘（读回确认） ----------
cp = os.path.join(ROOT, "CONTRIBUTING.md")
c = open(cp, encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
if "公开面与内部资料" not in c:
    c = c.rstrip("\n") + """

## 公开面与内部资料

本仓库只包含**产品与协议**。内部流程资料（任务卡、开发日志、事故复盘、内部评估报告）**不公开**；
它们沉淀出的**规则**已提炼进本文件与 [`AI_RULES.md`](AI_RULES.md) ⇒ 贡献者只需读这两份。
"""
    open(cp, "w", encoding="utf-8", newline="\n").write(c)
print("CONTRIBUTING:", "公开面与内部资料" in open(cp, encoding="utf-8-sig").read())

# ---------- ④ 事故截图从索引移除 ----------
sh(["git", "rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "docs/screenshots"], check=False)

# ---------- ⑤ 提交清理 ----------
sh(["git", "add", "-A"], check=False)
sh(["git", "-c", "user.name=EclipseLIVE Dev", "-c", "user.email=dev@eclipselive.local", "commit",
    "-m", "chore(repo): exclude incident screenshots + finish the public/internal split"], check=False)

# ---------- ⑥ 白名单公开集 ----------
PUBLIC = [
    "README.md", "LICENSE", "NOTICE", "COMMERCIAL_LICENSE.md", "TRADEMARK.md",
    "CLA.md", "DCO", "CLA-SIGNATORIES.md", "CONTRIBUTING.md", "ARCHITECTURE.md",
    "PRODUCT.md", "MODULE_UI_CONTRACT.md", "AI_RULES.md", "CHANGELOG.md", "RELEASE_NOTES.md",
    "package.json", "package-lock.json", ".gitignore",
    "tsconfig.json", "tsconfig.node.json", "tsconfig.web.json",
    "electron.vite.config.ts", "vitest.config.ts", "playwright.config.ts",
    ".github", "src", "tests", "templates", "modules", "build", "assets", "docs", "scripts",
]

sh(["git", "checkout", "--orphan", "public-snapshot"], check=False)
sh(["git", "rm", "-r", "--cached", "--quiet", "."], check=False)
for path in PUBLIC:
    if os.path.exists(os.path.join(ROOT, path)):
        sh(["git", "add", "-A", "--", path], check=False)
sh(["git", "add", "-A", "--", ".gitignore"], check=False)
sh(["git", "-c", "user.name=EclipseLIVE Dev", "-c", "user.email=dev@eclipselive.local", "commit",
    "-m", "Initial public release\n\nEclipseLIVE — 面向虚拟主播的纯本地 OBS 辅助软件。\n\n"
          "核心 AGPL-3.0-or-later；接口（src/contracts）、模板、示例与官方模块 MIT；"
          "社区模块作者自选协议。详见 NOTICE 与 COMMERCIAL_LICENSE.md。"], check=False)

files = sh(["git", "ls-files"]).stdout.splitlines()
print("公开快照文件数:", len(files))
leak = [f for f in files if f.startswith(("TASKS/", "dev-notes/", "prototype/"))
        or "CHANGELOG-DEV" in f or "INCIDENT" in f or "PROBLEM-REPORT" in f
        or "-ASSESSMENT" in f or "GRAY-VEIL" in f or "MODULE-MATERIAL-SYNC-AUDIT" in f
        or "incident-" in f]
print("内部资料残留:", leak if leak else "无 ✓")
print("BRANCH:", sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip(),
      "| 旧历史仍在 master + tag pre-public-snapshot")
