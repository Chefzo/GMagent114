-- One-time fix for the live database (Supabase dashboard -> SQL Editor -> Run).
-- These reporting views ran with their owner's rights, which skips row-level
-- security, so the public API key could read sales through them. Afterwards
-- they obey the locks of whoever queries them. The server's service-role key
-- still reads them as before.
alter view public.sales_enriched set (security_invoker = on);
alter view public.dow_baseline set (security_invoker = on);
alter view public.sales_variance set (security_invoker = on);
alter view public.event_lift set (security_invoker = on);
alter view public.weather_impact set (security_invoker = on);
