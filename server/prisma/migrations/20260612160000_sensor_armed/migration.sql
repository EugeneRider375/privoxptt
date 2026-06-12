-- Охрана датчика: armed=false подавляет алерты/инциденты/пуши (телеметрия пишется)
ALTER TABLE "Sensor" ADD COLUMN "armed" BOOLEAN NOT NULL DEFAULT true;
