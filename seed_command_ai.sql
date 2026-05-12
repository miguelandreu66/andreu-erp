-- =============================================
-- GRUPO ANDREU ERP — Seed demo Command AI
-- =============================================
-- Genera datos demo para que el módulo Command AI muestre algo
-- inmediatamente, sin esperar integración GPS real.
--
-- Idempotente: solo inserta si no hay pings recientes (< 30 min).
-- Es SEGURO de correr múltiples veces.
-- =============================================

DO $$
DECLARE
  u RECORD;
  ping_count INTEGER;
  base_lat DECIMAL(9,6) := 18.9186;   -- Cuernavaca / Morelos
  base_lng DECIMAL(9,6) := -99.2345;
  jitter DECIMAL;
BEGIN
  -- Solo seedear si no hay pings recientes (evita duplicar en cada corrida)
  SELECT COUNT(*) INTO ping_count
  FROM gps_pings
  WHERE registrado_en >= NOW() - INTERVAL '30 minutes';

  IF ping_count > 0 THEN
    RAISE NOTICE 'Ya hay % pings recientes — seed omitido (idempotente)', ping_count;
    RETURN;
  END IF;

  -- Generar pings demo para cada unidad activa
  FOR u IN
    SELECT u.id, u.placas,
           (SELECT id FROM viajes v
             WHERE v.unidad_id = u.id AND v.estado IN ('En ruta','Completado')
             ORDER BY v.fecha DESC LIMIT 1) AS ultimo_viaje_id
    FROM unidades u
    WHERE u.activo = true
  LOOP
    jitter := (RANDOM() - 0.5) * 0.5;

    -- Ping de hace 2 min (estado normal)
    INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, fuente, registrado_en)
    VALUES (
      u.id, u.ultimo_viaje_id,
      base_lat + jitter,
      base_lng + jitter,
      ROUND((60 + RANDOM() * 35)::numeric, 2),
      ROUND((RANDOM() * 360)::numeric, 2),
      'simulado',
      NOW() - INTERVAL '2 minutes'
    );

    -- Una unidad con exceso de velocidad para que dispare alerta demo
    IF u.id = (SELECT id FROM unidades WHERE activo = true ORDER BY id LIMIT 1) THEN
      INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, fuente, registrado_en)
      VALUES (u.id, u.ultimo_viaje_id, base_lat + jitter + 0.1, base_lng + jitter + 0.1, 98.5, 180, 'simulado', NOW() - INTERVAL '1 minute');
    END IF;

    RAISE NOTICE 'Seed ping para unidad % (%)', u.placas, u.id;
  END LOOP;

  -- Forzar una unidad sin señal (último ping > 15 min) para alerta GPS demo
  -- Tomamos la segunda unidad activa y le insertamos solo un ping antiguo
  IF (SELECT COUNT(*) FROM unidades WHERE activo = true) >= 2 THEN
    -- Borrar pings recientes que acabamos de crear para esta unidad
    DELETE FROM gps_pings
    WHERE unidad_id = (SELECT id FROM unidades WHERE activo = true ORDER BY id OFFSET 1 LIMIT 1)
      AND registrado_en >= NOW() - INTERVAL '30 minutes';

    INSERT INTO gps_pings (unidad_id, lat, lng, velocidad_kmh, fuente, registrado_en)
    SELECT id, base_lat + 0.05, base_lng - 0.05, 0, 'simulado', NOW() - INTERVAL '22 minutes'
    FROM unidades
    WHERE activo = true ORDER BY id OFFSET 1 LIMIT 1;
  END IF;

  RAISE NOTICE 'Seed Command AI completado.';
END $$;

-- Verificación rápida
SELECT
  u.placas,
  ulp.minutos_desde_ultimo,
  ulp.velocidad_kmh,
  ulp.viaje_id
FROM unidades u
LEFT JOIN unidades_ultima_posicion ulp ON ulp.unidad_id = u.id
WHERE u.activo = true
ORDER BY u.placas;
