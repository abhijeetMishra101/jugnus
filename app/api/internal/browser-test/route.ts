import { NextResponse } from 'next/server'

export const maxDuration = 45

type BrowserAction =
  | { type: 'fill';       selector: string; value: string }
  | { type: 'click';      selector: string }
  | { type: 'select';     selector: string; value: string }
  | { type: 'wait';       ms: number }
  | { type: 'reload' }
  | { type: 'check_text'; value: string }

interface ActionResult {
  action: string
  passed: boolean
  error?: string
}

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { url, actions = [] } = await request.json() as { url: string; actions?: BrowserAction[] }

  if (!url) {
    return NextResponse.json({ ok: false, error: 'url is required' }, { status: 400 })
  }

  let chromium: typeof import('@sparticuz/chromium').default
  let pw: typeof import('playwright-core')

  try {
    const [chromiumMod, playwrightMod] = await Promise.all([
      import('@sparticuz/chromium'),
      import('playwright-core'),
    ])
    chromium = chromiumMod.default
    pw = playwrightMod
  } catch {
    return NextResponse.json({
      ok: false,
      available: false,
      error: 'Playwright/Chromium not available in this environment.',
    })
  }

  const browser = await pw.chromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  }).catch((e: unknown) => {
    throw new Error(`Failed to launch browser: ${String(e)}`)
  })

  try {
    const page = await browser.newPage()

    const consoleErrors: string[] = []
    const consoleWarnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error')   consoleErrors.push(msg.text())
      if (msg.type() === 'warning') consoleWarnings.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })

    // Wait for JS frameworks to render (React CDN needs a tick after networkidle)
    await page.waitForTimeout(1500)

    const blankScreen = await page.evaluate(() => {
      const root = document.getElementById('root') ?? document.body
      return root.children.length === 0 && (root.textContent ?? '').trim().length === 0
    })

    const pageTitle = await page.title()
    const pageTextPreview = await page.evaluate(() =>
      (document.body.innerText ?? '').slice(0, 600)
    )

    const actionResults: ActionResult[] = []
    for (const action of actions) {
      try {
        if (action.type === 'fill') {
          await page.fill(action.selector, action.value, { timeout: 5000 })
          actionResults.push({ action: `fill ${action.selector}`, passed: true })
        } else if (action.type === 'click') {
          await page.click(action.selector, { timeout: 5000 })
          await page.waitForTimeout(600)
          actionResults.push({ action: `click ${action.selector}`, passed: true })
        } else if (action.type === 'select') {
          await page.selectOption(action.selector, action.value, { timeout: 5000 })
          actionResults.push({ action: `select ${action.selector}=${action.value}`, passed: true })
        } else if (action.type === 'wait') {
          await page.waitForTimeout(action.ms ?? 1000)
          actionResults.push({ action: `wait ${action.ms}ms`, passed: true })
        } else if (action.type === 'reload') {
          await page.reload({ waitUntil: 'networkidle', timeout: 10000 })
          await page.waitForTimeout(1500)
          actionResults.push({ action: 'reload', passed: true })
        } else if (action.type === 'check_text') {
          const found = await page.evaluate(
            (text: string) => document.body.innerText.includes(text),
            action.value
          )
          actionResults.push({
            action: `check_text "${action.value}"`,
            passed: found,
            error: found ? undefined : `Text "${action.value}" not found on page`,
          })
        }
      } catch (e) {
        actionResults.push({
          action: `${action.type} ${('selector' in action ? action.selector : '')}`,
          passed: false,
          error: String(e),
        })
      }
    }

    const allActionsPassed = actionResults.every((r) => r.passed)

    return NextResponse.json({
      ok: !blankScreen && consoleErrors.length === 0 && allActionsPassed,
      loaded: !blankScreen,
      blank_screen: blankScreen,
      page_title: pageTitle,
      page_text_preview: pageTextPreview,
      console_errors: consoleErrors,
      console_warnings: consoleWarnings,
      action_results: actionResults,
    })
  } finally {
    await browser.close()
  }
}
