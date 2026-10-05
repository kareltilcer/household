// The script that puts a member's display modes on the root before the first paint. Without it a
// member who chose the dark theme would see a light page until the app's own script had run. It is
// a file of its own, loaded by a classic <script src> in the head, because the policy admits no
// inline script (csp.ts), and it is generated from the app's own statement of the modes
// (src/display/modes.ts), which a test holds it to: the app sets the same attributes again when it
// starts, by the same rules.
import { storageKey, written } from '../src/display/modes.ts'

/**
 * The script's source. It reads what `parsePreferences` reads and writes what `attributesOf`
 * writes, in the ES5 a classic script may be: a value that is not one of its mode's, or storage
 * that cannot be read at all, leaves the root as the stylesheet's defaults draw it.
 */
export function bootScript(): string {
  return (
    '(function(){try{' +
    `var s=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||"{}")||{},` +
    `w=${JSON.stringify(written)},e=document.documentElement,k;` +
    'for(k in w)if(typeof s[k]==="string"&&w[k].indexOf(s[k])>=0)e.setAttribute("data-"+k,s[k])' +
    '}catch(_){}})()\n'
  )
}
