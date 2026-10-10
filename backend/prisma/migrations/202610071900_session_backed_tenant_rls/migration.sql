-- Session-backed tenant RLS for restricted, non-owner runtime roles.
-- This migration does not activate COMPANY_FOUNDATION and does not change
-- legacy rows. Table owners keep PostgreSQL's normal RLS bypass until a
-- separate restricted runtime login is explicitly configured and verified.
--
-- The app.* settings are routing context, not credentials. Authorization is
-- revalidated against persisted AuthSession/User/Company/CompanyMembership
-- state for every policy evaluation.

CREATE OR REPLACE FUNCTION public.company_tenant_authorized(target_company TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    target_company IS NOT NULL
    AND target_company = NULLIF(current_setting('app.company_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM public."AuthSession" s
      JOIN public."User" u ON u."id" = s."userId"
      JOIN public."Company" c ON c."id" = s."companyId"
      JOIN public."CompanyMembership" m
        ON m."companyId" = c."id" AND m."userId" = u."id"
      WHERE s."id" = NULLIF(current_setting('app.session_id', true), '')
        AND s."userId" = NULLIF(current_setting('app.user_id', true), '')
        AND s."companyId" = target_company
        AND s."revokedAt" IS NULL
        AND s."expiresAt" > CURRENT_TIMESTAMP
        AND u."isActive" = true
        AND u."companyManaged" = true
        AND u."role"::text IN ('ADMIN', 'AGENT', 'FINANCE')
        AND m."isActive" = true
        AND m."role"::text = u."role"::text
        AND c."status" = 'ACTIVE'
    );
$$;

COMMENT ON FUNCTION public.company_tenant_authorized(TEXT)
IS 'Fail-closed tenant authorization for restricted runtime roles. app.* values are accepted only when they match an active persisted session, user, membership and company.';

ALTER TABLE "QuoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReservationService" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_only_quote_item"
ON "QuoteItem"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_reservation_service"
ON "ReservationService"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "tenant_session_client"
ON "Client"
FOR ALL
TO PUBLIC
USING (public.company_tenant_authorized("companyId"))
WITH CHECK (public.company_tenant_authorized("companyId"));

CREATE POLICY "tenant_session_trip"
ON "Trip"
FOR ALL
TO PUBLIC
USING (public.company_tenant_authorized("companyId"))
WITH CHECK (public.company_tenant_authorized("companyId"));

CREATE POLICY "tenant_session_reservation"
ON "Reservation"
FOR ALL
TO PUBLIC
USING (public.company_tenant_authorized("companyId"))
WITH CHECK (public.company_tenant_authorized("companyId"));

CREATE POLICY "tenant_session_companion"
ON "Companion"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Client" c
    WHERE c."id" = "Companion"."clientId"
      AND public.company_tenant_authorized(c."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Client" c
    WHERE c."id" = "Companion"."clientId"
      AND public.company_tenant_authorized(c."companyId")
  )
);

CREATE POLICY "tenant_session_reservation_passenger"
ON "ReservationPassenger"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ReservationPassenger"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ReservationPassenger"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_seat_assignment"
ON "SeatAssignment"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."Reservation" r
    JOIN public."Trip" t ON t."id" = "SeatAssignment"."tripId"
    WHERE r."id" = "SeatAssignment"."reservationId"
      AND r."tripId" = t."id"
      AND r."companyId" IS NOT DISTINCT FROM t."companyId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public."Reservation" r
    JOIN public."Trip" t ON t."id" = "SeatAssignment"."tripId"
    WHERE r."id" = "SeatAssignment"."reservationId"
      AND r."tripId" = t."id"
      AND r."companyId" IS NOT DISTINCT FROM t."companyId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_purchase_order"
ON "PurchaseOrder"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "PurchaseOrder"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "PurchaseOrder"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_quote"
ON "Quote"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "Quote"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "Quote"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_quote_item"
ON "QuoteItem"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."Quote" q
    JOIN public."Reservation" r ON r."id" = q."reservationId"
    WHERE q."id" = "QuoteItem"."quoteId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public."Quote" q
    JOIN public."Reservation" r ON r."id" = q."reservationId"
    WHERE q."id" = "QuoteItem"."quoteId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_reservation_service"
ON "ReservationService"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ReservationService"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ReservationService"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_finance_plan"
ON "FinancePlan"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "FinancePlan"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "FinancePlan"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_installment"
ON "Installment"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public."FinancePlan" f
    JOIN public."Reservation" r ON r."id" = f."reservationId"
    WHERE f."id" = "Installment"."financePlanId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public."FinancePlan" f
    JOIN public."Reservation" r ON r."id" = f."reservationId"
    WHERE f."id" = "Installment"."financePlanId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_travel_document"
ON "TravelDocument"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "TravelDocument"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "TravelDocument"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_manual_payment"
ON "ManualPayment"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ManualPayment"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Reservation" r
    WHERE r."id" = "ManualPayment"."reservationId"
      AND public.company_tenant_authorized(r."companyId")
  )
);

CREATE POLICY "tenant_session_client_credit"
ON "ClientCreditTransaction"
FOR ALL
TO PUBLIC
USING (
  EXISTS (
    SELECT 1 FROM public."Client" c
    WHERE c."id" = "ClientCreditTransaction"."clientId"
      AND public.company_tenant_authorized(c."companyId")
  )
  AND (
    "ClientCreditTransaction"."reservationId" IS NULL
    OR EXISTS (
      SELECT 1
      FROM public."Reservation" r
      JOIN public."Client" c ON c."id" = "ClientCreditTransaction"."clientId"
      WHERE r."id" = "ClientCreditTransaction"."reservationId"
        AND r."clientId" = c."id"
        AND r."companyId" IS NOT DISTINCT FROM c."companyId"
        AND public.company_tenant_authorized(r."companyId")
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public."Client" c
    WHERE c."id" = "ClientCreditTransaction"."clientId"
      AND public.company_tenant_authorized(c."companyId")
  )
  AND (
    "ClientCreditTransaction"."reservationId" IS NULL
    OR EXISTS (
      SELECT 1
      FROM public."Reservation" r
      JOIN public."Client" c ON c."id" = "ClientCreditTransaction"."clientId"
      WHERE r."id" = "ClientCreditTransaction"."reservationId"
        AND r."clientId" = c."id"
        AND r."companyId" IS NOT DISTINCT FROM c."companyId"
        AND public.company_tenant_authorized(r."companyId")
    )
  )
);
