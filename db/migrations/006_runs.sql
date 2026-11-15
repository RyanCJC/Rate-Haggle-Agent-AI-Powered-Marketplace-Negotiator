create table if not exists runs (
  id text primary key,
  config jsonb not null,
  created_at timestamptz not null default now()
);
alter table runs enable row level security;