-- ============================================
-- IPAT PAVEMENT DISTRESS SEGMENTATION PIPELINE
-- ============================================

DROP FUNCTION IF EXISTS create_ipat_segmentation();

CREATE OR REPLACE FUNCTION create_ipat_segmentation()
RETURNS TEXT AS $$
DECLARE
    years_array INTEGER[];
    union_query TEXT := '';
    year_columns TEXT := '';
    year_conditions TEXT := '';
    iri_columns TEXT := '';
    null_check TEXT := '';
    i INTEGER;
    j INTEGER;
    k INTEGER;
BEGIN
    -- STEP 1: Detect available years
    SELECT array_agg(
        CAST(REGEXP_REPLACE(table_name, '[^0-9]', '', 'g') AS INTEGER)
        ORDER BY table_name
    )
    INTO years_array
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name LIKE 'ipat_raw_distress_%';

    IF years_array IS NULL OR array_length(years_array, 1) < 2 THEN
        RETURN 'Error: Need at least 2 years of data. Found: ' || COALESCE(array_to_string(years_array, ', '), 'none');
    END IF;

    -- STEP 2: Clean up existing tables
    DROP TABLE IF EXISTS ipat_distress_final CASCADE;
    DROP TABLE IF EXISTS ipat_distress_segmented_complete CASCADE;
    DROP TABLE IF EXISTS ipat_distress_segmented CASCADE;
    DROP TABLE IF EXISTS ipat_valid_routes CASCADE;
    DROP TABLE IF EXISTS ipat_all_years CASCADE;

    -- STEP 3: Combine all years into one table (exclude NULLs)
    FOR i IN 1..array_length(years_array, 1) LOOP
        IF i > 1 THEN
            union_query := union_query || ' UNION ALL ';
        END IF;
        union_query := union_query || format(
            'SELECT "ROUTE_NAME", "FROM_MEASURE", "TO_MEASURE",
                    "BEGIN_GLAT", "BEGIN_GLON", "END_GLAT", "END_GLON",
                    "IRI", "COUNTY_ID", "SURFTYPE", "FCLASS", "WIDTH",
                    %s AS data_year
             FROM ipat_raw_distress_%s
             WHERE "ROUTE_NAME" IS NOT NULL
               AND "FROM_MEASURE" IS NOT NULL
               AND "TO_MEASURE" IS NOT NULL
               AND "IRI" IS NOT NULL
               AND "BEGIN_GLAT" IS NOT NULL
               AND "BEGIN_GLON" IS NOT NULL
               AND "END_GLAT" IS NOT NULL
               AND "END_GLON" IS NOT NULL',
            years_array[i], years_array[i]
        );
    END LOOP;

    EXECUTE 'CREATE TABLE ipat_all_years AS ' || union_query;

    -- STEP 4: Find routes with 2+ consecutive years
    FOR i IN 1..array_length(years_array, 1) LOOP
        IF i > 1 THEN year_columns := year_columns || ', '; END IF;
        year_columns := year_columns || format(
            'MAX(CASE WHEN data_year = %s THEN 1 ELSE 0 END) AS y%s',
            years_array[i], years_array[i]
        );
    END LOOP;

    FOR i IN 1..array_length(years_array, 1) - 1 LOOP
        FOR j IN i + 1..array_length(years_array, 1) LOOP
            IF year_conditions != '' THEN
                year_conditions := year_conditions || ' OR ';
            END IF;

            year_conditions := year_conditions || '(';

            FOR k IN 1..i - 1 LOOP
                year_conditions := year_conditions || format('y%s = 0 AND ', years_array[k]);
            END LOOP;

            FOR k IN i..j LOOP
                IF k > i THEN year_conditions := year_conditions || ' AND '; END IF;
                year_conditions := year_conditions || format('y%s = 1', years_array[k]);
            END LOOP;

            FOR k IN j + 1..array_length(years_array, 1) LOOP
                year_conditions := year_conditions || format(' AND y%s = 0', years_array[k]);
            END LOOP;

            year_conditions := year_conditions || ')';
        END LOOP;
    END LOOP;

    EXECUTE format(
        'CREATE TABLE ipat_valid_routes AS
         WITH route_presence AS (
             SELECT "ROUTE_NAME", %s
             FROM ipat_all_years
             GROUP BY "ROUTE_NAME"
         )
         SELECT * FROM route_presence WHERE %s',
        year_columns, year_conditions
    );

    -- STEP 5: Segment routes using overlapping intervals (20 SEGMENTS)
    EXECUTE '
        CREATE TABLE ipat_distress_segmented AS
        WITH year_bounds AS (
            SELECT "ROUTE_NAME", data_year,
                   MIN("FROM_MEASURE") AS year_min,
                   MAX("TO_MEASURE") AS year_max
            FROM ipat_all_years
            WHERE "ROUTE_NAME" IN (SELECT "ROUTE_NAME" FROM ipat_valid_routes)
            GROUP BY "ROUTE_NAME", data_year
        ),
        route_bounds AS (
            SELECT "ROUTE_NAME",
                   MAX(year_min) AS route_min,
                   MIN(year_max) AS route_max
            FROM year_bounds
            GROUP BY "ROUTE_NAME"
            HAVING MAX(year_min) < MIN(year_max)
        ),
        data_with_segments AS (
            SELECT d."ROUTE_NAME", d.data_year,
                   d."FROM_MEASURE", d."TO_MEASURE",
                   d."BEGIN_GLAT", d."BEGIN_GLON", d."END_GLAT", d."END_GLON",
                   d."IRI", d."COUNTY_ID", d."SURFTYPE", d."FCLASS", d."WIDTH",
                   LEAST(20, GREATEST(1,
                       CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min))
                   )) AS segment_id
            FROM ipat_all_years d
            JOIN route_bounds rb ON d."ROUTE_NAME" = rb."ROUTE_NAME"
            WHERE d."FROM_MEASURE" >= rb.route_min
              AND d."TO_MEASURE" <= rb.route_max
        ),
        segment_stats AS (
            SELECT "ROUTE_NAME", data_year, segment_id,
                   MIN("FROM_MEASURE") AS segment_from_measure,
                   MAX("TO_MEASURE") AS segment_to_measure,
                   COUNT(*) AS record_count,
                   MAX("COUNTY_ID") AS county_id,
                   MAX("SURFTYPE") AS surftype,
                   MAX("FCLASS") AS fclass,
                   AVG("WIDTH") AS avg_width,
                   AVG("IRI") AS avg_iri
            FROM data_with_segments
            GROUP BY "ROUTE_NAME", data_year, segment_id
        ),
        segment_start_coords AS (
            SELECT DISTINCT ON (d."ROUTE_NAME", d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))))
                   d."ROUTE_NAME",
                   d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))) AS segment_id,
                   d."BEGIN_GLAT" AS from_lat,
                   d."BEGIN_GLON" AS from_lon
            FROM ipat_all_years d
            JOIN route_bounds rb ON d."ROUTE_NAME" = rb."ROUTE_NAME"
            WHERE d."FROM_MEASURE" >= rb.route_min
              AND d."TO_MEASURE" <= rb.route_max
            ORDER BY d."ROUTE_NAME", d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))),
                   d."FROM_MEASURE" ASC
        ),
        segment_end_coords AS (
            SELECT DISTINCT ON (d."ROUTE_NAME", d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))))
                   d."ROUTE_NAME",
                   d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))) AS segment_id,
                   d."END_GLAT" AS to_lat,
                   d."END_GLON" AS to_lon
            FROM ipat_all_years d
            JOIN route_bounds rb ON d."ROUTE_NAME" = rb."ROUTE_NAME"
            WHERE d."FROM_MEASURE" >= rb.route_min
              AND d."TO_MEASURE" <= rb.route_max
            ORDER BY d."ROUTE_NAME", d.data_year,
                   LEAST(20, GREATEST(1, CEIL(20.0 * (d."FROM_MEASURE" - rb.route_min + 0.0001) / (rb.route_max - rb.route_min)))),
                   d."TO_MEASURE" DESC
        )
        SELECT s."ROUTE_NAME", s.data_year, s.segment_id,
               s.segment_from_measure, s.segment_to_measure,
               s.record_count,
               sc.from_lat, sc.from_lon,
               ec.to_lat, ec.to_lon,
               s.county_id, s.surftype, s.fclass, s.avg_width, s.avg_iri
        FROM segment_stats s
        JOIN segment_start_coords sc
            ON s."ROUTE_NAME" = sc."ROUTE_NAME"
            AND s.data_year = sc.data_year
            AND s.segment_id = sc.segment_id
        JOIN segment_end_coords ec
            ON s."ROUTE_NAME" = ec."ROUTE_NAME"
            AND s.data_year = ec.data_year
            AND s.segment_id = ec.segment_id
        ORDER BY s."ROUTE_NAME", s.data_year, s.segment_id';

    -- STEP 6: Keep only routes with all 20 segments
    EXECUTE '
        CREATE TABLE ipat_distress_segmented_complete AS
        SELECT s.*
        FROM ipat_distress_segmented s
        WHERE s."ROUTE_NAME" IN (
            SELECT "ROUTE_NAME"
            FROM ipat_distress_segmented
            GROUP BY "ROUTE_NAME"
            HAVING COUNT(DISTINCT segment_id) = 20
               AND MIN(record_count) > 0
        )';

    -- STEP 7: Create final pivoted table
    FOR i IN 1..array_length(years_array, 1) LOOP
        IF i > 1 THEN iri_columns := iri_columns || ', '; END IF;
        iri_columns := iri_columns || format(
            'AVG(CASE WHEN data_year = %s THEN avg_iri END) AS iri_%s',
            years_array[i], years_array[i]
        );
    END LOOP;

    FOR i IN 1..array_length(years_array, 1) LOOP
        IF i > 1 THEN null_check := null_check || ' AND '; END IF;
        null_check := null_check || format('iri_%s IS NOT NULL', years_array[i]);
    END LOOP;

    EXECUTE format(
        'CREATE TABLE ipat_distress_final AS
         SELECT * FROM (
             SELECT "ROUTE_NAME", segment_id,
                    MIN(segment_from_measure) AS from_measure,
                    MAX(segment_to_measure) AS to_measure,
                    (ARRAY_AGG(from_lat ORDER BY segment_from_measure ASC))[1] AS from_lat,
                    (ARRAY_AGG(from_lon ORDER BY segment_from_measure ASC))[1] AS from_lon,
                    (ARRAY_AGG(to_lat ORDER BY segment_to_measure DESC))[1] AS to_lat,
                    (ARRAY_AGG(to_lon ORDER BY segment_to_measure DESC))[1] AS to_lon,
                    MAX(county_id) AS county_id,
                    MAX(surftype) AS surftype,
                    MAX(fclass) AS fclass,
                    AVG(avg_width) AS avg_width,
                    COUNT(DISTINCT data_year) AS years_count,
                    %s
             FROM ipat_distress_segmented_complete
             GROUP BY "ROUTE_NAME", segment_id
         ) sub
         WHERE %s
         ORDER BY "ROUTE_NAME", segment_id',
        iri_columns, null_check
    );

    RETURN format(
        'Success! Processed %s years: %s',
        array_length(years_array, 1),
        array_to_string(years_array, ', ')
    );
END;
$$ LANGUAGE plpgsql;
