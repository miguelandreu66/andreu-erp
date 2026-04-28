-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 4
-- Logística Avanzada: km y toneladas en viajes
-- =============================================
-- Ejecutar en Railway → tu DB → Query Runner
-- =============================================

-- Agregar campos que faltan a la tabla viajes
ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS km_recorridos DECIMAL(8,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toneladas     DECIMAL(8,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS origen        VARCHAR(100);

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'viajes'
ORDER BY ordinal_position;
