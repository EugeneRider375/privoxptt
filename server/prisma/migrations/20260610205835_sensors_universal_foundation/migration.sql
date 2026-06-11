-- CreateEnum
CREATE TYPE "SensorIngest" AS ENUM ('PULL', 'PUSH');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED');

-- AlterTable
ALTER TABLE "Sensor" ADD COLUMN     "batteryPct" DOUBLE PRECISION,
ADD COLUMN     "ingest" "SensorIngest" NOT NULL DEFAULT 'PULL',
ADD COLUMN     "reportIntervalSec" INTEGER,
ADD COLUMN     "rssi" INTEGER,
ADD COLUMN     "sensorKey" TEXT,
ALTER COLUMN "adapter" DROP NOT NULL,
ALTER COLUMN "sourceUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SensorReading" ADD COLUMN     "metrics" JSONB;

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "ruleId" TEXT,
    "metric" TEXT,
    "severity" "AlertSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "peakValue" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_sensorId_status_idx" ON "Incident"("sensorId", "status");

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Sensor_sensorKey_key" ON "Sensor"("sensorKey");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

