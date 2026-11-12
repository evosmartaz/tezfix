-- TezFiks database extras that Prisma cannot express. Plain SQL, Supabase-compatible (pg_trgm ships with Supabase).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Case- and diacritic-insensitive folding for Azerbaijani / Russian search.
-- Mirrors tzFold() in packages/shared/src/text.ts: I-variants become i BEFORE lower(), then letters are folded.
CREATE OR REPLACE FUNCTION tz_fold(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT btrim(translate(lower(translate(input, U&'\0130I\0131', 'iii')), U&'\0259\015F\00E7\011F\00F6\00FC\0451', U&'escgou\0435'))
$$;

CREATE INDEX IF NOT EXISTS users_name_fold_trgm
  ON users USING gin (tz_fold(coalesce("firstName", '') || ' ' || coalesce("lastName", '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_name_fold_trgm ON companies USING gin (tz_fold(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS categories_name_fold_trgm
  ON categories USING gin (tz_fold("nameAz" || ' ' || "nameRu" || ' ' || "nameEn") gin_trgm_ops);

-- Human-friendly numbers: requests start at #1000, projects at #100.
ALTER SEQUENCE service_requests_number_seq RESTART WITH 1000;
ALTER SEQUENCE projects_number_seq RESTART WITH 100;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1;

-- Double-entry guard: every ledger transaction must sum to zero at commit time.
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO s FROM ledger_entries WHERE "transactionId" = NEW."transactionId";
  IF s <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum=%)', NEW."transactionId", s;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Ledger entries are append-only; corrections are reversing transactions.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END $$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- At most one active request-fee hold per assignment and one active emergency hold per slot.
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_fee_per_assignment
  ON holds ("assignmentId") WHERE status = 'ACTIVE' AND kind = 'REQUEST_FEE';
CREATE UNIQUE INDEX IF NOT EXISTS holds_one_active_emergency_per_slot
  ON holds ("slotId") WHERE status = 'ACTIVE' AND kind = 'EMERGENCY_FEE';
-- At most one active (non-terminal) assignment per slot.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_one_active_per_slot
  ON assignments ("slotId") WHERE status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED', 'COMPLETED');
