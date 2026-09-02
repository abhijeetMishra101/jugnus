-- File snapshots — jugnus write files here instead of GitHub
-- Upsert on (project_id, path) keeps the latest version of each file

create table file_snapshots (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  task_id       uuid references tasks(id),
  path          text not null,
  content       text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(project_id, path)
);

create index on file_snapshots(project_id);

create trigger file_snapshots_updated_at
  before update on file_snapshots
  for each row execute function set_updated_at();

-- Grant access (same as other tables)
alter table file_snapshots enable row level security;

grant all on file_snapshots to service_role, authenticated, anon;

create policy "file workspace member read"
  on file_snapshots for select
  using (
    project_id in (
      select p.id from projects p
      join workspaces w on w.id = p.workspace_id
      where w.owner_id = auth.uid()
    )
  );
