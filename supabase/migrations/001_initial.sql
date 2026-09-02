-- Jugnus — initial schema
-- One project = one channel. No per-role channels.
-- Tasks are dynamically created by Maya, not hardcoded stages.

create extension if not exists "pgcrypto";

-- ── Workspaces ───────────────────────────────────────────────────────────────

create table workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  owner_id      uuid not null,         -- references auth.users
  created_at    timestamptz not null default now()
);

-- ── GitHub App installations ──────────────────────────────────────────────────

create table github_installations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  installation_id text not null,
  repo_full_name  text not null,        -- "owner/repo"
  created_at      timestamptz not null default now(),
  unique(workspace_id, installation_id)
);

-- ── Jugnu registry ────────────────────────────────────────────────────────────
-- One row per jugnu type per workspace. Seeded on workspace creation.

create table jugnus (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  key           text not null,          -- 'maya' | 'leo' | 'nia' | 'tara'
  name          text not null,          -- 'Maya' | 'Leo' | 'Nia' | 'Tara'
  role          text not null,          -- 'Planner' | 'Builder' | 'Designer' | 'Reviewer'
  capabilities  text[] not null,        -- ['planning','task_graph'] etc
  color         text not null default '#6366f1',
  status        text not null default 'idle'
    check (status in ('idle', 'working', 'reviewing', 'blocked', 'done')),
  created_at    timestamptz not null default now(),
  unique(workspace_id, key)
);

-- ── Projects ──────────────────────────────────────────────────────────────────
-- One project per founder request. Replaces the features table.
-- Each project is its own channel — no separate channels table needed.

create table projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  title         text not null,
  objective     text not null,          -- founder's original request, verbatim
  constraints   jsonb not null default '{}',  -- { budget, timeline, stack, etc }
  status        text not null default 'active'
    check (status in ('active', 'planning', 'building', 'reviewing', 'completed', 'blocked', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
-- Created dynamically by Maya when a project starts.
-- Dependency-ordered; executor fires the next ready task automatically.

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  title         text not null,
  description   text not null,
  capability    text not null,          -- 'planning' | 'design' | 'build' | 'review'
  jugnu_key     text not null,          -- 'maya' | 'leo' | 'nia' | 'tara'
  depends_on    uuid[] not null default '{}',  -- task IDs that must complete first
  status        text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'blocked', 'skipped')),
  result        text,                   -- jugnu's output summary
  artifact      jsonb,                  -- { type: 'github_pr'|'mockup'|'adr', url, branch }
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

-- ── Messages ──────────────────────────────────────────────────────────────────
-- All messages in a project's channel — founder, jugnus, and system.

create table messages (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  author_type   text not null check (author_type in ('user', 'jugnu', 'system')),
  author_key    text not null,          -- jugnu key ('maya','leo'…) or user_id or 'system'
  content       text not null,
  task_id       uuid references tasks(id),   -- links message to the task it belongs to
  metadata      jsonb not null default '{}', -- { task_card: true, approval_required: true }
  created_at    timestamptz not null default now()
);

-- ── Escalations (human approval queue) ───────────────────────────────────────

create table escalations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  task_id       uuid references tasks(id),
  jugnu_key     text not null,
  question      text not null,          -- what Maya is asking
  options       jsonb,                  -- [{ label, value }] if choice-based
  status        text not null default 'pending'
    check (status in ('pending', 'resolved', 'dismissed')),
  resolution    text,                   -- founder's answer
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index on projects(workspace_id, status);
create index on tasks(project_id, status);
create index on tasks(project_id, sort_order);
create index on messages(project_id, created_at);
create index on escalations(project_id, status);

-- ── updated_at trigger ────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table workspaces         enable row level security;
alter table github_installations enable row level security;
alter table jugnus             enable row level security;
alter table projects           enable row level security;
alter table tasks              enable row level security;
alter table messages           enable row level security;
alter table escalations        enable row level security;

-- Service role bypasses RLS (used by jugnu dispatch and internal APIs).
-- Founder access policies added in migration 002 once auth is confirmed working.
