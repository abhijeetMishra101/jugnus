-- Grant service_role access to learnings and principles tables.
-- These were created in 013 with RLS policies but missing table-level grants,
-- causing permission denied errors when context.ts tries to read them via the service key.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugnu_learnings  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugnu_principles TO service_role;
