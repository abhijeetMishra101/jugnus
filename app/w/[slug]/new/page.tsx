import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { NewProjectForm } from './NewProjectForm'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function NewProjectPage({ params }: Props) {
  const { slug } = await params
  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces').select('id').eq('slug', slug).single()
  if (!workspace) notFound()

  return <NewProjectForm slug={slug} workspaceId={workspace.id} />
}
