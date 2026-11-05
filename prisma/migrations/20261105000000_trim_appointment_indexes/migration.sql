-- These indexes have no supporting appointment lookup in the current API.
-- Keep foreign keys, the customer-history index, resource indexes, and exclusions.
BEGIN;

DROP INDEX "appointments_vehicle_id_idx";
DROP INDEX "appointments_dealership_id_start_at_idx";
DROP INDEX "appointments_service_type_id_idx";

COMMIT;
