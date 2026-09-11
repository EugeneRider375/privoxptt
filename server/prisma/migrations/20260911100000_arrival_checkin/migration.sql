-- CreateTable
CREATE TABLE "ArrivalCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT,
    "callsign" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrivalCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArrivalCheckIn_organizationId_createdAt_idx" ON "ArrivalCheckIn"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ArrivalCheckIn_groupId_createdAt_idx" ON "ArrivalCheckIn"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArrivalCheckIn" ADD CONSTRAINT "ArrivalCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrivalCheckIn" ADD CONSTRAINT "ArrivalCheckIn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrivalCheckIn" ADD CONSTRAINT "ArrivalCheckIn_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

