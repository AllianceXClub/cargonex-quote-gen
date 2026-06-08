-- Migration: add signer_role to quote_signatures
-- PRD v1.3 — Section 5.2: capture role/title (תפקיד מורשה החתימה)
-- Run: supabase db push  OR  paste in Supabase SQL Editor

ALTER TABLE quote_signatures
  ADD COLUMN IF NOT EXISTS signer_role TEXT;
