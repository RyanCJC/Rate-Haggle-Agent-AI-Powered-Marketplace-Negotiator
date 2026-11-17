create table if not exists profiles (
  id text primary key,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists past_deals (
  id bigserial primary key,
  profile_id text not null references profiles(id) on delete cascade,
  run_id text not null,
  item_title text not null default '',
  category text,
  asking numeric(10, 2) not null,
  final_price numeric(10, 2),
  outcome text not null,
  mode text not null,
  rounds int not null default 0,
  embedding vector(384) not null,
  embedder text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, run_id)
);

create index if not exists past_deals_profile_idx on past_deals (profile_id, created_at desc);

alter table profiles enable row level security;
alter table past_deals enable row level security;