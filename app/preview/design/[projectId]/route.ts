import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /preview/design/[projectId]
 * Serves Nia's design artifact. Priority:
 * 1. design/assembled.html — if it contains inline screen content (no iframes)
 * 2. Auto-assembled view — built from all design/screen-*.html files Nia wrote
 * 3. Any other design/*.html file (legacy fallback)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const db = createServiceClient()

  const { data: files } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', projectId)
    .ilike('path', 'design/%.html')
    .order('path', { ascending: true })

  if (!files || files.length === 0) {
    return new NextResponse('No design preview available yet.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Use assembled.html only if it has inline content, not just iframes
  const assembled = files.find((f) => f.path === 'design/assembled.html')
  if (assembled && !/<iframe/i.test(assembled.content)) {
    return new NextResponse(assembled.content, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // Auto-assemble from individual screen files Nia wrote
  const screenFiles = files
    .filter((f) => f.path !== 'design/assembled.html' && f.path !== 'design/mockup.html')
    .sort((a, b) => a.path.localeCompare(b.path))

  if (screenFiles.length > 0) {
    const screens = screenFiles.map((f) => {
      const name = f.path
        .replace('design/', '')
        .replace(/\.html$/, '')
        .replace(/^screen-\d+-/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase())

      // Extract just the <body> content if present, otherwise use full content
      const bodyMatch = f.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
      const inner = bodyMatch ? bodyMatch[1] : f.content

      return `
        <div class="screen-block">
          <div class="screen-label">${name}</div>
          <div class="phone-frame">
            <div class="screen-inner">${inner}</div>
          </div>
        </div>`
    }).join('\n')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Design Preview</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F0EDE8; font-family: -apple-system, sans-serif; padding: 40px 20px; }
    .screens-grid { display: flex; flex-wrap: wrap; gap: 40px; justify-content: center; }
    .screen-block { display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .screen-label {
      font-weight: 700; font-size: 0.85rem; color: #555;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .phone-frame {
      width: 390px; min-height: 844px;
      background: white; border-radius: 40px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.18);
      overflow: hidden; position: relative;
    }
    .screen-inner { width: 100%; min-height: 844px; }
  </style>
</head>
<body>
  <div class="screens-grid">
${screens}
  </div>
</body>
</html>`

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // Final fallback: assembled.html even if it has iframes (better than nothing)
  const fallback = assembled ?? files[0]
  return new NextResponse(fallback.content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
