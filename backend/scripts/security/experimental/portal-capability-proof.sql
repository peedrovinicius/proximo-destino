-- DISPOSABLE CI FIXTURE ONLY. Not a migration or production grant script.
-- The Node harness checks NODE_ENV, loopback host and the dedicated DB first.
-- psql --set=runtime_role=<synthetic-login> --file=<this file>
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'proximo_destino' THEN
    RAISE EXCEPTION 'Dedicated disposable database required';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE ROLE synth_portal_boundary NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE SCHEMA synth_portal_boundary;
REVOKE ALL ON SCHEMA synth_portal_boundary FROM PUBLIC;
GRANT USAGE ON SCHEMA public, synth_portal_boundary TO synth_portal_boundary;
GRANT USAGE ON SCHEMA synth_portal_boundary TO :"runtime_role";
CREATE TABLE synth_portal_boundary.signing_key (
  singleton boolean PRIMARY KEY CHECK (singleton),
  key bytea NOT NULL CHECK (octet_length(key) = 32)
);
CREATE TABLE synth_portal_boundary.challenge (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  reservation_id text NOT NULL,
  client_id text NOT NULL,
  trip_id text NOT NULL,
  email text NOT NULL,
  credential_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
REVOKE ALL ON ALL TABLES IN SCHEMA synth_portal_boundary FROM PUBLIC;
GRANT SELECT ON synth_portal_boundary.signing_key TO synth_portal_boundary;
GRANT SELECT, INSERT, UPDATE ON synth_portal_boundary.challenge TO synth_portal_boundary;

-- The non-login definer has only the columns actually used below. The API
-- LOGIN has none of these grants and cannot SET ROLE to this definer.
GRANT SELECT ("id", "slug", "status", "tradeName"), UPDATE ("id")
  ON public."Company" TO synth_portal_boundary;
GRANT SELECT ("id", "companyId", "clientId", "tripId", "status", "accessCodeHash",
  "companyPortalFailedAttempts", "companyPortalLockedUntil", "companyPortalCodeExpiresAt", "passengerCount"),
  UPDATE ("id", "companyPortalFailedAttempts", "companyPortalLockedUntil")
  ON public."Reservation" TO synth_portal_boundary;
GRANT SELECT ("id", "companyId", "email"), UPDATE ("id") ON public."Client" TO synth_portal_boundary;
GRANT SELECT ("id", "companyId", "status", "title", "origin", "destination", "departureDate", "returnDate", "capacity"),
  UPDATE ("id") ON public."Trip" TO synth_portal_boundary;
GRANT SELECT ("id", "tokenHash", "companyId", "clientId", "reservationId", "credentialVersion", "expiresAt", "revokedAt"),
  INSERT ("id", "tokenHash", "companyId", "clientId", "reservationId", "credentialVersion", "expiresAt"),
  UPDATE ("revokedAt") ON public."CompanyClientPortalSession" TO synth_portal_boundary;
GRANT INSERT ("id", "eventType", "metadata") ON public."AuthAuditEvent" TO synth_portal_boundary;
GRANT SELECT ("reservationId", "tripId", "seatNumber") ON public."SeatAssignment" TO synth_portal_boundary;

-- Policies are bound to one non-login function owner and exact row IDs.
-- Caller GUCs are NOT credentials: only the definer gets these policies;
-- entry points clear every setting, then derive them from authenticated data.
CREATE POLICY synth_portal_reservation ON public."Reservation" TO synth_portal_boundary
  USING ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.reservation', true))
  WITH CHECK ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.reservation', true));
CREATE POLICY synth_portal_client ON public."Client" TO synth_portal_boundary
  USING ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.client', true))
  WITH CHECK ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.client', true));
CREATE POLICY synth_portal_trip ON public."Trip" TO synth_portal_boundary
  USING ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.trip', true))
  WITH CHECK ("companyId" = current_setting('synth_portal.company', true)
    AND "id" = current_setting('synth_portal.trip', true));
CREATE POLICY synth_portal_seat ON public."SeatAssignment" FOR SELECT TO synth_portal_boundary
  USING ("reservationId" = current_setting('synth_portal.reservation', true));
CREATE POLICY synth_portal_session_select ON public."CompanyClientPortalSession" FOR SELECT TO synth_portal_boundary
  USING ("tokenHash" = current_setting('synth_portal.token_hash', true)
    OR (current_setting('synth_portal.mode', true) = 'rotate'
      AND "companyId" = current_setting('synth_portal.company', true)
      AND "reservationId" = current_setting('synth_portal.reservation', true)
      AND "clientId" = current_setting('synth_portal.client', true)));
CREATE POLICY synth_portal_session_insert ON public."CompanyClientPortalSession" FOR INSERT TO synth_portal_boundary
  WITH CHECK (current_setting('synth_portal.mode', true) = 'rotate'
    AND "companyId" = current_setting('synth_portal.company', true)
    AND "reservationId" = current_setting('synth_portal.reservation', true)
    AND "clientId" = current_setting('synth_portal.client', true));
CREATE POLICY synth_portal_session_update ON public."CompanyClientPortalSession" FOR UPDATE TO synth_portal_boundary
  USING ("tokenHash" = current_setting('synth_portal.token_hash', true)
    OR (current_setting('synth_portal.mode', true) = 'rotate'
      AND "companyId" = current_setting('synth_portal.company', true)
      AND "reservationId" = current_setting('synth_portal.reservation', true)
      AND "clientId" = current_setting('synth_portal.client', true)))
  WITH CHECK ("companyId" = current_setting('synth_portal.company', true)
    AND "reservationId" = current_setting('synth_portal.reservation', true)
    AND "clientId" = current_setting('synth_portal.client', true));

CREATE FUNCTION synth_portal_boundary.clear_context() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM set_config('synth_portal.company', '', true), set_config('synth_portal.reservation', '', true),
    set_config('synth_portal.client', '', true), set_config('synth_portal.trip', '', true),
    set_config('synth_portal.token_hash', '', true), set_config('synth_portal.mode', '', true);
END $$;

CREATE FUNCTION synth_portal_boundary.valid_proof(payload text, signature text) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE expected bytea; supplied bytea; mismatch integer := 0; body jsonb; deadline numeric;
BEGIN
  IF payload IS NULL OR octet_length(payload) > 4096 OR signature IS NULL
    OR signature !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  SELECT public.hmac(convert_to(payload, 'UTF8'), key, 'sha256') INTO expected
    FROM synth_portal_boundary.signing_key WHERE singleton;
  IF expected IS NULL THEN RETURN false; END IF;
  supplied := decode(signature, 'hex');
  FOR i IN 0..31 LOOP
    mismatch := mismatch | (get_byte(expected, i) # get_byte(supplied, i));
  END LOOP;
  IF mismatch <> 0 THEN RETURN false; END IF;
  body := payload::jsonb;
  deadline := (body->>'expires')::numeric;
  RETURN body->>'v' = '1' AND deadline > extract(epoch FROM clock_timestamp())
    AND deadline <= extract(epoch FROM clock_timestamp()) + 31;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE FUNCTION synth_portal_boundary.scope(p_slug text, reservation_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE co record; r record; cl record; tr record;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' THEN RETURN NULL; END IF;
  SELECT c."id", c."slug", c."tradeName" INTO co FROM public."Company" c
    WHERE c."slug" = p_slug AND c."status" = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('synth_portal.company', co."id", true),
    set_config('synth_portal.reservation', reservation_id, true);
  SELECT r0."id", r0."clientId", r0."tripId", r0."accessCodeHash", r0."companyPortalFailedAttempts",
    r0."companyPortalLockedUntil", r0."companyPortalCodeExpiresAt" INTO r FROM public."Reservation" r0
    WHERE r0."id" = reservation_id AND r0."companyId" = co."id" AND r0."status" <> 'CANCELLED' FOR UPDATE;
  IF NOT FOUND OR r."accessCodeHash" IS NULL OR r."companyPortalCodeExpiresAt" IS NULL
    OR r."companyPortalCodeExpiresAt" <= clock_timestamp() THEN RETURN NULL; END IF;
  PERFORM set_config('synth_portal.client', r."clientId", true), set_config('synth_portal.trip', r."tripId", true);
  SELECT c."id", c."email" INTO cl FROM public."Client" c
    WHERE c."id" = r."clientId" AND c."companyId" = co."id" FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT t."id" INTO tr FROM public."Trip" t
    WHERE t."id" = r."tripId" AND t."companyId" = co."id"
      AND t."status" IN ('ACTIVE', 'SCHEDULED', 'COMPLETED') FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('companyId', co."id", 'slug', co."slug", 'tradeName', co."tradeName",
    'reservationId', r."id", 'clientId', cl."id", 'tripId', tr."id", 'email', lower(btrim(cl."email")),
    'codeHash', r."accessCodeHash", 'failedAttempts', r."companyPortalFailedAttempts",
    'lockedUntil', r."companyPortalLockedUntil");
END $$;

CREATE FUNCTION synth_portal_boundary.lookup(payload text, signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE body jsonb; ctx jsonb;
BEGIN
  PERFORM synth_portal_boundary.clear_context();
  IF NOT coalesce(synth_portal_boundary.valid_proof(payload, signature), false) THEN RETURN NULL; END IF;
  body := payload::jsonb;
  IF body->>'op' IS DISTINCT FROM 'lookup' OR NOT coalesce(body->>'nonce' ~ '^[0-9a-f]{64}$', false) THEN RETURN NULL; END IF;
  ctx := synth_portal_boundary.scope(body->>'slug', body->>'reservationId');
  IF ctx IS NULL OR ctx->>'email' IS DISTINCT FROM body->>'email'
    OR (ctx->>'lockedUntil')::timestamptz > clock_timestamp() THEN RETURN NULL; END IF;
  INSERT INTO synth_portal_boundary.challenge(id, company_id, reservation_id, client_id, trip_id, email, credential_version, expires_at)
    VALUES (body->>'nonce', ctx->>'companyId', ctx->>'reservationId', ctx->>'clientId', ctx->>'tripId', ctx->>'email',
      encode(sha256(convert_to(ctx->>'codeHash', 'UTF8')), 'hex'), to_timestamp((body->>'expires')::double precision))
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('challenge', body->>'nonce', 'codeHash', ctx->>'codeHash');
END $$;

CREATE FUNCTION synth_portal_boundary.complete(payload text, signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE body jsonb; ch record; ctx jsonb; company_slug text; now_at timestamptz;
  attempts integer; token text; deadline timestamptz;
BEGIN
  PERFORM synth_portal_boundary.clear_context();
  IF NOT coalesce(synth_portal_boundary.valid_proof(payload, signature), false) THEN RETURN NULL; END IF;
  body := payload::jsonb;
  IF body->>'op' IS DISTINCT FROM 'complete' OR jsonb_typeof(body->'valid') IS DISTINCT FROM 'boolean' THEN RETURN NULL; END IF;
  SELECT * INTO ch FROM synth_portal_boundary.challenge WHERE id = body->>'challenge' FOR UPDATE;
  IF NOT FOUND OR ch.used_at IS NOT NULL OR ch.expires_at <= clock_timestamp() THEN RETURN NULL; END IF;
  SELECT "slug" INTO company_slug FROM public."Company" WHERE "id" = ch.company_id;
  ctx := synth_portal_boundary.scope(company_slug, ch.reservation_id);
  now_at := clock_timestamp();
  IF ctx IS NULL OR ch.expires_at <= now_at OR ctx->>'companyId' <> ch.company_id
    OR ctx->>'clientId' <> ch.client_id OR ctx->>'tripId' <> ch.trip_id
    OR ctx->>'email' IS DISTINCT FROM ch.email
    OR ch.credential_version <> encode(sha256(convert_to(ctx->>'codeHash', 'UTF8')), 'hex')
    OR (ctx->>'lockedUntil')::timestamptz > now_at THEN RETURN NULL; END IF;
  UPDATE synth_portal_boundary.challenge SET used_at = now_at WHERE id = ch.id;
  IF NOT (body->>'valid')::boolean THEN
    attempts := CASE WHEN ctx->>'lockedUntil' IS NOT NULL THEN 1 ELSE (ctx->>'failedAttempts')::integer + 1 END;
    UPDATE public."Reservation" SET "companyPortalFailedAttempts" = attempts,
      "companyPortalLockedUntil" = CASE WHEN attempts >= 5 THEN now_at + interval '15 minutes' ELSE NULL END
      WHERE "id" = ch.reservation_id AND "companyId" = ch.company_id;
    INSERT INTO public."AuthAuditEvent"("id", "eventType", "metadata") VALUES
      (gen_random_uuid()::text, 'SYNTHETIC_PORTAL_LOGIN_FAILED', jsonb_build_object('companyId', ch.company_id, 'reservationId', ch.reservation_id));
    RETURN NULL;
  END IF;
  PERFORM set_config('synth_portal.mode', 'rotate', true);
  UPDATE public."Reservation" SET "companyPortalFailedAttempts" = 0, "companyPortalLockedUntil" = NULL
    WHERE "id" = ch.reservation_id AND "companyId" = ch.company_id;
  UPDATE public."CompanyClientPortalSession" SET "revokedAt" = now_at
    WHERE "reservationId" = ch.reservation_id AND "companyId" = ch.company_id AND "revokedAt" IS NULL;
  token := rtrim(translate(encode(public.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  deadline := now_at + interval '30 minutes';
  INSERT INTO public."CompanyClientPortalSession"("id", "tokenHash", "companyId", "clientId", "reservationId", "credentialVersion", "expiresAt")
    VALUES (gen_random_uuid()::text, encode(sha256(convert_to(token, 'UTF8')), 'hex'), ch.company_id,
      ctx->>'clientId', ch.reservation_id, ch.credential_version, deadline);
  INSERT INTO public."AuthAuditEvent"("id", "eventType", "metadata") VALUES
    (gen_random_uuid()::text, 'SYNTHETIC_PORTAL_LOGIN', jsonb_build_object('companyId', ch.company_id, 'reservationId', ch.reservation_id));
  RETURN jsonb_build_object('accessToken', token, 'expiresAt', deadline, 'readOnly', true);
END $$;

CREATE FUNCTION synth_portal_boundary.session(slug text, token text, logout boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s record; ctx jsonb; result jsonb; digest text;
BEGIN
  PERFORM synth_portal_boundary.clear_context();
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  digest := encode(sha256(convert_to(token, 'UTF8')), 'hex');
  PERFORM set_config('synth_portal.mode', 'session', true), set_config('synth_portal.token_hash', digest, true);
  SELECT "id", "companyId", "reservationId" INTO s FROM public."CompanyClientPortalSession" WHERE "tokenHash" = digest;
  IF NOT FOUND THEN RETURN NULL; END IF;
  ctx := synth_portal_boundary.scope(slug, s."reservationId");
  IF ctx IS NULL OR ctx->>'companyId' <> s."companyId" THEN RETURN NULL; END IF;
  SELECT "id", "companyId", "clientId", "reservationId", "credentialVersion", "expiresAt", "revokedAt" INTO s
    FROM public."CompanyClientPortalSession" WHERE "id" = s."id" AND "tokenHash" = digest FOR UPDATE;
  IF NOT FOUND OR s."revokedAt" IS NOT NULL OR s."expiresAt" <= clock_timestamp()
    OR s."companyId" <> ctx->>'companyId' OR s."clientId" <> ctx->>'clientId'
    OR s."reservationId" <> ctx->>'reservationId'
    OR s."credentialVersion" <> encode(sha256(convert_to(ctx->>'codeHash', 'UTF8')), 'hex') THEN RETURN NULL; END IF;
  IF logout THEN
    UPDATE public."CompanyClientPortalSession" SET "revokedAt" = clock_timestamp() WHERE "id" = s."id";
    INSERT INTO public."AuthAuditEvent"("id", "eventType", "metadata") VALUES
      (gen_random_uuid()::text, 'SYNTHETIC_PORTAL_LOGOUT', jsonb_build_object('companyId', s."companyId", 'reservationId', s."reservationId"));
    RETURN jsonb_build_object('loggedOut', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public."SeatAssignment" sa
    WHERE sa."reservationId" = s."reservationId" AND sa."tripId" <> ctx->>'tripId') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public."SeatAssignment" sa JOIN public."Trip" t ON t."id" = sa."tripId"
    WHERE sa."reservationId" = s."reservationId" AND (t."capacity" IS NULL OR sa."seatNumber" < 1 OR sa."seatNumber" > t."capacity"))
    THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('company', jsonb_build_object('slug', ctx->>'slug', 'tradeName', ctx->>'tradeName'),
    'reservation', jsonb_build_object('status', r."status", 'passengerCount', r."passengerCount",
      'trip', jsonb_build_object('title', t."title", 'origin', t."origin", 'destination', t."destination",
        'departureDate', t."departureDate", 'returnDate', t."returnDate"),
      'seats', coalesce((SELECT jsonb_agg(sa."seatNumber" ORDER BY sa."seatNumber") FROM public."SeatAssignment" sa
        WHERE sa."reservationId" = r."id" AND sa."tripId" = r."tripId"), '[]'::jsonb)), 'readOnly', true)
    INTO result FROM public."Reservation" r JOIN public."Trip" t ON t."id" = r."tripId" WHERE r."id" = s."reservationId";
  RETURN result;
END $$;

-- Schema ownership stays with the provisioner; the definer cannot install or
-- replace routines. Helpers are invoker-only and have NO runtime EXECUTE.
ALTER FUNCTION synth_portal_boundary.clear_context() OWNER TO synth_portal_boundary;
ALTER FUNCTION synth_portal_boundary.valid_proof(text,text) OWNER TO synth_portal_boundary;
ALTER FUNCTION synth_portal_boundary.scope(text,text) OWNER TO synth_portal_boundary;
ALTER FUNCTION synth_portal_boundary.lookup(text,text) OWNER TO synth_portal_boundary;
ALTER FUNCTION synth_portal_boundary.complete(text,text) OWNER TO synth_portal_boundary;
ALTER FUNCTION synth_portal_boundary.session(text,text,boolean) OWNER TO synth_portal_boundary;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA synth_portal_boundary FROM PUBLIC;
GRANT EXECUTE ON FUNCTION synth_portal_boundary.lookup(text,text), synth_portal_boundary.complete(text,text),
  synth_portal_boundary.session(text,text,boolean) TO :"runtime_role";
COMMIT;
