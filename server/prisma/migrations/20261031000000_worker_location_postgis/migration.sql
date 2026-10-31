-- Add private, consent-controlled worker location storage.
-- Existing WorkerProfile coordinates are intentionally not copied: that data
-- was collected without the new explicit location-sharing consent.

CREATE SCHEMA IF NOT EXISTS extensions;
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE "WorkerLocation" (
    "workerProfileId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lastLocationUpdate" TIMESTAMP(3),
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sharingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "location" geography(Point,4326) GENERATED ALWAYS AS (
        CASE
            WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
        END
    ) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLocation_pkey" PRIMARY KEY ("workerProfileId"),
    CONSTRAINT "WorkerLocation_workerProfileId_fkey" FOREIGN KEY ("workerProfileId")
        REFERENCES "WorkerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkerLocation_latitude_range" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
    CONSTRAINT "WorkerLocation_longitude_range" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)),
    CONSTRAINT "WorkerLocation_coordinate_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
);

CREATE INDEX "WorkerLocation_location_gist_idx" ON "WorkerLocation" USING GIST ("location");
CREATE INDEX "WorkerLocation_discovery_idx" ON "WorkerLocation" ("isAvailable", "sharingEnabled", "lastLocationUpdate");

ALTER TABLE "WorkerLocation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WorkerLocation" FROM anon, authenticated;

COMMENT ON TABLE "WorkerLocation" IS 'Private worker coordinates. Access is backend-authorized; direct Supabase client access is denied by RLS.';

CREATE TABLE "CustomerLocation" (
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "addressLabel" TEXT,
    "lastLocationUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerLocation_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "CustomerLocation_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerLocation_latitude_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
    CONSTRAINT "CustomerLocation_longitude_range" CHECK ("longitude" >= -180 AND "longitude" <= 180)
);

ALTER TABLE "CustomerLocation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CustomerLocation" FROM anon, authenticated;

COMMENT ON TABLE "CustomerLocation" IS 'Private customer-selected search location; direct Supabase client access is denied by RLS.';