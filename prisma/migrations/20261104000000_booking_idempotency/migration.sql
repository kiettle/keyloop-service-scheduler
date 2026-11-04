BEGIN;

CREATE TABLE "appointment_booking_requests" (
  "key" UUID NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "appointment_id" UUID,
  "response_body" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_booking_requests_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "booking_request_fingerprint_valid" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "booking_request_response_paired" CHECK (
    ("appointment_id" IS NULL AND "response_body" IS NULL)
    OR ("appointment_id" IS NOT NULL AND "response_body" IS NOT NULL AND jsonb_typeof("response_body") = 'object')
  ),
  CONSTRAINT "appointment_booking_requests_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "appointment_booking_requests_appointment_id_key"
  ON "appointment_booking_requests"("appointment_id");

COMMIT;
