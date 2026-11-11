create extension if not exists vector;

create table if not exists listing_chunks (
    id bigserial primary key,
    listing_id bigint references listings(id),
    text text not null,
    embedding vector(384)
);
