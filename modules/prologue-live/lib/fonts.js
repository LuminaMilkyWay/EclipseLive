'use strict'

/**
 * Windows 常用字体白名单（C4 降级方案：白名单 + 手输兜底，零核心改动）。
 *
 * 控制页以 <datalist> 提示这些字体（经 /state 下发，单一来源）；fontFamily
 * 校验只要求非空字符串——用户手输任意字体名均放行，白名单只是 UI 便利。
 * CSS 侧以 local() 字体栈生效（页面内联，无系统字体枚举 API）。
 */

const FONT_WHITELIST = [
  // 中文
  'Microsoft YaHei', // 微软雅黑
  'Microsoft YaHei UI',
  'Microsoft JhengHei', // 微软正黑体
  'DengXian', // 等线
  'SimSun', // 宋体
  'NSimSun',
  'SimHei', // 黑体
  'KaiTi', // 楷体
  'FangSong', // 仿宋
  'STSong', // 华文宋体
  'STKaiti', // 华文楷体
  'STHeiti', // 华文黑体
  'YouYuan', // 幼圆
  'LiSu', // 隶书
  // 西文
  'Segoe UI',
  'Segoe UI Light',
  'Segoe UI Semibold',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
  'Lucida Console'
]

module.exports = { FONT_WHITELIST }
