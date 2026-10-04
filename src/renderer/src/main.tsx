import React from 'react'
import ReactDOM from 'react-dom/client'
import { Welcome } from './screens/Welcome'
import App from './App'
import { MiniControl } from './screens/MiniControl'
import './renderer.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* T43 增量 2：`#mini` 由内置迷你中控悬浮窗加载（同一 bundle，独立窗口） */}
    {window.location.hash === '#mini' ? <MiniControl /> : <>
        <App />
        <Welcome />
      </>}
  </React.StrictMode>
)
