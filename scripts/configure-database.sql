-- Run as the application role in its target database. Applies to new connections.
-- Scoped to this role/database pair; does not change server-wide defaults.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
    current_user, current_database(), '250ms');
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    current_user, current_database(), '2s');
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET transaction_timeout = %L',
    current_user, current_database(), '5s');
END
$$;
