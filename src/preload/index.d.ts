import type { EclipseLiveApi } from './index'

declare global {
  interface Window {
    eclipselive: EclipseLiveApi
  }
}

export {}
