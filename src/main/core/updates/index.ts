import * as https from 'node:https'
import type { ILogger } from '@contracts/logger'

/**
 * T21 检查更新（默认关闭）。
 *
 * 红线（D2）：INetworkClient 的 local-empty 契约不动；本服务是唯一外发例外，
 * 且只在「立即检查」显式触发、core.app.checkUpdatesEnabled 为 true 时才发请求。
 * 不自建更新服务器、不遥测、不下载安装包——只读 GitHub Releases latest 的
 * tag_name / html_url 供用户自行前往发布页。
 *
 * transport 可注入（单测不触网）；默认走 Node https 直取 JSON，10s 超时。
 */

/** 发布仓库占位（owner/repo）；仓库无 git remote，接入正式仓库后改此常量。 */
export const GITHUB_REPO = 'EclipseLIVE/EclipseLIVE'

const LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const REQUEST_TIMEOUT_MS = 10_000

export interface ReleaseInfo {
  tagName: string
  htmlUrl?: string
}

export interface UpdateCheckResult {
  ok: boolean
  status: 'up-to-date' | 'update-available' | 'error'
  current: string
  latest?: string
  url?: string
  error?: string
}

export type UpdateTransport = (url: string) => Promise<ReleaseInfo>

export interface UpdateChecker {
  check(): Promise<UpdateCheckResult>
}

/** 默认 transport：GET JSON，仅取 tag_name / html_url；非 200 或坏 JSON 一律 reject。 */
function httpsTransport(url: string): Promise<ReleaseInfo> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'EclipseLIVE', Accept: 'application/vnd.github+json' },
        timeout: REQUEST_TIMEOUT_MS
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub 响应 ${res.statusCode ?? 0}`))
            return
          }
          try {
            const parsed = JSON.parse(body) as { tag_name?: unknown; html_url?: unknown }
            if (typeof parsed.tag_name !== 'string') {
              reject(new Error('GitHub 响应缺少 tag_name'))
              return
            }
            resolve({
              tagName: parsed.tag_name,
              htmlUrl: typeof parsed.html_url === 'string' ? parsed.html_url : undefined
            })
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', (e) => reject(e))
  })
}

/** 纯三段数版本（可带 v 前缀）；其余一律非法（D2：非法 tag 判 error）。 */
function parseVersion(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewer(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export function createUpdateChecker(options: {
  logger: ILogger
  appVersion: string
  transport?: UpdateTransport
}): UpdateChecker {
  const transport = options.transport ?? httpsTransport
  return {
    /** 永不抛出：一切失败收敛为 { ok: false, status: 'error', error }。 */
    async check(): Promise<UpdateCheckResult> {
      const current = options.appVersion
      try {
        const release = await transport(LATEST_URL)
        const latestV = parseVersion(release.tagName)
        const currentV = parseVersion(current)
        if (!latestV || !currentV) {
          options.logger.warn('update check: invalid version', {
            tag: release.tagName,
            current
          })
          return {
            ok: false,
            status: 'error',
            current,
            error: `非法版本号：${release.tagName}`
          }
        }
        if (isNewer(latestV, currentV)) {
          options.logger.info('update available', { current, latest: release.tagName })
          return {
            ok: true,
            status: 'update-available',
            current,
            latest: release.tagName,
            url: release.htmlUrl
          }
        }
        return { ok: true, status: 'up-to-date', current, latest: release.tagName }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        options.logger.warn('update check failed', { error: message })
        return { ok: false, status: 'error', current, error: message }
      }
    }
  }
}
