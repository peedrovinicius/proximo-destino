ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_passengerCount_check"
  CHECK ("passengerCount" BETWEEN 1 AND 10);

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_capacity_check"
  CHECK ("capacity" IS NULL OR "capacity" >= 1),
  ADD CONSTRAINT "Trip_priceCents_check"
  CHECK ("priceCents" IS NULL OR "priceCents" >= 0);

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_revision_check"
  CHECK ("revision" >= 1),
  ADD CONSTRAINT "Quote_monetary_nonnegative_check"
  CHECK (
    "subtotalCostCents" >= 0 AND
    "subtotalSaleCents" >= 0 AND
    "discountCents" >= 0 AND
    "totalCents" >= 0
  ),
  ADD CONSTRAINT "Quote_discount_check"
  CHECK ("discountCents" <= "subtotalSaleCents"),
  ADD CONSTRAINT "Quote_total_consistency_check"
  CHECK ("totalCents" = "subtotalSaleCents" - "discountCents"),
  ADD CONSTRAINT "Quote_margin_consistency_check"
  CHECK ("marginCents" = "totalCents" - "subtotalCostCents");

ALTER TABLE "QuoteItem"
  ADD CONSTRAINT "QuoteItem_quantity_check"
  CHECK ("quantity" >= 1),
  ADD CONSTRAINT "QuoteItem_monetary_nonnegative_check"
  CHECK (
    "unitCostCents" >= 0 AND
    "unitSaleCents" >= 0 AND
    "totalCostCents" >= 0 AND
    "totalSaleCents" >= 0
  ),
  ADD CONSTRAINT "QuoteItem_cost_consistency_check"
  CHECK ("totalCostCents" = "unitCostCents" * "quantity"),
  ADD CONSTRAINT "QuoteItem_sale_consistency_check"
  CHECK ("totalSaleCents" = "unitSaleCents" * "quantity");

ALTER TABLE "ReservationService"
  ADD CONSTRAINT "ReservationService_amountCents_check"
  CHECK ("amountCents" >= 0);

ALTER TABLE "FinancePlan"
  ADD CONSTRAINT "FinancePlan_totalCents_check"
  CHECK ("totalCents" > 0),
  ADD CONSTRAINT "FinancePlan_downPaymentCents_check"
  CHECK ("downPaymentCents" >= 0 AND "downPaymentCents" < "totalCents"),
  ADD CONSTRAINT "FinancePlan_installmentCount_check"
  CHECK ("installmentCount" BETWEEN 1 AND 36);

ALTER TABLE "Installment"
  ADD CONSTRAINT "Installment_sequence_check"
  CHECK ("sequence" >= 0),
  ADD CONSTRAINT "Installment_amountCents_check"
  CHECK ("amountCents" > 0);
