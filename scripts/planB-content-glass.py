"""B 方案：.content 拆成「不滚动玻璃外框（带折射/色散场景层）+ 内层滚动容器」。"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TSX = os.path.join(ROOT, "src", "renderer", "src", "shell", "ContentArea.tsx")
CSS = os.path.join(ROOT, "src", "renderer", "src", "renderer.css")

# ---------- ① TSX：加内层滚动容器 ----------
t = open(TSX, encoding="utf-8").read()
assert '<section className="content">' in t and "</section>" in t
t = t.replace(
    '<section className="content">',
    '<section className="content">\n      {/* B 方案：内层滚动容器 —— 外层只做"不滚动的玻璃外框"，'
    '场景层（底图折射/色散）挂在它上面，因此不会随内容滚动。 */}\n      <div className="content-scroll">',
    1,
)
t = t.replace("</section>", "</div>\n    </section>", 1)
open(TSX, "w", encoding="utf-8", newline="\n").write(t)
print("TSX_WRAPPED=True")

# ---------- ② CSS ----------
css = open(CSS, encoding="utf-8").read()

# 2a. 把 .content 的 overflow-y / flex / padding 交给内层；外框改为定位 + 裁切
old_head = """  min-height: 0;
  overflow-y: auto;
  /* T34：flex 容器——模块页槽位/第三方工具槽位（flex:1）才能撑满右侧 3/4
     内容区（此前非 flex 容器下 flex:1 失效，槽位退化为 min-height:60vh，
     WebContentsView 只覆盖右上局部）。其它页面（.page 内容驱动）不受影响。 */
  display: flex;
  flex-direction: column;"""
new_head = """  min-height: 0;
  /* B 方案：本元素是**不滚动的玻璃外框** —— 折射/色散场景层（::before/::after）挂在它上面，
     因此不会随内容滚动（此前直接挂在滚动容器上会"底图跟着滑"）。
     滚动交给内层 `.content-scroll`；槽位/页面的 flex 布局也移到内层。 */
  position: relative;
  overflow: clip;
  display: flex;
  flex-direction: column;"""
assert old_head in css, "content 头部未找到"
css = css.replace(old_head, new_head, 1)

# 2b. padding 交给内层（外框不留内边距，内层承担页面留白 + 槽位负边距抵消）
old_pad = """  /* 页面内容与面板边缘留白（用户："紧贴边缘太丑了，这个不用学"）。
     但模块页槽位/第三方工具槽位必须**铺满**右侧 3/4（T34 契约，集成断言"槽位宽度＝内容区宽度"）
     ⇒ 对这两类槽位用**负外边距抵消**下面的内边距，两边都不破坏。 */
  padding: var(--sp-4);
}

.content > .module-page-host,
.content > .tool-slot
{
  margin: calc(-1 * var(--sp-4));
}"""
new_pad = """}

/* B 方案内层：真正的滚动容器 + 页面留白（原 .content 的滚动与内边距搬到这一层）。
   外框负责玻璃/折射，内层负责滚动与排布 ⇒ 场景层不随内容滚动。 */
.content-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* 页面内容与面板边缘留白（用户："紧贴边缘太丑了，这个不用学"）。
     但模块页槽位/第三方工具槽位必须**铺满**右侧 3/4（T34 契约，集成断言"槽位宽度＝内容区宽度"）
     ⇒ 对这两类槽位用**负外边距抵消**下面的内边距，两边都不破坏。 */
  padding: var(--sp-4);
}

.content-scroll > .module-page-host,
.content-scroll > .tool-slot
{
  margin: calc(-1 * var(--sp-4));
}"""
assert old_pad in css, "content padding/负边距块未找到"
css = css.replace(old_pad, new_pad, 1)

# 2c. 场景层与色散层：把 .content 加进既有选择器组（与侧栏/卡片同源）
assert ".side::before,\n.tool-bar::before,\n.modal-panel::before,\n.card::before {" in css
css = css.replace(
    ".side::before,\n.tool-bar::before,\n.modal-panel::before,\n.card::before {",
    ".side::before,\n.tool-bar::before,\n.modal-panel::before,\n.card::before,\n.content::before {",
    1,
)
assert ".side::after,\n.tool-bar::after,\n.modal-panel::after,\n.card::after {" in css, "色散组未找到"
css = css.replace(
    ".side::after,\n.tool-bar::after,\n.modal-panel::after,\n.card::after {",
    ".side::after,\n.tool-bar::after,\n.modal-panel::after,\n.card::after,\n.content::after {",
    1,
)
open(CSS, "w", encoding="utf-8", newline="\n").write(css)
print("CSS_PATCHED=True")
