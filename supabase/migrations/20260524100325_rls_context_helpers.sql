-- Phase 11 Unit 65: RLS context helper functions.
--
-- Phase 12 RLS policies need a stable contract for asking
-- 'who is the caller, which tenant do they own, are they a
-- super admin?'. Without these, every policy would have to
-- re-parse JWT claims and re-join tenant_members - both
-- expensive and inconsistent.
--
-- All six helpers are STABLE so the planner caches their
-- value within a single query, and they prefer JWT claims
-- (Supabase Auth path) but fall back to app.* GUCs (service
-- jobs, RPC paths, tests). This dual-path keeps tests
-- portable without weakening prod security.
--
-- current_tenant_id(): NULL when no tenant context. Phase
-- 12 RLS policies use this as the tenant-scope predicate.
--
-- current_user_id(): NULL when anonymous; otherwise a uuid.
--
-- current_user_type(): one of seven authoritative values
-- including 'anonymous'; unknown values are coerced to
-- 'anonymous' rather than NULL to keep RLS evaluation
-- closed-by-default.
--
-- is_super_admin(): SECURITY DEFINER so policies can call
-- it without granting select on super_admins. Returns FALSE
-- for deactivated super_admins.
--
-- is_tenant_member(p_tenant_id): membership-scoped variant.
-- Returns FALSE for revoked members. The most common
-- predicate in Phase 12 policies.
--
-- is_authenticated(): convenience wrapper. SQL-language so
-- the planner can inline it into policies.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_raw text;
  v_uuid uuid;
BEGIN
  v_raw := current_setting('request.jwt.claim.tenant_id', true);
  IF v_raw IS NULL OR v_raw = '' THEN
    v_raw := current_setting('app.tenant_id', true);
  END IF;
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_uuid := v_raw::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN v_uuid;
END;
$body$;

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_raw text;
  v_uuid uuid;
BEGIN
  v_raw := current_setting('request.jwt.claim.sub', true);
  IF v_raw IS NULL OR v_raw = '' THEN
    v_raw := current_setting('app.user_id', true);
  END IF;
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_uuid := v_raw::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN v_uuid;
END;
$body$;

CREATE OR REPLACE FUNCTION current_user_type() RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_raw text;
BEGIN
  v_raw := current_setting('request.jwt.claim.user_type', true);
  IF v_raw IS NULL OR v_raw = '' THEN
    v_raw := current_setting('app.user_type', true);
  END IF;
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN 'anonymous';
  END IF;
  IF v_raw NOT IN ('super_admin','tenant_member','client','vendor','guest','speaker','anonymous') THEN
    RETURN 'anonymous';
  END IF;
  RETURN v_raw;
END;
$body$;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_uid uuid := current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  IF current_user_type() <> 'super_admin' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM super_admins
    WHERE id = v_uid
      AND removed_at IS NULL
  );
END;
$body$;

CREATE OR REPLACE FUNCTION is_tenant_member(p_tenant_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_uid uuid := current_user_id();
BEGIN
  IF v_uid IS NULL OR p_tenant_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF current_user_type() <> 'tenant_member' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM tenant_members
    WHERE id = v_uid
      AND tenant_id = p_tenant_id
      AND removed_at IS NULL
  );
END;
$body$;

CREATE OR REPLACE FUNCTION is_authenticated() RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $body$
  SELECT current_user_id() IS NOT NULL AND current_user_type() <> 'anonymous';
$body$;

DO $grant$
BEGIN
  REVOKE ALL ON FUNCTION current_tenant_id()  FROM PUBLIC;
  REVOKE ALL ON FUNCTION current_user_id()    FROM PUBLIC;
  REVOKE ALL ON FUNCTION current_user_type()  FROM PUBLIC;
  REVOKE ALL ON FUNCTION is_super_admin()     FROM PUBLIC;
  REVOKE ALL ON FUNCTION is_tenant_member(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION is_authenticated()   FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION current_tenant_id(), current_user_id(), current_user_type(),
      is_super_admin(), is_tenant_member(uuid), is_authenticated() TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION current_tenant_id(), current_user_id(), current_user_type(),
      is_super_admin(), is_tenant_member(uuid), is_authenticated() TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION current_tenant_id(), current_user_id(), current_user_type(),
      is_super_admin(), is_tenant_member(uuid), is_authenticated() TO anon;
  END IF;
END
$grant$;
