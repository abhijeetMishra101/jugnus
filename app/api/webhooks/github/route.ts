import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/github/operations'

// GitHub webhook receiver — kept for App installation events.
// Build/review pipeline no longer uses GitHub: Leo writes files to
// file_snapshots and Tara reviews inline. This endpoint acks all events.
export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer())
  const signature = request.headers.get('x-hub-signature-256')

  if (!await verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
