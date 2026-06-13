-- Звуковая сирена при тревоге: per-sensor флаг для диспетчерского пульта (по умолчанию выкл)
ALTER TABLE "Sensor" ADD COLUMN "alarmSound" BOOLEAN NOT NULL DEFAULT false;
