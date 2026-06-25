-- Migration: add counter-signature columns to quote_signatures
-- Phase 3: CS (Counter-Signature) flow

ALTER TABLE quote_signatures
  ADD COLUMN IF NOT EXISTS countersigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS countersigner_name TEXT,
  ADD COLUMN IF NOT EXISTS countersigner_role TEXT,
  ADD COLUMN IF NOT EXISTS countersign_sig_b64 TEXT,
  ADD COLUMN IF NOT EXISTS countersign_pdf_url TEXT;
