// The web app's entry. The two faces and the tokens come first, from @household/tokens
// (ADR 0024), then the app's own ground; the display modes are on the root before anything is
// drawn, as the script in the page's head already put them (build/boot.ts). The catalog of the
// language the app starts in is fetched before a word is drawn: the app holds one language at a
// time (D-159, ADR 0026).
import '@household/tokens/fonts.css'
import '@household/tokens/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { App } from './app/App.tsx'
import { routes } from './app/routes.tsx'
import { applyPreferences, readPreferences } from './display/store.ts'
import { fetchCatalog } from './i18n/catalogs.ts'
import { initialLocale } from './i18n/locale.ts'

applyPreferences(document.documentElement, readPreferences())

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root to draw the app in')
const place = root

// Draws the app, once the catalog of its language has come. Where it has not, the page could not
// fetch a file of its own, as it could not have fetched this one: there is no word to say so in,
// and the page is loaded again when the connection is back and when it is looked at again. The
// page, and not the file alone: a browser keeps an import that failed (Chromium's module map),
// and answers the next import of the same file with that failure, asking the network nothing.
fetchCatalog(initialLocale()).then(
  () => {
    // Made here, once and outside React: a router listens to the browser's history from the
    // moment it is made (App.tsx).
    const router = createBrowserRouter(routes)
    createRoot(place).render(
      <StrictMode>
        <App router={router} />
      </StrictMode>,
    )
  },
  () => {
    const again = () => {
      if (document.visibilityState === 'visible') window.location.reload()
    }
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', again)
  },
)
