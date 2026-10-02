/**
 * TitleScreen（自 App.tsx 拆出；纯搬运，逻辑与语句顺序未改）。
 *
 * 来源：docs/APP-TSX-SPLIT-ASSESSMENT.md。
 * 原 App.tsx 行号：789-807。
 */
import { APP_NAME, formatAppVersion, type AppInfo } from '@shared/appInfo'
import iconUrl from '../assets/icon.ico'
import {
  
  Btn
} from '../ui'

export function TitleScreen({ info, onEnter }: { info: AppInfo | null; onEnter: () => void }) {
  return (
    <div className="title-screen">
      <div className="wallpaper" />
      <div className="title-body">
        {/* 产品图标（用户要求：启动页产品名旁） */}
        <img className="title-icon" src={iconUrl} alt="" aria-hidden="true" />
        <span className="title-name">{APP_NAME}</span>
        <span className="title-version">{info ? formatAppVersion(info.version) : ''}</span>
        <Btn
          variant="primary"
          className="title-enter btn-lg"
          data-testid="title-enter"
          onClick={onEnter}
        >
          进入
        </Btn>
      </div>
    </div>
  )
}
