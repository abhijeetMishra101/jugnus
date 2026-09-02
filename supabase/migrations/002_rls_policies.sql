-- RLS policies for Jugnus
-- Service role bypasses all RLS (used by internal APIs)
-- Anon client (Supabase Realtime, browser) subject to these policies

-- workspaces: owner can read their own workspace
create policy "workspace owner read"
  on workspaces for select
  using (owner_id = auth.uid());

create policy "workspace owner update"
  on workspaces for update
  using (owner_id = auth.uid());

-- projects: workspace members can read; service role writes
create policy "project workspace member read"
  on projects for select
  using (
    workspace_id in (
      select id from workspaces where owner_id = auth.uid()
    )
  );

-- tasks: readable if user owns the parent workspace
create policy "task workspace member read"
  on tasks for select
  using (
    project_id in (
      select p.id from projects p
      join workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- messages: readable if user owns the parent workspace
create policy "message workspace member read"
  on messages for select
  using (
    project_id in (
      select p.id from projects p
      join workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- messages: founder can insert their own messages (author = 'founder')
create policy "message founder insert"
  on messages for insert
  with check (
    author_key = 'founder'
    and project_id in (
      select p.id from projects p
      join workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- escalations: readable if user owns the parent workspace
create policy "escalation workspace member read"
  on escalations for select
  using (
    project_id in (
      select p.id from projects p
      join workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- jugnus roster: readable if user owns the workspace
create policy "jugnu workspace member read"
  on jugnus for select
  using (
    workspace_id in (
      select id from workspaces where owner_id = auth.uid()
    )
  );

-- github_installations: readable if user owns the workspace
create policy "github installation workspace member read"
  on github_installations for select
  using (
    workspace_id in (
      select id from workspaces where owner_id = auth.uid()
    )
  );
