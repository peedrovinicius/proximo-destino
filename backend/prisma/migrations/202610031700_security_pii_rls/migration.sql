ALTER TABLE "Client"
ADD COLUMN "documentEncrypted" TEXT,
ADD COLUMN "documentHash" TEXT;

ALTER TABLE "Companion"
ADD COLUMN "documentEncrypted" TEXT,
ADD COLUMN "documentHash" TEXT;

ALTER TABLE "ReservationPassenger"
ADD COLUMN "documentEncrypted" TEXT,
ADD COLUMN "documentHash" TEXT;

CREATE INDEX "Client_documentHash_idx"
ON "Client"("documentHash");

ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Companion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReservationPassenger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeatAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Installment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TravelDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientCreditTransaction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_only_client"
ON "Client"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_companion"
ON "Companion"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_reservation"
ON "Reservation"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_reservation_passenger"
ON "ReservationPassenger"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_seat_assignment"
ON "SeatAssignment"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_purchase_order"
ON "PurchaseOrder"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_quote"
ON "Quote"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_finance_plan"
ON "FinancePlan"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_installment"
ON "Installment"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_travel_document"
ON "TravelDocument"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_manual_payment"
ON "ManualPayment"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

CREATE POLICY "api_only_client_credit"
ON "ClientCreditTransaction"
FOR ALL
TO PUBLIC
USING (false)
WITH CHECK (false);

COMMENT ON POLICY "api_only_client" ON "Client"
IS 'Defense-in-depth: direct non-owner database roles are denied; application authorization remains enforced by the authenticated API.';
