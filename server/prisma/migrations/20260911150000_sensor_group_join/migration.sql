-- CreateTable
CREATE TABLE "SensorGroup" (
    "id" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensorGroup_sensorId_idx" ON "SensorGroup"("sensorId");

-- CreateIndex
CREATE INDEX "SensorGroup_groupId_idx" ON "SensorGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SensorGroup_sensorId_groupId_key" ON "SensorGroup"("sensorId", "groupId");

-- AddForeignKey
ALTER TABLE "SensorGroup" ADD CONSTRAINT "SensorGroup_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SensorGroup" ADD CONSTRAINT "SensorGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

