from contextlib import nullcontext
import logging
import math
import re

from fastapi import APIRouter, HTTPException

import postgres

from config import PROJECT_ID, get_bigquery_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _route_key_expr(has_route_id):
    """SQL expression for the unique route key.

    ROUTE_ID is the unique feature when present (alphanumeric codes such as
    'M141541470N'), stored as STRING and used directly so it joins consistently
    across year tables. Falls back to ROUTE_NAME only when no ROUTE_ID column
    exists in the data.
    """
    if has_route_id:
        return "ROUTE_ID"
    return "ROUTE_NAME"


def _table(dataset, table, local):
    return postgres.table_ref(dataset, table) if local else f"`{PROJECT_ID}.{dataset}.{table}`"


def _replace_table(dataset, table, local):
    if local:
        return postgres.replace_table(dataset, table)
    return f"CREATE OR REPLACE TABLE {_table(dataset, table, local)} AS"


def _segment_series(end, local):
    if local:
        return f"generate_series(1, {end}) AS segments(segment_id)"
    return f"UNNEST(GENERATE_ARRAY(1, {end})) AS segment_id"


def _build_union(tables, county_dataset, table_cols, has_route_id, has_liri, has_riri, local=False):
    """Build the UNION ALL body that stacks all raw_distress_{year} tables.

    Carries ROUTE_ID (as route_key), ROUTE_NAME, measures, coordinates, and
    IRI/LIRI/RIRI through. LIRI/RIRI are emitted as NULL for any year table
    that lacks them so the UNION stays type-consistent.
    """
    float_type = "double precision" if local else "FLOAT64"
    route_key_expr = _route_key_expr(has_route_id)
    union_parts = []
    for table in tables:
        year = re.sub(r'[^0-9]', '', table.replace('raw_distress_', ''))
        cols = table_cols.get(table, set())
        liri_expr = "LIRI" if (has_liri and "LIRI" in cols) else f"CAST(NULL AS {float_type})"
        riri_expr = "RIRI" if (has_riri and "RIRI" in cols) else f"CAST(NULL AS {float_type})"
        union_parts.append(f"""
            SELECT {route_key_expr} AS route_key,
                   ROUTE_NAME,
                   FROM_MEASURE, TO_MEASURE,
                   BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON,
                   IRI, {liri_expr} AS LIRI, {riri_expr} AS RIRI,
                   COUNTY_ID, SURFTYPE,
                   {year} AS data_year
            FROM {_table(county_dataset, table, local)}
            WHERE {route_key_expr} IS NOT NULL
              AND ROUTE_NAME IS NOT NULL
              AND FROM_MEASURE IS NOT NULL
              AND TO_MEASURE IS NOT NULL
              AND BEGIN_GLAT IS NOT NULL
              AND BEGIN_GLON IS NOT NULL
              AND END_GLAT IS NOT NULL
              AND END_GLON IS NOT NULL
        """)
    return ' UNION ALL '.join(union_parts)


def _build_fixed_segment_cte(num_segments, local=False):
    """segment_definitions for fixed-count segmentation: N equal divisions of
    the overlap window [route_min, route_max]."""
    series = _segment_series(num_segments, local)
    return f"""
        segment_definitions AS (
            SELECT rb.route_key,
                   segment_id,
                   rb.route_min + ((segment_id - 1) * (rb.route_max - rb.route_min) / {num_segments}) AS segment_start,
                   rb.route_min + (segment_id * (rb.route_max - rb.route_min) / {num_segments}) AS segment_end
            FROM route_bounds rb
            CROSS JOIN {series}
            WHERE rb.route_key IN (SELECT route_key FROM valid_routes_with_overlap)
        )"""


def _build_distance_segment_cte(segment_distance, local=False):
    """segment_definitions for distance-based segmentation.

    Mirrors the prototype's `while start < earlyFinish: end = start + segment`
    loop: uniform `segment_distance`-mile windows walking from route_min, with
    CEIL(...) segments so the final window covers the tail (uncapped end, like
    the prototype's last iteration).
    """
    series = _segment_series("rsc.num_segments", local)
    int_type = "bigint" if local else "INT64"
    return f"""
        route_segment_counts AS (
            SELECT route_key, route_min, route_max,
                   GREATEST(CAST(CEIL((route_max - route_min) / {segment_distance}) AS {int_type}), 1) AS num_segments
            FROM route_bounds
            WHERE route_key IN (SELECT route_key FROM valid_routes_with_overlap)
        ),
        segment_definitions AS (
            SELECT rsc.route_key,
                   segment_id,
                   rsc.route_min + ((segment_id - 1) * {segment_distance}) AS segment_start,
                   rsc.route_min + (segment_id * {segment_distance}) AS segment_end
            FROM route_segment_counts rsc
            CROSS JOIN {series}
        )"""


def _build_combined_query(county_dataset, years, segment_definitions_cte,
                          segmentation_type, metadata_value, years_list,
                          num_years, has_route_id, has_liri, has_riri, local=False):
    """Build the segmentation pipeline that produces distress_final.

    Logic mirrors the pandas prototype:
      - overlap window per route (max of year-mins .. min of year-maxes)
      - each record claimed by its EARLIEST overlapping segment (greedy `used`)
      - begin coords from the record with the smallest FROM_MEASURE across all
        years in the segment; end coords from the largest TO_MEASURE
      - length from actual record coverage (max TO - min FROM)
      - IRI/LIRI/RIRI averaged per year
    """

    # valid_routes: routes present in at least 2 of the selected years
    year_columns = [f"MAX(CASE WHEN data_year = {y} THEN 1 ELSE 0 END) AS y{y}" for y in years]
    year_conditions = []
    for i in range(len(years)):
        for j in range(i + 1, len(years)):
            condition_parts = []
            for k in range(i):
                condition_parts.append(f"y{years[k]} = 0")
            for k in range(i, j + 1):
                condition_parts.append(f"y{years[k]} = 1")
            for k in range(j + 1, len(years)):
                condition_parts.append(f"y{years[k]} = 0")
            year_conditions.append("(" + " AND ".join(condition_parts) + ")")

    # Per-year pivot expressions (aggregated per route_key + segment + year already)
    iri_pivot = [f"MAX(CASE WHEN data_year = {y} THEN year_iri END) AS iri_{y}" for y in years]
    index_pivot = [f"MAX(CASE WHEN data_year = {y} THEN row_indices END) AS index_{y}" for y in years]
    pivot_cols = list(iri_pivot)
    if has_liri:
        pivot_cols += [f"MAX(CASE WHEN data_year = {y} THEN year_liri END) AS liri_{y}" for y in years]
    if has_riri:
        pivot_cols += [f"MAX(CASE WHEN data_year = {y} THEN year_riri END) AS riri_{y}" for y in years]
    pivot_cols += index_pivot

    null_checks = ' AND '.join([f"p.iri_{y} IS NOT NULL" for y in years])

    # Final output columns
    iri_out = ', '.join([f"p.iri_{y}" for y in years])
    index_out = ', '.join([f"p.index_{y}" for y in years])
    out_cols = [iri_out]
    if has_liri:
        out_cols.append(', '.join([f"p.liri_{y}" for y in years]))
    if has_riri:
        out_cols.append(', '.join([f"p.riri_{y}" for y in years]))
    out_cols.append(index_out)
    measurement_out = ', '.join(out_cols)

    route_id_select = "g.route_key AS ROUTE_ID,\n           " if has_route_id else ""

    def endpoint(column, order):
        if local:
            return f"(ARRAY_AGG({column} ORDER BY {order}))[1]"
        return f"ARRAY_AGG({column} ORDER BY {order} LIMIT 1)[OFFSET(0)]"

    all_years = _table(county_dataset, "all_years", local)
    text_type = "text" if local else "STRING"
    float_type = "double precision" if local else "FLOAT64"
    length = "(g.to_measure - g.from_measure) * 5280"
    rounded_length = f"ROUND(CAST({length} AS numeric), 2)" if local else f"ROUND({length}, 2)"
    timestamp = "CURRENT_TIMESTAMP" if local else "CURRENT_TIMESTAMP()"

    return f"""
    -- Combined pipeline: overlap window -> segment claim -> coords/IRI -> pivot
    {_replace_table(county_dataset, "distress_final", local)}
    WITH valid_routes AS (
        SELECT route_key
        FROM (
            SELECT route_key,
                   {', '.join(year_columns)}
            FROM {all_years}
            GROUP BY route_key
        ) AS route_years
        WHERE {' OR '.join(year_conditions)}
    ),
    year_bounds AS (
        SELECT route_key, data_year,
               MIN(FROM_MEASURE) AS year_min,
               MAX(TO_MEASURE) AS year_max
        FROM {all_years}
        WHERE route_key IN (SELECT route_key FROM valid_routes)
        GROUP BY route_key, data_year
    ),
    route_bounds AS (
        SELECT route_key,
               MAX(year_min) AS route_min,
               MIN(year_max) AS route_max
        FROM year_bounds
        GROUP BY route_key
        HAVING MAX(year_min) < MIN(year_max)
    ),
    year_overlap_check AS (
        SELECT yb.route_key, yb.data_year,
               CASE WHEN yb.year_min <= rb.route_min AND yb.year_max >= rb.route_max
                    THEN 1 ELSE 0 END AS has_full_overlap
        FROM year_bounds yb
        JOIN route_bounds rb ON yb.route_key = rb.route_key
    ),
    valid_routes_with_overlap AS (
        SELECT route_key
        FROM year_overlap_check
        GROUP BY route_key
        HAVING MIN(has_full_overlap) = 1
    ),
    {segment_definitions_cte},
    all_years_with_index AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY route_key, data_year ORDER BY FROM_MEASURE) - 1 AS row_index
        FROM {all_years}
        WHERE route_key IN (SELECT route_key FROM valid_routes_with_overlap)
    ),
    -- Claim each record into every segment it OVERLAPS, then keep only the
    -- earliest such segment (lowest segment_id) = greedy `used` set.
    data_with_segments_all_matches AS (
        SELECT d.route_key, d.ROUTE_NAME, d.data_year,
               sd.segment_id,
               d.FROM_MEASURE, d.TO_MEASURE,
               d.BEGIN_GLAT, d.BEGIN_GLON, d.END_GLAT, d.END_GLON,
               d.IRI, d.LIRI, d.RIRI, d.COUNTY_ID, d.SURFTYPE,
               d.row_index,
               ROW_NUMBER() OVER (
                   PARTITION BY d.route_key, d.data_year, d.row_index
                   ORDER BY sd.segment_id
               ) AS segment_rank
        FROM all_years_with_index d
        JOIN segment_definitions sd ON d.route_key = sd.route_key
        WHERE d.FROM_MEASURE < sd.segment_end
          AND d.TO_MEASURE > sd.segment_start
    ),
    data_with_segments AS (
        SELECT *
        FROM data_with_segments_all_matches
        WHERE segment_rank = 1
    ),
    -- Per route/segment/year: averaged roughness + record bookkeeping
    segment_year_stats AS (
        SELECT route_key, segment_id, data_year,
               AVG(IRI) AS year_iri,
               AVG(LIRI) AS year_liri,
               AVG(RIRI) AS year_riri,
               COUNT(*) AS record_count,
               STRING_AGG(CAST(row_index AS {text_type}), ',' ORDER BY row_index) AS row_indices
        FROM data_with_segments
        GROUP BY route_key, segment_id, data_year
    ),
    segment_pivot AS (
        SELECT route_key, segment_id,
               {', '.join(pivot_cols)}
        FROM segment_year_stats
        GROUP BY route_key, segment_id
    ),
    -- Per route/segment geometry chosen by MEASURE order across all years:
    -- begin from smallest FROM_MEASURE, end from largest TO_MEASURE.
    segment_geo AS (
        SELECT route_key, segment_id,
               MAX(ROUTE_NAME) AS ROUTE_NAME,
               MAX(COUNTY_ID) AS county_id,
               MAX(SURFTYPE) AS surftype,
               MIN(FROM_MEASURE) AS from_measure,
               MAX(TO_MEASURE) AS to_measure,
               COUNT(DISTINCT data_year) AS years_count,
               {endpoint("BEGIN_GLAT", "FROM_MEASURE")} AS from_lat,
               {endpoint("BEGIN_GLON", "FROM_MEASURE")} AS from_lon,
               {endpoint("END_GLAT", "TO_MEASURE DESC")} AS to_lat,
               {endpoint("END_GLON", "TO_MEASURE DESC")} AS to_lon
        FROM data_with_segments
        GROUP BY route_key, segment_id
    )
    SELECT {route_id_select}g.ROUTE_NAME, g.segment_id,
           g.from_measure, g.to_measure,
           {rounded_length} AS length_ft,
           g.from_lat, g.from_lon, g.to_lat, g.to_lon,
           g.county_id, g.surftype,
           g.years_count,
           {measurement_out}
    FROM segment_geo g
    JOIN segment_pivot p
        ON g.route_key = p.route_key AND g.segment_id = p.segment_id
    WHERE g.years_count = {num_years}
      AND g.from_measure < g.to_measure
      AND {null_checks}
    ORDER BY g.route_key, g.segment_id;

    -- Store metadata in same script execution
    {_replace_table(county_dataset, "segmentation_metadata", local)}
    SELECT
        '{segmentation_type}' AS segmentation_type,
        CAST({metadata_value} AS {float_type}) AS segmentation_value,
        '{years_list}' AS processed_years,
        {timestamp} AS created_at;
    """


@router.post("/process")
def process_data(
    num_segments: int = 10,
    county_name: str = None,
    selected_years: str = None,
    segmentation_type: str = "fixed",
    segment_distance: float = 0.1
):
    """
    Run the IPAT segmentation pipeline on uploaded data for a specific county.

    Args:
        num_segments: Number of segments to create per route (default: 20) - used when segmentation_type='fixed'
        county_name: Name of the county (required)
        selected_years: Comma-separated list of years to process (optional, processes all if not provided)
        segmentation_type: Type of segmentation - 'fixed' (by count) or 'distance' (by uniform mile distance)
        segment_distance: Distance in miles for each segment (default: 0.1) - used when segmentation_type='distance'

    Returns the number of routes and segments processed.
    """
    try:
        # Validate segmentation type
        if segmentation_type not in ["fixed", "distance"]:
            raise HTTPException(
                status_code=400,
                detail="segmentation_type must be either 'fixed' or 'distance'"
            )

        # Validate parameters based on segmentation type
        if segmentation_type == "fixed":
            if num_segments < 10:
                raise HTTPException(
                    status_code=400,
                    detail="Minimum number of segments is 10. Please select at least 10 segments."
                )
            if num_segments > 100:
                raise HTTPException(
                    status_code=400,
                    detail="Maximum number of segments is 100."
                )
        else:  # distance
            if not math.isfinite(segment_distance) or segment_distance <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="Segment distance must be greater than 0 miles"
                )
            if segment_distance > 10:
                raise HTTPException(
                    status_code=400,
                    detail="Segment distance cannot exceed 10 miles"
                )

        if not county_name:
            raise HTTPException(
                status_code=400,
                detail="County name is required"
            )

        # Sanitize county name
        county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())

        if num_segments < 1 or num_segments > 100:
            raise HTTPException(
                status_code=400,
                detail="Number of segments must be between 1 and 100"
            )

        # Create county-specific dataset name
        county_dataset = f"ipat_{county}"
        local = bool(postgres.DATABASE_URL)
        with postgres.connect() if local else nullcontext() as connection:
            if local:
                postgres.lock_county(connection, county_dataset)
                def query_rows(sql):
                    return connection.execute(sql).fetchall()

                execute = connection.execute
            else:
                client = get_bigquery_client()
                def query_rows(sql):
                    return client.query(sql).result()

                execute = query_rows

            # Get list of available years from tables for this county
            query = f"""
            SELECT table_name
            FROM `{PROJECT_ID}.{county_dataset}.INFORMATION_SCHEMA.TABLES`
            WHERE table_name LIKE 'raw_distress_%'
            ORDER BY table_name
            """

            tables_result = postgres.tables(connection, county_dataset) if local else query_rows(query)
            all_tables = [
                row["table_name"] for row in tables_result
                if re.fullmatch(r"raw_distress_[0-9]+", row["table_name"])
            ]

            # Filter tables based on selected years if provided
            if selected_years:
                selected_year_list = [y.strip() for y in selected_years.split(',')]
                tables = [t for t in all_tables if any(t == f"raw_distress_{year}" for year in selected_year_list)]
                logger.info(f"Filtering to selected years: {selected_year_list}, tables: {tables}")
            else:
                tables = all_tables
                logger.info(f"Processing all available tables: {tables}")

            if len(tables) < 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"Need at least 2 years of data for {county_name}. Found: {len(tables)} (selected: {selected_years if selected_years else 'all'})"
                )

            # Extract years from table names
            years = [re.sub(r'[^0-9]', '', table.replace('raw_distress_', '')) for table in tables]
            years_list = ', '.join(years)
            num_years = len(years)

            # Inspect raw table columns to detect ROUTE_ID / LIRI / RIRI availability
            table_list_sql = ', '.join([f"'{t}'" for t in tables])
            cols_query = f"""
            SELECT table_name, column_name
            FROM `{PROJECT_ID}.{county_dataset}.INFORMATION_SCHEMA.COLUMNS`
            WHERE table_name IN ({table_list_sql})
            """
            table_cols = {}
            column_rows = postgres.columns(connection, county_dataset) if local else query_rows(cols_query)
            for row in column_rows:
                if row["table_name"] in tables:
                    table_cols.setdefault(row["table_name"], set()).add(row["column_name"].upper())

            # ROUTE_ID is the unique key only if present in EVERY selected year table.
            has_route_id = all('ROUTE_ID' in table_cols.get(t, set()) for t in tables)
            has_liri = any('LIRI' in cols for cols in table_cols.values())
            has_riri = any('RIRI' in cols for cols in table_cols.values())

            key_label = 'ROUTE_ID' if has_route_id else 'ROUTE_NAME'
            logger.info(f"Pipeline starting: {num_years} years for {county_name} ({years_list}), "
                        f"type={segmentation_type}, key={key_label}, liri={has_liri}, riri={has_riri}")

            # === QUERY 1: Build all_years table (UNION ALL raw tables) ===
            union_body = _build_union(tables, county_dataset, table_cols,
                                      has_route_id, has_liri, has_riri, local)
            combined_query = f"""
            {_replace_table(county_dataset, "all_years", local)}
            {union_body}
            """
            logger.info(f"Query 1/3: Creating all_years table")
            execute(combined_query)

            # === QUERY 2: Combined pipeline (overlap -> segment -> coords/IRI -> pivot) ===
            if segmentation_type == "fixed":
                segment_cte = _build_fixed_segment_cte(num_segments, local)
            else:
                segment_cte = _build_distance_segment_cte(segment_distance, local)

            metadata_value = num_segments if segmentation_type == "fixed" else segment_distance

            combined_pipeline = _build_combined_query(
                county_dataset, years, segment_cte,
                segmentation_type, metadata_value, years_list,
                num_years, has_route_id, has_liri, has_riri, local
            )
            logger.info(f"Query 2/3: Running combined segmentation pipeline")
            execute(combined_pipeline)

            # === QUERY 3: Get final statistics ===
            distinct_route = "ROUTE_ID" if has_route_id else "ROUTE_NAME"
            stats_type = "bigint" if local else "INT64"
            stats_query = f"""
            SELECT
                COUNT(*) AS total_rows,
                COUNT(DISTINCT {distinct_route}) AS unique_routes,
                CAST(COUNT(*) * 1.0 / GREATEST({num_segments}, 1) AS {stats_type}) AS expected_routes
            FROM {_table(county_dataset, "distress_final", local)}
            """
            logger.info(f"Query 3/3: Getting statistics")
            stats = list(query_rows(stats_query))[0]

            logger.info(f"DONE: Routes={stats['unique_routes']}, Segments={stats['total_rows']}")

            result_data = {
                "status": "success",
                "message": f"Success! Processed {len(years)} years for {county_name}: {years_list}",
                "county": county_name,
                "dataset": county_dataset,
                "segmentation_type": segmentation_type,
                "years_processed": years_list,
                "routes_processed": stats['unique_routes'],
                "segments_created": stats['total_rows'],
                "statistics": {
                    "total_rows": stats['total_rows'],
                    "unique_routes": stats['unique_routes'],
                    "expected_routes": stats['expected_routes']
                }
            }

            if segmentation_type == "fixed":
                result_data["num_segments"] = num_segments
            else:
                result_data["segment_distance"] = segment_distance

            return result_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
