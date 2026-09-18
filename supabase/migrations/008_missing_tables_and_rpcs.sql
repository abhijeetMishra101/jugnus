-- project_data: backing store for /api/data/[projectId]/[collection]
create table if not exists project_data (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  collection  text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists project_data_project_collection on project_data(project_id, collection);

-- form_submissions: backing store for /api/collect/[projectId]
create table if not exists form_submissions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  form_key    text not null default 'default',
  data        jsonb not null default '{}',
  submitted_at timestamptz not null default now()
);
create index if not exists form_submissions_project on form_submissions(project_id, submitted_at desc);

-- increment_project_cost: atomic cost accumulation without read-modify-write race
create or replace function increment_project_cost(p_project_id uuid, p_cost numeric)
returns void language sql as $$
  update projects
  set total_cost_usd = coalesce(total_cost_usd, 0) + p_cost
  where id = p_project_id;
$$;

-- get_stuck_tasks: activity-based stuck detection for watchdog
-- A task is "stuck" if it has been in_progress AND had no message or file_snapshot activity
-- in the last p_activity_minutes minutes, OR has been in_progress longer than p_hard_cutoff.
create or replace function get_stuck_tasks(
  p_activity_cutoff timestamptz,
  p_hard_cutoff     timestamptz
)
returns table (
  id               uuid,
  project_id       uuid,
  jugnu_key        text,
  title            text,
  retry_count      int,
  last_activity_at timestamptz
)
language sql stable as $$
  select
    t.id,
    t.project_id,
    t.jugnu_key,
    t.title,
    coalesce(t.retry_count, 0) as retry_count,
    greatest(
      max(m.created_at),
      max(fs.updated_at)
    ) as last_activity_at
  from tasks t
  left join messages m
    on m.project_id = t.project_id
    and m.created_at > t.started_at
  left join file_snapshots fs
    on fs.project_id = t.project_id
    and fs.updated_at > t.started_at
  where
    t.status = 'in_progress'
    and t.jugnu_key != 'human'
    and t.started_at is not null
  group by t.id, t.project_id, t.jugnu_key, t.title, t.retry_count, t.started_at
  having
    -- No activity in the threshold window
    (greatest(max(m.created_at), max(fs.updated_at)) < p_activity_cutoff
      or (max(m.created_at) is null and max(fs.updated_at) is null))
    -- OR hard cap exceeded regardless of activity
    or t.started_at < p_hard_cutoff;
$$;
