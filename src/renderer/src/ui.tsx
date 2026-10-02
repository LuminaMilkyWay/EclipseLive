import { useEffect, useRef, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from 'react'

/**
 * T20 组件库：PRODUCT.md 组件规范 13 类统一归口（React 组件 + renderer.css 统一类）。
 * 按钮（主要/次要/危险/图标）、开关、选择器、滑块、输入框、分组卡片（.card 既有）、
 * 列表行、徽章、模态框、确认对话框、浮层提示、空状态；分段选择器自 App.tsx 迁入一并归口。
 * 约定：Btn 默认 type="button" 且透传原生属性（className 追加为修饰类）；
 * 模态框遮罩点击=关闭、面板内点击不冒泡；浮层提示单条覆盖，5s 自动消失（调用方清态）。
 */

/** 按钮变体（PRODUCT.md 组件规范四类：主要/次要/文字/危险）。 */
export type BtnVariant = 'primary' | 'secondary' | 'danger' | 'text'

export function Btn({
  variant = 'secondary',
  type = 'button',
  className,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  /** 加载中：渲染 spinner、文字变淡，并经原生 disabled 拦截重复点击（T-A3）。 */
  loading?: boolean
}) {
  return (
    <button
      type={type}
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  testId,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  testId?: string
  label?: string
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      {label == null ? null : <span className="switch-label">{label}</span>}
    </label>
  )
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  )
}

/** 滑块：data-testid 等原生属性透传到真正的 range 输入元素（集成测试直取 input）。 */
export function Slider({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" className={['slider', className].filter(Boolean).join(' ')} {...rest} />
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...rest} />
}

/** 分段选择器（外观组三项共用）：点击即调 onPick 即时生效并持久；active 类落在带 testid 的按钮自身。 */
export function SegGroup<T extends string | number>({
  testId,
  value,
  options,
  onPick
}: {
  testId: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onPick: (v: T) => void
}) {
  return (
    <div className="seg-group">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          data-testid={`${testId}-${v}`}
          className={v === value ? 'seg active' : 'seg'}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ListRow({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="list-row">
      <span className="list-row-main">{children}</span>
      {actions == null ? null : <span className="list-row-actions">{actions}</span>}
    </li>
  )
}

export function Badge({ variant, children }: { variant?: string; children: ReactNode }) {
  return <span className={variant ? `badge badge-${variant}` : 'badge'}>{children}</span>
}

/**
 * T28 弹窗进出场：遮罩点击/按钮关闭先走 data-closing='true' 缩放淡出（160ms）
 * 再回调卸载；`closing` 允许 ConfirmDialog 等内部按钮驱动同一退场（延迟 160ms 与 CSS 同步）。
 */
export function Modal({
  onClose,
  closing = false,
  children
}: {
  onClose: () => void
  closing?: boolean
  children: ReactNode
}) {
  const [selfClosing, setSelfClosing] = useState(false)
  const requestClose = (): void => {
    if (selfClosing) return
    setSelfClosing(true)
    setTimeout(onClose, 160)
  }
  return (
    <div className="modal" onClick={requestClose}>
      <div
        className="modal-panel"
        data-closing={closing || selfClosing ? 'true' : 'false'}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [closing, setClosing] = useState(false)
  const finish = (fn: () => void): void => {
    if (closing) return
    setClosing(true)
    setTimeout(fn, 160)
  }
  return (
    <Modal onClose={() => finish(onCancel)} closing={closing}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true">
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <Btn variant="secondary" onClick={() => finish(onCancel)}>
            取消
          </Btn>
          <Btn variant="danger" onClick={() => finish(onConfirm)}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * T49 退场窗口（ms）。刻意大于 CSS `el-toast-out` 的 `--duration-fast`（120ms）：
 * 动画播完由 `forwards` 定格末帧，余量防止计时器早于动画结束触发卸载造成"跳没"。
 * （Modal 同模式：遮罩关闭也是 JS 延时 160ms 配 `data-closing`。）
 */
const TOAST_EXIT_MS = 160

/**
 * 浮层提示（单条覆盖式；调用方负责 5s 清文案）。
 * T49 退场：`text` 变 `null` 时不直接卸载——先置 `data-closing='true'` 播 `el-toast-out`
 * 再延时卸载；退场窗口内新文案到达则取消卸载、立即复显新文案（不闪退、不重复挂载）。
 */
export function Toast({ text }: { text: string | null }) {
  const [shown, setShown] = useState<string | null>(text)
  const [closing, setClosing] = useState(false)
  const shownRef = useRef<string | null>(text)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  shownRef.current = shown

  useEffect(() => {
    if (text != null) {
      // 复显/换文案：取消待执行的退场卸载，立即显示新文案。
      if (exitTimer.current != null) {
        clearTimeout(exitTimer.current)
        exitTimer.current = null
      }
      setShown(text)
      setClosing(false)
      return
    }
    // 文案清空且有在播 Toast：进入退场态，动画播完再卸载（幂等：计时器在途不重复进）。
    if (shownRef.current != null && exitTimer.current == null) {
      setClosing(true)
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null
        setClosing(false)
        setShown(null)
      }, TOAST_EXIT_MS)
    }
  }, [text])

  useEffect(
    () => () => {
      if (exitTimer.current != null) clearTimeout(exitTimer.current)
    },
    []
  )

  if (shown == null) return null
  return (
    <div className="toast" role="status" data-closing={closing ? 'true' : 'false'}>
      {shown}
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}
