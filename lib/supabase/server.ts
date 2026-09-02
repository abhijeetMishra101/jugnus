import { createClient } from '@supabase/supabase-js'

// Fallback URL is safe — NEXT_PUBLIC_ vars are already browser-visible
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'https://rtihiqafvayuiqusrajr.supabase.co'

export function createServiceClient() {
  const url = SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}
