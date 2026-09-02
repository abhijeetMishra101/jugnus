import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ProjectChannel } from '../../components/ProjectChannel'
import { JugnuPanel } from '../../components/JugnuPanel'
import { FilesPanel } from '../../components/FilesPanel'

interface Props {
  params: Promise<{ slug: string; projectId: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { slug, projectId } = await params
  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces').select('id, name, owner_id').eq('slug', slug).single()
  if (!workspace) notFound()

  const { data: project } = await db
    .from('projects').select('id, title, objective, status')
    .eq('id', projectId).eq('workspace_id', workspace.id).single()
  if (!project) notFound()

  const [messagesRes, tasksRes, jugnusRes, escalationsRes, filesRes] = await Promise.all([
    db.from('messages').select('id,project_id,author_type,author_key,content,created_at,metadata')
      .eq('project_id', projectId).order('created_at', { ascending: true }).limit(100),
    db.from('tasks').select('id,title,status,jugnu_key,sort_order')
      .eq('project_id', projectId).order('sort_order', { ascending: true }),
    db.from('jugnus').select('key,name,role,color,status')
      .eq('workspace_id', workspace.id),
    db.from('escalations').select('id,question,options')
      .eq('project_id', projectId).eq('status', 'pending'),
    db.from('file_snapshots').select('path,content,updated_at')
      .eq('project_id', projectId).order('path', { ascending: true }),
  ])

  const initialFiles = (filesRes.data ?? []) as { path: string; content: string; updated_at: string }[]

  return (
    <div className="flex h-full">
      {/* Channel */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="shrink-0 px-6 py-3 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm font-medium">#</span>
            <h1 className="text-sm font-semibold text-gray-900 truncate">{project.title}</h1>
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5 pl-4">{project.objective}</p>
        </header>
        <ProjectChannel
          projectId={projectId}
          userId={workspace.owner_id}
          initialMessages={(messagesRes.data ?? []) as Parameters<typeof ProjectChannel>[0]['initialMessages']}
          activeJugnuKey={(jugnusRes.data ?? []).find((j) => j.status === 'working')?.key ?? null}
        />
      </div>

      {/* Files panel */}
      <FilesPanel projectId={projectId} initialFiles={initialFiles} />

      {/* Right panel */}
      <JugnuPanel
        projectId={projectId}
        jugnus={(jugnusRes.data ?? []) as Parameters<typeof JugnuPanel>[0]['jugnus']}
        tasks={(tasksRes.data ?? []) as Parameters<typeof JugnuPanel>[0]['tasks']}
        escalations={(escalationsRes.data ?? []) as Parameters<typeof JugnuPanel>[0]['escalations']}
        onEscalationReply={async (escalationId: string, answer: string) => {
          'use server'
          const sdb = createServiceClient()
          await sdb.from('escalations').update({
            status: 'resolved', resolution: answer, resolved_at: new Date().toISOString(),
          }).eq('id', escalationId)
          await fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}` },
            body: JSON.stringify({ projectId, taskId: null, jugnuKey: 'maya' }),
          })
        }}
      />
    </div>
  )
}
