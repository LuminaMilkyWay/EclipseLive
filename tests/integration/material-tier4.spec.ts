import { test, expect, _electron as electron } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * T37 材质档位的**应用级守卫 + 目视取证**。
 *
 * 教训（用户实测反馈）：上一轮"验收截图"用的是**纯深色空背景**，玻璃与不玻璃看起来一样，
 * 等于没验证。现在一律使用**可识别底图** `tests/fixtures/wallpaper-probe.png`
 * （细棋盘格 + 同心彩环 + 放射彩条 + 细网格文字 + 亮/暗两块），它能同时暴露：
 * 模糊是否生效、折射/色散是否错位、是否糊了一层灰雾、亮背景暗压层是否过重。
 *
 * 该底图平均亮度 ≈ 0.80（> 0.6 阈值）⇒ 会被判定为"亮背景"，正好覆盖最坏情况。
 *
 * 断言（每个档位都要过）：
 * ① `data-material` 就是所选档位；
 * ② 侧栏的**计算 `backdrop-filter` 必须含 `blur(` 与 `saturate(`** —— 这是"玻璃消失"的机械探测器
 *    （整条滤镜列表一旦被丢弃，计算值会变成 none）；
 * ③ 不得引用未验证的烘焙滤镜、不得再有面板级指针高光标记；
 * ④ 已回退的接线不得复活（烘焙滤镜、面板级指针高光、亮背景暗压层）；
 * ⑤ 抓真实窗口画面（`tier{N}-shot.png`）供人工比对。
 */
const electronExecutablePath = require('electron') as string
const projectRoot = resolve(__dirname, '../..')
const probeWallpaper = resolve('tests/fixtures/wallpaper-probe.png')

function probeProfile(material: number): string {
  const dir = mkdtempSync(join(tmpdir(), `el-tier${material}-`))
  mkdirSync(join(dir, 'config'), { recursive: true })
  // ★ 壁纸必须走**壁纸库**：配置里存的是文件名，图片本体放在 <userData>/wallpapers/，
  //   由 eclipse-wallpaper:// 协议提供（直接写绝对路径会被 isSafeWallpaperName 拒绝）。
  const wallpaperDir = join(dir, 'wallpapers')
  mkdirSync(wallpaperDir, { recursive: true })
  copyFileSync(probeWallpaper, join(wallpaperDir, 'probe.png'))
  writeFileSync(
    join(dir, 'config', 'core.ui.json'),
    JSON.stringify({
      format: 'eclipselive-config-section',
      version: 4,
      updatedAt: Date.now(),
      data: {
        themeMode: 'dark',
        accent: 'corona-orange',
        material,
        // ★ 可识别底图（验收必须能看到玻璃在"有内容"的背景上做什么）
        wallpaperImage: 'probe.png',
        wallpaperFit: 'fill',
        wallpaperOpacity: 1,
        wallpaperBlur: 0,
        reduceTransparency: false,
        highContrast: false,
        reduceMotion: false
      }
    }),
    'utf8'
  )
  return dir
}

for (const tier of [2, 4]) {
  test(`档 ${tier}：玻璃真有模糊 + 亮背景一次性采样 + 目视取证（可识别底图）`, async () => {
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [projectRoot],
      env: {
        ...process.env,
        EL_TEST_USERDATA: probeProfile(tier),
        EL_TEST_SKIP_TITLE: '1',
        EL_TEST_SKIP_WHATS_NEW: '1'
      } as unknown as Record<string, string>
    })
    const page = await app.firstWindow()
    try {
      await expect(page.locator('html')).toHaveAttribute('data-material', String(tier))

      const probe = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: {
            documentElement: { getAttribute(n: string): string | null }
            querySelector(sel: string): unknown
            querySelectorAll(sel: string): ArrayLike<unknown>
          }
          getComputedStyle(el: unknown): {
            backdropFilter?: string
            webkitBackdropFilter?: string
          }
        }
        const bd = (sel: string): string => {
          const el = g.document.querySelector(sel)
          if (!el) return '__missing__'
          const cs = g.getComputedStyle(el)
          return cs.backdropFilter ?? cs.webkitBackdropFilter ?? ''
        }
        const side = g.document.querySelector('.side')
        const cs = side ? g.getComputedStyle(side) : null
        return {
          found: side !== null,
          filter: cs?.backdropFilter ?? cs?.webkitBackdropFilter ?? '',
          // 文档 §6 第 1 项（最高优先级）：内容层**不得**有常驻 backdrop-filter
          cardBlur: bd('.card'),
          hostBlur: bd('.module-page-host'),
          luma: g.document.documentElement.getAttribute('data-backdrop-luma'),
          baked: g.document.documentElement.getAttribute('data-baked-refract'),
          light: g.document.documentElement.getAttribute('data-light')
        }
      })

      // ② "玻璃消失"的机械探测器
      expect(probe.found, '应能取到侧栏 .side').toBe(true)
      expect(probe.filter, `档 ${tier} 侧栏玻璃必须含 blur（否则玻璃等于消失）`).toContain('blur(')
      expect(probe.filter, `档 ${tier} 侧栏玻璃必须含 saturate`).toContain('saturate(')
      // ★ 契约（按用户要求 "恢复原有三档材质的效果" 锁定）：
      //   内容层**所有档位都是玻璃**（T36 之前的原有配方）—— `.card` / `.module-page-host`
      //   必须有 backdrop-filter；唯一仍然禁止的是整面薄纱（--mat-veil，AI_RULES 24）。
      for (const [name, value] of [
        ['.card', probe.cardBlur],
        ['.module-page-host', probe.hostBlur]
      ] as const) {
        if (value === '__missing__') continue
        expect(
          value,
          `档 ${tier} 的 ${name} 应随原有材质效果一起玻璃化（应有 backdrop-filter）`
        ).toContain('blur(')
      }
      // ③ 未验证/已回退的接线不得复活
      expect(probe.filter, '不得引用未验证的烘焙滤镜').not.toContain('glass-refract-baked')
      expect(probe.baked, '不得再有 data-baked-refract').toBeNull()
      expect(probe.luma, '亮背景暗压层已移除（采样不可用）').toBeNull()

      // 指针光斑（用户要求："以指针为中心的圆形光斑"）的存在性与"不捕获事件"由**单测的 CSS 断言**
      // 保证（确定性、不依赖真实伪元素的计算样式）；这里只记录其状态供诊断。
      // 说明：`data-light` 是光斑的显示开关，由指针移动置位 —— 不再是"面板级指针高光"，
      // 后者由单测禁止（不得出现 `:root[data-light='1'] .side/...`）。

      // ⑤ 目视证据：等底图绘制完再抓
      await page.waitForTimeout(600)
      const b64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const b = win.getContentBounds()
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: b.width, height: b.height }
        })
        // T50：字面量须随 APP_NAME（'EclipseLive'）同步——evaluate 闭包在浏览器侧执行，引用不了外部常量
        const mine = sources.find((s) => s.name.includes('EclipseLive')) ?? sources[0]
        return mine ? mine.thumbnail.toPNG().toString('base64') : ''
      })
      if (b64) writeFileSync(resolve(`tier${tier}-shot.png`), Buffer.from(b64, 'base64'))
    } finally {
      await app.close().catch(() => {})
    }
  })
}
