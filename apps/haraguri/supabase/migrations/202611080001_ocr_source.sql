begin;
-- Screenshot import (on-device OCR, or AI recognition when the family turns it on) is a third way rows arrive.
alter table public.hg_expenses drop constraint if exists hg_expenses_source_check;
alter table public.hg_expenses add constraint hg_expenses_source_check check (source in ('manual','sms','recurring','ocr','ai'));
commit;
