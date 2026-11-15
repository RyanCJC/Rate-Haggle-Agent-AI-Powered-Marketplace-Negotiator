alter table calendar_slots alter column negotiation_id drop not null;
alter table calendar_slots add column if not exists booking_key text;
alter table calendar_slots add column if not exists thread_id text;
create unique index if not exists calendar_slots_start_at_idx on calendar_slots (start_at);
create unique index if not exists calendar_slots_booking_key_idx
  on calendar_slots (booking_key) where booking_key is not null;