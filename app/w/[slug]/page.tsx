import { createServiceClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

interface Props {
  params: Promise<{ slug: string }>
}

const STATUS_COLOR: Record<string, string> = {
  planning:  'bg-amber-100 text-amber-700',
  building:  'bg-indigo-100 text-indigo-700',
  reviewing: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-emerald-100 text-emerald-700',
  blocked:   'bg-red-100 text-red-700',
  active:    'bg-gray-100 text-gray-600',
}

export default async function WorkspacePage({ params }: Props) {
  const { slug } = await params
  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces')
    .select('id, name, owner_id')
    .eq('slug', slug)
    .single()
  if (!workspace) notFound()

  const { data: projects } = await db
    .from('projects')
    .select('id, title, objective, status, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  // Redirect to most recent active project if any
  const active = (projects ?? []).find((p) => p.status === 'building' || p.status === 'planning')
  if (active) redirect(`/w/${slug}/p/${active.id}`)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">{workspace.name}</h1>
          <p className="text-sm text-gray-500">Tell your jugnus what you want done.</p>
        </div>

        {/* New project input */}
        <NewProjectForm workspaceId={workspace.id} slug={slug} />

        {/* Past projects */}
        {(projects?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Past Projects</h2>
            {projects!.map((p) => (
              <Link key={p.id} href={`/w/${slug}/p/${p.id}`}
                className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-300 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                    <p className="text-xs text-gray-400 truncate">{p.objective}</p>
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[p.status] ?? STATUS_COLOR.active}`}>
                    {p.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NewProjectForm({ workspaceId, slug }: { workspaceId: string; slug: string }) {
  async function createProject(formData: FormData) {
    'use server'
    const objective = formData.get('objective') as string
    if (!objective?.trim()) return
    const res = await fetch(new URL(`/api/projects`, process.env.NEXT_PUBLIC_APP_URL!).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, objective }),
    })
    const { id } = await res.json()
    redirect(`/w/${slug}/p/${id}`)
  }

  return (
    <form action={createProject} className="space-y-3">
      <textarea
        name="objective"
        rows={3}
        placeholder="What do you want to build? e.g. &quot;Add a dark mode toggle to the app&quot;"
        className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-indigo-500 resize-none transition-colors"
        required
      />
      <button
        type="submit"
        className="w-full py-2.5 text-sm font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
      >
        ✨ Assemble your jugnus
      </button>
    </form>
  )
}
