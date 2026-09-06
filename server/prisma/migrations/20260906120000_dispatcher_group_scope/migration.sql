-- CreateTable
CREATE TABLE "DispatcherGroupScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatcherGroupScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatcherGroupScope_userId_idx" ON "DispatcherGroupScope"("userId");

-- CreateIndex
CREATE INDEX "DispatcherGroupScope_groupId_idx" ON "DispatcherGroupScope"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatcherGroupScope_userId_groupId_key" ON "DispatcherGroupScope"("userId", "groupId");

-- AddForeignKey
ALTER TABLE "DispatcherGroupScope" ADD CONSTRAINT "DispatcherGroupScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatcherGroupScope" ADD CONSTRAINT "DispatcherGroupScope_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
