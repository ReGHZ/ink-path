-- Migration 1/3: PostgreSQL extensions.
-- citext wajib aktif sebelum tabel users dibuat (email/username memakai @db.Citext).
-- IF NOT EXISTS → idempotent.
CREATE EXTENSION IF NOT EXISTS citext;
