create table if not exists knowledge_chunks (
  id bigserial primary key,
  category text not null,
  source text not null,
  chunk_index int not null,
  text text not null,
  embedding vector(384) not null,
  embedder text not null,
  unique (source, chunk_index, embedder)
);

alter table knowledge_chunks enable row level security;