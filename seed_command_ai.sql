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
  r_unidad RECORD;
  ping_count INTEGER;
  base_lat DECIMAL(9,6) := 18.9186;   -- Cuernavaca / Morelos
  base_lng DECIMAL(9,6) := -99.2345;
  jitter DECIMAL;
  primera_unidad_id INTEGER;
  segunda_unidad_id INTEGER;
BEGIN
  -- Solo seedear si no hay pings recientes (evita duplicar en cada corrida)
  SELECT COUNT(*) INTO ping_count
  FROM gps_pings
  WHERE registrado_en >= NOW() - INTERVAL '30 minutes';

  IF ping_count > 0 THEN
    RAISE NOTICE 'Ya hay % pings recientes — seed omitido (idempotente)', ping_count;
    RETURN;
  END IF;

  -- IDs especiales para alertas demo
  SELECT id INTO primera_unidad_id FROM unidades WHERE activo = true ORDER BY id LIMIT 1;
  SELECT id INTO segunda_unidad_id FROM unidades WHERE activo = true ORDER BY id OFFSET 1 LIMIT 1;

  -- Generar pings demo para cada unidad activa
  FOR r_unidad IN
    SELECT
      un.id AS unidad_id,
      un.placas,
      (SELECT v.id FROM viajes v
        WHERE v.unidad_id = un.id AND v.estado IN ('En ruta','Completado')
        ORDER BY v.fecha DESC LIMIT 1) AS ultimo_viaje_id
    FROM unidades un
    WHERE un.activo = true
      AND un.id <> COALESCE(segunda_unidad_id, -1)   -- la segunda se trata aparte (sin señal)
  LOOP
    jitter := (RANDOM() - 0.5) * 0.5;

    INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, fuente, registrado_en)
    VALUES (
      r_unidad.unidad_id, r_unidad.ultimo_viaje_id,
      base_lat + jitter,
      base_lng + jitter,
      ROUND((60 + RANDOM() * 35)::numeric, 2),
      ROUND((RANDOM() * 360)::numeric, 2),
      'simulado',
      NOW() - INTERVAL '2 minutes'
    );

    -- La primera unidad activa: agrega ping con exceso de velocidad
    IF r_unidad.unidad_id = primera_unidad_id THEN
      INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, fuente, registrado_en)
      VALUES (r_unidad.unidad_id, r_unidad.ultimo_viaje_id, base_lat + jitter + 0.1, base_lng + jitter + 0.1, 98.5, 180, 'simulado', NOW() - INTERVAL '1 minute');
    END IF;

    RAISE NOTICE 'Seed ping para unidad % (id=%)', r_unidad.placas, r_unidad.unidad_id;
  END LOOP;

  -- Segunda unidad: ping antiguo (>15min) para disparar alerta de GPS sin señal
  IF segunda_unidad_id IS NOT NULL THEN
    INSERT INTO gps_pings (unidad_id, lat, lng, velocidad_kmh, fuente, registrado_en)
    VALUES (segunda_unidad_id, base_lat + 0.05, base_lng - 0.05, 0, 'simulado', NOW() - INTERVAL '22 minutes');
    RAISE NOTICE 'Seed ping antiguo para unidad id=% (demo GPS sin señal)', segunda_unidad_id;
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
