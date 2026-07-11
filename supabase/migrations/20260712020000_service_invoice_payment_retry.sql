-- Allow a service invoice to be paid again after a terminally failed/cancelled
-- Toss attempt, while preserving one active or paid order per invoice.

DROP INDEX IF EXISTS public.uq_payment_service_invoice;

CREATE UNIQUE INDEX uq_payment_service_invoice_active
  ON public.payment_orders(service_invoice_id)
  WHERE service_invoice_id IS NOT NULL
    AND status IN ('ready','confirming','paid','reconcile_required');

COMMENT ON INDEX public.uq_payment_service_invoice_active IS
  'One active/paid Toss order per SaaS invoice; failed and cancelled attempts remain auditable and retryable.';
