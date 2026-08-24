-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "voipToken" TEXT,
ALTER COLUMN "pushToken" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Device_voipToken_key" ON "Device"("voipToken");

