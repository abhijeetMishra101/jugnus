import { NextResponse } from 'next/server'

export const maxDuration = 60

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

  const { url, htmlContent, actions = [], returnScreenshot = false } = await request.json() as {
    url?: string
    htmlContent?: string
    actions?: BrowserAction[]
    returnScreenshot?: boolean
  }

  if (!url && !htmlContent) {
    return NextResponse.json({ ok: false, error: 'url or htmlContent is required' }, { status: 400 })
  }

  let chromium: typeof import('@sparticuz/chromium').default
  let puppeteer: typeof import('puppeteer-core')

  try {
    const [chromiumMod, puppeteerMod] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ])
    chromium = chromiumMod.default
    puppeteer = puppeteerMod
  } catch (importErr) {
    console.error('[browser-test] import failed:', importErr)
    return NextResponse.json({
      ok: false,
      available: false,
      error: `Browser dependencies not available: ${String(importErr)}`,
    })
  }

  let executablePath: string
  try {
    executablePath = await chromium.executablePath()
  } catch (e) {
    console.error('[browser-test] chromium.executablePath() failed:', e)
    return NextResponse.json({
      ok: false,
      available: false,
      error: `Chromium executable not found: ${String(e)}`,
    })
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  }).catch((e: unknown) => {
    throw new Error(`Failed to launch browser: ${String(e)}`)
  })

  try {
    const page = await browser.newPage()

    const consoleErrors: string[] = []
    const consoleWarnings: string[] = []
    page.on('console', (msg) => {
      const t = msg.type()
      if (t === 'error')   consoleErrors.push(msg.text())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((t as any) === 'warning') consoleWarnings.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    if (htmlContent) {
      await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 15000 })
    } else {
      await page.goto(url!, { waitUntil: 'networkidle2', timeout: 15000 })
    }

    // Wait for JS frameworks to render (React CDN needs a tick after networkidle)
    await new Promise(r => setTimeout(r, 1500))

    const blankScreen = await page.evaluate(() => {
      const root = document.getElementById('root') ?? document.getElementById('app') ?? document.body
      return root.children.length === 0 && (root.textContent ?? '').trim().length === 0
    })

    const pageTitle = await page.title()
    const pageTextPreview = await page.evaluate(() =>
      ((document.body as HTMLElement).innerText ?? '').slice(0, 600)
    )

    const actionResults: ActionResult[] = []
    for (const action of actions) {
      try {
        if (action.type === 'fill') {
          await page.type(action.selector, action.value)
          actionResults.push({ action: `fill ${action.selector}`, passed: true })
        } else if (action.type === 'click') {
          await page.click(action.selector)
          await new Promise(r => setTimeout(r, 600))
          actionResults.push({ action: `click ${action.selector}`, passed: true })
        } else if (action.type === 'select') {
          await page.select(action.selector, action.value)
          actionResults.push({ action: `select ${action.selector}=${action.value}`, passed: true })
        } else if (action.type === 'wait') {
          await new Promise(r => setTimeout(r, action.ms ?? 1000))
          actionResults.push({ action: `wait ${action.ms}ms`, passed: true })
        } else if (action.type === 'reload') {
          await page.reload({ waitUntil: 'networkidle2', timeout: 10000 })
          await new Promise(r => setTimeout(r, 1500))
          actionResults.push({ action: 'reload', passed: true })
        } else if (action.type === 'check_text') {
          const found = await page.evaluate(
            (text: string) => (document.body as HTMLElement).innerText.includes(text),
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
          action: `${action.type} ${'selector' in action ? action.selector : ''}`,
          passed: false,
          error: String(e),
        })
      }
    }

    const allActionsPassed = actionResults.every((r) => r.passed)

    let screenshot: string | undefined
    if (returnScreenshot) {
      const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false }) as Buffer
      screenshot = buf.toString('base64')
    }

    return NextResponse.json({
      ok: !blankScreen && consoleErrors.length === 0 && allActionsPassed,
      available: true,
      loaded: !blankScreen,
      blank_screen: blankScreen,
      page_title: pageTitle,
      page_text_preview: pageTextPreview,
      console_errors: consoleErrors,
      console_warnings: consoleWarnings,
      action_results: actionResults,
      ...(screenshot ? { screenshot } : {}),
    })
  } finally {
    await browser.close()
  }
}
