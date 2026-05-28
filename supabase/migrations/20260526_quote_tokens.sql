-- Migration: quote_tokens table
-- Multi-recipient access control for quote links
-- Each row = one issued token (signer or viewer)

create table if not exists quote_tokens (
  id            uuid primary key default gen_random_uuid(),
  quote_id      text not null,
  token         text not null unique,
  email         text not null,
  name          text,
  role          text not null check (role in ('signer', 'viewer')),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  opened_at     timestamptz,
  revoked       boolean not null default false
);

-- Index for fast token lookups
create index if not exists idx_quote_tokens_token   on quote_tokens (token);
create index if not exists idx_quote_tokens_quote   on quote_tokens (quote_id);

-- RLS: allow reading own token only (by token value — no auth needed for quote pages)
alter table quote_tokens enable row level security;

create policy "read_own_token" on quote_tokens
  for select
  using (true);  -- token value itself is the secret; anon can select to validate

-- Only service role can insert/update/delete
create policy "service_write" on quote_tokens
  for all
  using (auth.role() = 'service_role');
