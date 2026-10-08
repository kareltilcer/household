// The Content-Security-Policy (PRD 07 §4, build/csp.ts) on a served page: it is there, it is the
// strict one, and it is in force. Every other test of the suite fails on a violation (fixtures.ts);
// this one provokes two, to show that the policy refuses them and that the suite would hear it.
import { headerPolicyFor, metaPolicyFor, unsafeSources } from '../build/csp.ts'
import { deployment } from '../build/deployment.ts'
import { paths } from '../src/app/paths.ts'
import { expect, open, test } from './fixtures.ts'

// The build the suite runs against reaches the development stack's sync service and its object
// store (vite.config.ts), unless this environment names others.
const deployed = deployment(true)
const headerPolicy = headerPolicyFor(deployed)
const metaPolicy = metaPolicyFor(deployed)

test('a page is served under the strict policy, and carries it itself', async ({ page }) => {
  const response = await page.goto(paths.home.example)
  expect(response?.headers()['content-security-policy']).toBe(headerPolicy)
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    metaPolicy,
  )
  for (const source of unsafeSources) expect(headerPolicy).not.toContain(source)
})

test('the policy refuses an inline style and an inline script, and the suite hears it', async ({
  page,
  faults,
}) => {
  await open(page, paths.home.example)
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = 'body { outline: 4px solid }'
    document.head.append(style)
    const script = document.createElement('script')
    script.textContent = 'document.documentElement.setAttribute("data-ran", "")'
    document.head.append(script)
  })
  // Each is refused twice over, by the page's own policy and by the header's, which agree.
  const refused = () => [
    ...new Set(faults.filter((fault) => fault.startsWith('Content-Security-Policy:'))),
  ]
  await expect
    .poll(refused)
    .toEqual([
      'Content-Security-Policy: style-src-elem refused inline',
      'Content-Security-Policy: script-src-elem refused inline',
    ])
  await expect(page.locator('html')).not.toHaveAttribute('data-ran')
  expect(await page.evaluate(() => window.getComputedStyle(document.body).outlineStyle)).toBe(
    'none',
  )
  // Provoked on purpose: they are what this test is for, and not the page's own doing.
  faults.length = 0
})
