/**
 * T16 设置框架：设置界面 6 组元数据（渲染与单测共用）。
 * 顺序即规格顺序（PRODUCT.md「设置界面（按分组整理）」）；
 * 尚未实装项的归属卡片见各组 description 与 App.tsx 占位标注。
 */

export interface SettingsGroupMeta {
  id: string
  title: string
  description: string
}

export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  {
    id: 'appearance',
    title: '外观',
    description: '主题模式、强调色、材质档位、全局底图、减少透明度 / 高对比度 / 减少动态效果'
  },
  {
    id: 'features',
    title: '功能',
    description: '托盘与关闭行为、检查更新（默认关闭）'
  },
  {
    id: 'modules',
    title: '模块',
    description: '安装 / 导入 / 启停 / 卸载 / 打开关闭网页工具 / 导出样式包，权限查看与撤销、恢复预设'
  },
  {
    id: 'connection',
    title: '连接',
    description: 'OBS WebSocket 参数、本机服务信息'
  },
  {
    id: 'diagnostics',
    title: '诊断',
    description: '服务探活、日志查看、诊断包导出'
  },
  {
    id: 'advanced',
    title: '高级',
    description:
      '配置导入导出、缓存清理、模块崩溃自动重启——此三项为新功能，排独立小卡，在 UI 卡之后实施'
  }
]
