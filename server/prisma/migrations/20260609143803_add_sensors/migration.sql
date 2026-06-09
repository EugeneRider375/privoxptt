-- CreateEnum
CREATE TYPE "SensorKind" AS ENUM ('FRIDGE', 'OUTDOOR', 'INDOOR');

-- CreateEnum
CREATE TYPE "SensorAdapter" AS ENUM ('FRIGO', 'HOMECLIMATE');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('OK', 'ALERT', 'STALE');

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SensorKind" NOT NULL,
    "adapter" "SensorAdapter" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "externalId" TEXT,
    "thresholds" JSONB NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "groupId" TEXT,
    "lastValue" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "status" "SensorStatus" NOT NULL DEFAULT 'STALE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensorReading" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensorReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sensor_organizationId_enabled_idx" ON "Sensor"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "SensorReading_sensorId_createdAt_idx" ON "SensorReading"("sensorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorReading" ADD CONSTRAINT "SensorReading_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
