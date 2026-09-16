-- CreateTable
CREATE TABLE "SosAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT,
    "callsign" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SosAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SosAlert_organizationId_createdAt_idx" ON "SosAlert"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SosAlert_groupId_createdAt_idx" ON "SosAlert"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
