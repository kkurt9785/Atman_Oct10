-- Keep one durable Toss order per SaaS invoice. A terminal attempt without any
-- provider payment key is retried by resetting this same row to ready. This
-- prevents a late success webhook from colliding with a replacement order.

DROP INDEX IF EXISTS public.uq_payment_service_invoice_active;

CREATE UNIQUE INDEX uq_payment_service_invoice
  ON public.payment_orders(service_invoice_id)
  WHERE service_invoice_id IS NOT NULL;

COMMENT ON INDEX public.uq_payment_service_invoice IS
  'One durable Toss order per SaaS invoice; retry the same row only when no provider payment key exists.';
