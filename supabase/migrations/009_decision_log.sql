-- decision_log: records every DecisionEngine decision for Jev shadow-mode analysis
create table if not exists decision_log (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid references projects(id) on delete cascade,
  task_id                 uuid references tasks(id) on delete set null,
  decision_type           text not null,
  deterministic_decision  text,
  jev_decision            text,
  jev_confidence          numeric,
  agreement               boolean,
  applied_decision        text not null,
  context                 jsonb not null default '{}',
  created_at              timestamptz not null default now()
);
create index if not exists decision_log_project on decision_log(project_id, created_at desc);
