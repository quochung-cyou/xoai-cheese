import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './magic-board/magic-board.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
