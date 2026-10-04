"""EclipseLIVE 代码清理评估：机械扫描（只读，不修改任何文件）。"""
import json
import os
import re
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP = {"node_modules", ".git", "dist", "out", "dist-staging", ".tmp", "test-results",
        ".live-userdata", ".trae", "coverage", "playwright-report"}

def walk(base, exts=None):
    out = []
    for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, base)):
        dirnames[:] = [d for d in dirnames if d not in SKIP]
        for f in filenames:
            if exts and not f.endswith(exts):
                continue
            p = os.path.join(dirpath, f)
            out.append(os.path.relpath(p, ROOT).replace("\\", "/"))
    return out

# ---------- 0. 清单 ----------
src_files = walk("src")
mod_files = walk("modules")
test_files = walk("tests")
script_files = walk("scripts") if os.path.isdir(os.path.join(ROOT, "scripts")) else []
code_exts = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css", ".json")
code_files = [f for f in src_files + mod_files + test_files + script_files if f.endswith(code_exts)]

contents = {}
for f in code_files:
    try:
        with open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore") as fh:
            contents[f] = fh.read()
    except Exception:
        contents[f] = ""

all_text = "\n".join(contents.values())

# ---------- 1. 未被引用的文件 ----------
unreferenced = []
for f in code_files:
    base = os.path.basename(f)
    stem = os.path.splitext(base)[0]
    if f.startswith("tests/") or f.startswith("scripts/"):
        continue
    # 排除入口与约定文件
    if base in ("index.html", "index.ts", "main.ts", "preload.ts", "App.tsx", "manifest.json",
                "package.json", "tsconfig.json", "renderer.css", "main.css", "theme.ts",
                "ui-tokens.ts", "types.ts", "glass-bake.ts", "light-angle.ts"):
        continue
    hit = 0
    for g, text in contents.items():
        if g == f:
            continue
        if stem and re.search(r"[\\/'\"]" + re.escape(stem) + r"(\.(ts|tsx|js|jsx|mjs|cjs|css|html))?[\]'\"/)]", text):
            hit += 1
        elif base in text:
            hit += 1
    if hit == 0:
        size = os.path.getsize(os.path.join(ROOT, f))
        unreferenced.append({"path": f, "bytes": size})

# ---------- 2. 导出符号使用情况 ----------
export_re = re.compile(r"^export\s+(?:default\s+)?(?:async\s+)?(?:const|function|class|interface|type|enum|let)\s+([A-Za-z_$][\w$]*)", re.M)
unused_exports = []
for f, text in contents.items():
    if not f.endswith((".ts", ".tsx")):
        continue
    for m in export_re.finditer(text):
        name = m.group(1)
        uses = 0
        for g, t in contents.items():
            if g == f:
                continue
            uses += len(re.findall(r"\b" + re.escape(name) + r"\b", t))
        if uses == 0:
            line = text[: m.start()].count("\n") + 1
            unused_exports.append({"file": f, "line": line, "name": name})

# ---------- 3. 被注释掉的死代码 ----------
dead_comment = []
cmt_re = re.compile(r"^\s*//\s*(import|export|const|let|var|function|class|if|for|while|return|await|else|case|try|catch|throw|\}|\{)\b")
for f, text in contents.items():
    if not f.endswith((".ts", ".tsx", ".js", ".css")):
        continue
    lines = text.split("\n")
    hits = [i + 1 for i, l in enumerate(lines) if cmt_re.match(l)]
    if len(hits) >= 3:
        dead_comment.append({"file": f, "count": len(hits), "sample": hits[:8]})

# ---------- 4. 依赖使用情况 ----------
pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
deps = {}
for kind in ("dependencies", "devDependencies"):
    for name, ver in (pkg.get(kind) or {}).items():
        bare = name.split("/")[-1] if name.startswith("@") else name
        used = 0
        for g, t in contents.items():
            if re.search(r"['\"]" + re.escape(name) + r"([/'\"]|$)", t) or re.search(r"from\s+['\"]" + re.escape(name), t):
                used += 1
        # 配置文件里出现也算使用
        for cfg in ("electron.vite.config.ts", "playwright.config.ts", "vitest.config.ts",
                    "electron-builder.yml", "package.json", "tsconfig.json"):
            p = os.path.join(ROOT, cfg)
            if os.path.exists(p):
                with open(p, encoding="utf-8", errors="ignore") as fh:
                    if name in fh.read():
                        used += 1
        if used == 0:
            deps[name] = {"version": ver, "kind": kind}

# ---------- 5. CSS 类与令牌 ----------
css_classes, css_tokens = {}, {}
for f, text in contents.items():
    if not f.endswith(".css"):
        continue
    for m in re.finditer(r"\.(-?[A-Za-z_][\w-]*)", text):
        css_classes.setdefault(m.group(1), set()).add(f)
    for m in re.finditer(r"(--[\w-]+)\s*:", text):
        css_tokens.setdefault(m.group(1), set()).add(f)

unused_classes = []
for name, files in css_classes.items():
    if name.startswith("el-") or name in ("dark", "light"):
        continue
    used = sum(len(re.findall(r"\b" + re.escape(name) + r"\b", t)) for g, t in contents.items() if not g.endswith(".css"))
    if used == 0:
        unused_classes.append({"name": name, "definedIn": sorted(files)})

unused_tokens = []
for name, files in css_tokens.items():
    used = sum(t.count("var(" + name) for t in contents.values())
    if used == 0:
        unused_tokens.append({"name": name, "definedIn": sorted(files)})

# ---------- 6. 静态资源 ----------
assets = []
for base in ("resources", "build", "src/renderer/src/assets", "assets"):
    p = os.path.join(ROOT, base)
    if os.path.isdir(p):
        for f in walk(base):
            assets.append(f)
for f in mod_files:
    if f.lower().endswith((".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".ico", ".woff",
                           ".woff2", ".ttf", ".otf", ".mp3", ".wav", ".ogg")):
        assets.append(f)
unused_assets = []
for a in assets:
    stem = os.path.splitext(os.path.basename(a))[0]
    used = sum(t.count(stem) for g, t in contents.items())
    used += sum(t.count(a) for t in contents.values())
    if used == 0:
        unused_assets.append({"path": a, "bytes": os.path.getsize(os.path.join(ROOT, a))})

# ---------- 7. 空文件 ----------
empty = [f for f, t in contents.items() if len(t.strip()) == 0]

print("SCAN_OK")
print("FILES=" + json.dumps({
    "src": len(src_files), "modules": len(mod_files), "tests": len(test_files),
    "code": len(code_files), "unreferenced": unreferenced,
    "unusedExports": unused_exports[:60], "unusedExportCount": len(unused_exports),
    "deadCommentFiles": dead_comment, "unusedDeps": deps,
    "unusedCssClasses": unused_classes[:60], "unusedCssClassCount": len(unused_classes),
    "unusedCssTokens": unused_tokens[:60], "unusedCssTokenCount": len(unused_tokens),
    "unusedAssets": unused_assets, "emptyFiles": empty
}, ensure_ascii=True))

with open(os.path.join(ROOT, ".tmp", "scan.json"), "w", encoding="utf-8") as fh:
    json.dump({
        "unreferenced": unreferenced, "unusedExports": unused_exports,
        "deadCommentFiles": dead_comment, "unusedDeps": deps,
        "unusedCssClasses": unused_classes, "unusedCssTokens": unused_tokens,
        "unusedAssets": unused_assets, "emptyFiles": empty
    }, fh, ensure_ascii=False, indent=1)
