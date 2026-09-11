-- D37: перенести существующие Sensor.groupId в новую таблицу SensorGroup
-- (многие-ко-многим) перед тем, как удалить старую колонку. Идемпотентно —
-- ON CONFLICT DO NOTHING на случай повторного запуска (уникальный индекс
-- уже создан миграцией 20260911150000_sensor_group_join).
INSERT INTO "SensorGroup" ("id", "sensorId", "groupId", "createdAt")
SELECT gen_random_uuid(), "id", "groupId", now()
FROM "Sensor"
WHERE "groupId" IS NOT NULL
ON CONFLICT ("sensorId", "groupId") DO NOTHING;

-- DropForeignKey
ALTER TABLE "Sensor" DROP CONSTRAINT "Sensor_groupId_fkey";

-- AlterTable
ALTER TABLE "Sensor" DROP COLUMN "groupId";
