import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 玻璃折射滤镜的**几何守卫**（排障产出的永久检查）。
 *
 * 背景（用户实测 + 像素量测定位）：基础滤镜曾把区域写成外扩
 * （`x="-30%/-40%" width="160%/180%"`）。滤镜输出**不受元素圆角与边界裁切**
 * ⇒ 位移后的壁纸会被画到面板之外（实测在侧栏右缘外 8~16px 形成一条亮带，
 * 亮度 209 而两侧仅 85~110）。
 *
 * 本守卫钉住两条：
 * ① 滤镜区域**必须贴合元素盒子**（0/0/100%/100%）—— 不允许外扩；
 * ② 边缘**必须用 feTile 铺满输入** —— 否则位移会采样到元素外（那里没有像素）而产生异常窄条。
 *
 * 注：同一条带另有一个**非 bug** 来源：面板之间的栅格间隙会透出底色/壁纸（设计使然），
 * 那属于布局观感，不在本守卫范围内（详见 TASKS/T37 与本次排障记录）。
 */
describe('玻璃折射滤镜几何（排障产出）', () => {
  it('滤镜区域贴合元素盒子，且位移输入用 feTile 铺满', async () => {
    const html = await readFile(join(process.cwd(), 'src/renderer/index.html'), 'utf8')
    for (const id of ['glass-refract-subtle', 'glass-refract-strong']) {
      const start = html.indexOf(`id="${id}"`)
      expect(start, `缺少滤镜 ${id}`).toBeGreaterThanOrEqual(0)
      const end = html.indexOf('</filter>', start)
      const body = html.slice(start, end)
      // ① 区域必须贴合：不得出现 -30%/-40% 或 160%/180% 这类外扩值
      expect(body, `${id} 的滤镜区域不得外扩`).toMatch(/x="0"\s+y="0"\s+width="100%"\s+height="100%"/)
      expect(body, `${id} 仍在外扩（会被画到元素之外）`).not.toMatch(/(-\d+%|1[5-9]\d%|2\d\d%)/)
      // ② 位移输入必须先 feTile（避免边缘采样到元素外）
      expect(body, `${id} 的位移输入应经 feTile 铺满`).toMatch(/<feTile[^>]*result="tiled"/)
      expect(body, `${id} 的位移应消费 tiled`).toMatch(/<feDisplacementMap[^>]*in="tiled"/)
    }
  })
})
