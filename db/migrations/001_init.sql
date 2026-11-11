create table if not exists users (
    id bigserial primary key,
    name text not null
);

create table if not exists user_prefs (
    id bigserial primary key,
    user_id bigint references users(id),
    key text,
    value text,
    unique (user_id, key)
);

create table if not exists listings (
    id bigserial primary key,
    title text,
    category text,
    asking_price numeric(10, 2),
    currency text default 'MYR',
    seller_note text,
    status text default 'active'
);

create table if not exists listing_facts (
    id bigserial primary key,
    listing_id bigint references listings(id),
    key text,
    value text,
    source text,
    status text check (status in ('confirmed', 'claimed', 'missing', 'conflicting')),
    evidence_ref text
);

create table if not exists negotiations (
    id bigserial primary key,
    user_id bigint references users(id),
    listing_id bigint references listings(id),
    state text default 'new',
    max_budget numeric(10, 2) not null,
    autonomy_level int default 1 check (autonomy_level in (1, 2)),
    created_at timestamptz default now()
);

create table if not exists messages (
    id bigserial primary key,
    negotiation_id bigint references negotiations(id),
    role text,
    text text,
    created_at timestamptz default now()
);

create table if not exists offers (
    id bigserial primary key,
    negotiation_id bigint references negotiations(id),
    price numeric(10, 2),
    by text,
    created_at timestamptz default now()
);

create table if not exists deals (
    id bigserial primary key,
    negotiation_id bigint references negotiations(id) unique,
    final_price numeric(10, 2),
    created_at timestamptz default now()
);

create table if not exists calendar_slots (
    id bigserial primary key,
    negotiation_id bigint references negotiations(id),
    start_at timestamptz not null unique
);

create table if not exists comparables (
    id bigserial primary key,
    category text,
    model text,
    condition text,
    price numeric(10, 2),
    observed_at date
);

create table if not exists traces (
    id bigserial primary key,
    negotiation_id bigint references negotiations(id),
    step int,
    kind text,
    payload jsonb,
    created_at timestamptz default now()
);

create table if not exists eval_scenarios (
    id bigserial primary key,
    name text unique,
    spec jsonb,
    split text check (split in ('dev', 'test'))
);

create table if not exists eval_runs (
    id bigserial primary key,
    config jsonb,
    created_at timestamptz default now()
);

create table if not exists eval_results (
    id bigserial primary key,
    run_id bigint references eval_runs(id),
    scenario_id bigint references eval_scenarios(id),
    policy text,
    metrics jsonb
);
