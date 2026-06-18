-- Migration: add signer_phone to quote_signatures
-- Applied directly to remote DB on 2026-05-28
-- Created retroactively to sync local migration history

ALTER TABLE quote_signatures
  ADD COLUMN IF NOT EXISTS signer_phone TEXT;
