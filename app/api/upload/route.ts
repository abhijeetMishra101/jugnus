import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const BUCKET = 'project-attachments'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const TEXT_MIME_PREFIXES = ['text/', 'application/json']
const IMAGE_MIME_PREFIXES = ['image/']

function isText(mime: string) {
  return TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))
}
function isImage(mime: string) {
  return IMAGE_MIME_PREFIXES.some((p) => mime.startsWith(p))
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null

  if (!file || !projectId) {
    return NextResponse.json({ error: 'file and projectId required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })
  }

  const db = createServiceClient()
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${projectId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const bytes = await file.arrayBuffer()
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path)

  // For text/code files, extract content so jugnus can read it
  let textContent: string | null = null
  if (isText(file.type) || (!isImage(file.type) && ext && ['ts','tsx','js','jsx','json','md','txt','html','css','py','sql'].includes(ext))) {
    const decoder = new TextDecoder('utf-8')
    textContent = decoder.decode(bytes).slice(0, 20_000) // cap at 20k chars
  }

  return NextResponse.json({
    url: publicUrl,
    name: file.name,
    type: file.type,
    size: file.size,
    isImage: isImage(file.type),
    textContent,
  })
}
