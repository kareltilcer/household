// The web app's entry (plan item 24). The two faces and the tokens come first, from
// @household/tokens (ADR 0024), then the app's own ground; the display modes are on the root
// before anything is drawn, as the script in the page's head already put them (build/boot.ts).
import '@household/tokens/fonts.css'
import '@household/tokens/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { applyPreferences, readPreferences } from './display/store.ts'

applyPreferences(document.documentElement, readPreferences())

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to draw the app in')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
