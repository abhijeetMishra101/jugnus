import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'

async function getProjectOwnerEmail(projectId: string, db: SupabaseClient): Promise<{ email: string; projectTitle: string } | null> {
  try {
    const { data: project } = await db.from('projects').select('title, workspace_id').eq('id', projectId).single()
    if (!project?.workspace_id) return null
    const { data: workspace } = await db.from('workspaces').select('owner_id').eq('id', project.workspace_id as string).single()
    if (!workspace?.owner_id) return null
    const { data: { user } } = await db.auth.admin.getUserById(workspace.owner_id as string)
    if (!user?.email) return null
    return { email: user.email, projectTitle: (project.title as string) ?? 'your project' }
  } catch {
    return null
  }
}

export async function sendPipelineEmail(
  projectId: string,
  event: 'human_gate' | 'project_complete',
  db: SupabaseClient,
  opts?: { previewUrl?: string }
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const owner = await getProjectOwnerEmail(projectId, db)
  if (!owner) return

  const resend = new Resend(apiKey)
  const from = process.env.RESEND_FROM_EMAIL ?? 'Jugnus <noreply@jugnus.app>'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://jugnus.vercel.app'
  const projectUrl = `${appUrl}/w/${projectId}`
  const title = owner.projectTitle.slice(0, 60)

  if (event === 'human_gate') {
    await resend.emails.send({
      from,
      to: owner.email,
      subject: '👀 Your design is ready for review — Jugnus',
      html: `<p>Hi,</p>
<p>Nia just finished designing <strong>${title}</strong>. Your approval is needed before Leo starts building.</p>
<p><a href="${projectUrl}" style="background:#4f46e5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:8px 0">Review Design →</a></p>
<p style="color:#6b7280;font-size:12px">Jugnus · You're receiving this because a project is waiting for your input.</p>`,
    }).catch(() => {})
    return
  }

  const previewBtn = opts?.previewUrl
    ? `<p><a href="${opts.previewUrl}" style="background:#059669;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:8px 0">View Your App →</a></p>`
    : ''

  await resend.emails.send({
    from,
    to: owner.email,
    subject: `🎉 Your project is complete — ${title}`,
    html: `<p>Hi,</p>
<p>Your jugnus finished building <strong>${title}</strong>. Everything passed review and is ready.</p>
${previewBtn}
<p><a href="${projectUrl}" style="color:#4f46e5">Open project →</a></p>
<p style="color:#6b7280;font-size:12px">Jugnus · You're receiving this because your project just completed.</p>`,
  }).catch(() => {})
}
