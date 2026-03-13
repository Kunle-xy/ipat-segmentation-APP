from fastapi import APIRouter, HTTPException
import re
import logging

from config import PROJECT_ID, get_bigquery_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _build_fixed_segment_cte(num_segments):
    """Build segment_definitions CTE for fixed-count segmentation."""
    return f"""
        segment_definitions AS (
            SELECT rb.ROUTE_NAME,
                   segment_id,
                   rb.route_min + ((segment_id - 1) * (rb.route_max - rb.route_min) / {num_segments}) AS segment_start,
                   rb.route_min + (segment_id * (rb.route_max - rb.route_min) / {num_segments}) AS segment_end
            FROM route_bounds rb
            CROSS JOIN UNNEST(GENERATE_ARRAY(1, {num_segments})) AS segment_id
            WHERE rb.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        )"""


def _build_distance_segment_cte(segment_distance):
    """Build segment_definitions CTE for distance-based segmentation."""
    return f"""
        route_segment_counts AS (
            SELECT ROUTE_NAME,
                   route_min,
                   route_max,
                   (route_max - route_min) AS route_length,
                   CAST(FLOOR((route_max - route_min) / {segment_distance}) AS INT64) AS num_full_segments,
                   CASE WHEN (route_max - route_min) - FLOOR((route_max - route_min) / {segment_distance}) * {segment_distance} > 0.001
                        THEN 1 ELSE 0 END AS has_remainder
            FROM route_bounds
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        ),
        segment_definitions AS (
            SELECT rsc.ROUTE_NAME,
                   segment_id,
                   rsc.route_min + ((segment_id - 1) * {segment_distance}) AS segment_start,
                   CASE
                     WHEN segment_id > rsc.num_full_segments THEN rsc.route_max
                     ELSE rsc.route_min + (segment_id * {segment_distance})
                   END AS segment_end
            FROM route_segment_counts rsc
            CROSS JOIN UNNEST(GENERATE_ARRAY(1, rsc.num_full_segments + rsc.has_remainder)) AS segment_id
        )"""


def _build_segmentation_query(county_dataset, segment_definitions_cte, years):
    """Build the main segmentation SQL query."""
    return f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented` AS
        WITH year_bounds AS (
            SELECT ROUTE_NAME, data_year,
                   MIN(FROM_MEASURE) AS year_min,
                   MAX(TO_MEASURE) AS year_max
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM `{PROJECT_ID}.{county_dataset}.valid_routes`)
            GROUP BY ROUTE_NAME, data_year
        ),
        route_bounds AS (
            SELECT ROUTE_NAME,
                   MAX(year_min) AS route_min,
                   MIN(year_max) AS route_max
            FROM year_bounds
            GROUP BY ROUTE_NAME
            HAVING MAX(year_min) < MIN(year_max)
        ),
        year_overlap_check AS (
            SELECT yb.ROUTE_NAME, yb.data_year,
                   rb.route_min, rb.route_max,
                   yb.year_min, yb.year_max,
                   CASE WHEN yb.year_min <= rb.route_min AND yb.year_max >= rb.route_max
                        THEN 1 ELSE 0 END AS has_full_overlap
            FROM year_bounds yb
            JOIN route_bounds rb ON yb.ROUTE_NAME = rb.ROUTE_NAME
        ),
        valid_routes_with_overlap AS (
            SELECT ROUTE_NAME
            FROM year_overlap_check
            GROUP BY ROUTE_NAME
            HAVING MIN(has_full_overlap) = 1
        ),
        {segment_definitions_cte},
        all_years_with_index AS (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY ROUTE_NAME, data_year ORDER BY FROM_MEASURE) - 1 AS row_index
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        ),
        data_with_segments_all_matches AS (
            SELECT d.ROUTE_NAME, d.data_year,
                   sd.segment_id,
                   sd.segment_start,
                   sd.segment_end,
                   d.FROM_MEASURE, d.TO_MEASURE,
                   d.BEGIN_GLAT, d.BEGIN_GLON, d.END_GLAT, d.END_GLON,
                   d.IRI, d.COUNTY_ID, d.SURFTYPE,
                   d.row_index,
                   ROW_NUMBER() OVER (
                       PARTITION BY d.ROUTE_NAME, d.data_year, d.row_index
                       ORDER BY ABS(d.FROM_MEASURE - sd.segment_start)
                   ) AS segment_rank
            FROM all_years_with_index d
            JOIN segment_definitions sd ON d.ROUTE_NAME = sd.ROUTE_NAME
            WHERE d.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
              AND d.FROM_MEASURE >= sd.segment_start
              AND d.FROM_MEASURE < sd.segment_end
        ),
        data_with_segments AS (
            SELECT ROUTE_NAME, data_year, segment_id, segment_start, segment_end,
                   FROM_MEASURE, TO_MEASURE,
                   BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON,
                   IRI, COUNTY_ID, SURFTYPE, row_index
            FROM data_with_segments_all_matches
            WHERE segment_rank = 1
        ),
        segment_stats AS (
            SELECT ROUTE_NAME, data_year, segment_id,
                   MIN(segment_start) AS segment_from_measure,
                   MAX(segment_end) AS segment_to_measure,
                   COUNT(*) AS record_count,
                   MAX(COUNTY_ID) AS county_id,
                   MAX(SURFTYPE) AS surftype,
                   AVG(IRI) AS avg_iri,
                   COUNT(IRI) AS iri_count,
                   STRING_AGG(CAST(row_index AS STRING), ',' ORDER BY row_index) AS row_indices
            FROM data_with_segments
            GROUP BY ROUTE_NAME, data_year, segment_id
        ),
        segment_coords AS (
            SELECT
                dws.ROUTE_NAME,
                dws.data_year,
                dws.segment_id,
                dws.segment_start,
                dws.segment_end,
                ARRAY_AGG(dws.BEGIN_GLAT ORDER BY dws.FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lat,
                ARRAY_AGG(dws.BEGIN_GLON ORDER BY dws.FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lon,
                ARRAY_AGG(dws.END_GLAT ORDER BY dws.FROM_MEASURE DESC LIMIT 1)[OFFSET(0)] AS to_lat,
                ARRAY_AGG(dws.END_GLON ORDER BY dws.FROM_MEASURE DESC LIMIT 1)[OFFSET(0)] AS to_lon
            FROM data_with_segments dws
            GROUP BY dws.ROUTE_NAME, dws.data_year, dws.segment_id, dws.segment_start, dws.segment_end
        )
        SELECT s.ROUTE_NAME, s.data_year, s.segment_id,
               s.segment_from_measure, s.segment_to_measure,
               s.record_count,
               sc.from_lat, sc.from_lon,
               sc.to_lat, sc.to_lon,
               s.county_id, s.surftype, s.avg_iri,
               s.row_indices
        FROM segment_stats s
        JOIN segment_coords sc
            ON s.ROUTE_NAME = sc.ROUTE_NAME
            AND s.data_year = sc.data_year
            AND s.segment_id = sc.segment_id
        WHERE sc.from_lat IS NOT NULL
          AND sc.from_lon IS NOT NULL
          AND sc.to_lat IS NOT NULL
          AND sc.to_lon IS NOT NULL
        ORDER BY s.ROUTE_NAME, s.data_year, s.segment_id
        """


def _build_complete_segments_query_fixed(county_dataset, num_segments, num_years):
    """Build complete segments filter query for fixed segmentation."""
    return f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented_complete` AS
        WITH segments_in_all_years AS (
            SELECT ROUTE_NAME, segment_id
            FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
            GROUP BY ROUTE_NAME, segment_id
            HAVING COUNT(DISTINCT data_year) = {num_years}
               AND MIN(record_count) > 0
        ),
        routes_with_all_segments AS (
            SELECT ROUTE_NAME
            FROM segments_in_all_years
            GROUP BY ROUTE_NAME
            HAVING COUNT(DISTINCT segment_id) = {num_segments}
        )
        SELECT s.*
        FROM `{PROJECT_ID}.{county_dataset}.distress_segmented` s
        INNER JOIN segments_in_all_years sia
            ON s.ROUTE_NAME = sia.ROUTE_NAME
            AND s.segment_id = sia.segment_id
        WHERE s.ROUTE_NAME IN (SELECT ROUTE_NAME FROM routes_with_all_segments)
        """


def _build_complete_segments_query_distance(county_dataset, num_years):
    """Build complete segments filter query for distance-based segmentation."""
    return f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented_complete` AS
        WITH segments_in_all_years AS (
            SELECT ROUTE_NAME, segment_id
            FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
            GROUP BY ROUTE_NAME, segment_id
            HAVING COUNT(DISTINCT data_year) = {num_years}
               AND MIN(record_count) > 0
        ),
        route_expected_segments AS (
            SELECT ROUTE_NAME, MAX(segment_id) AS expected_segments
            FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
            GROUP BY ROUTE_NAME
        ),
        routes_with_all_segments AS (
            SELECT sia.ROUTE_NAME
            FROM segments_in_all_years sia
            INNER JOIN route_expected_segments res
                ON sia.ROUTE_NAME = res.ROUTE_NAME
            GROUP BY sia.ROUTE_NAME, res.expected_segments
            HAVING COUNT(DISTINCT sia.segment_id) = res.expected_segments
        )
        SELECT s.*
        FROM `{PROJECT_ID}.{county_dataset}.distress_segmented` s
        INNER JOIN segments_in_all_years sia
            ON s.ROUTE_NAME = sia.ROUTE_NAME
            AND s.segment_id = sia.segment_id
        WHERE s.ROUTE_NAME IN (SELECT ROUTE_NAME FROM routes_with_all_segments)
        """


def _build_final_query(county_dataset, years):
    """Build the final pivoted table query."""
    iri_columns = [f"AVG(IF(data_year = {y}, avg_iri, NULL)) AS iri_{y}" for y in years]
    index_columns = [f"MAX(IF(data_year = {y}, row_indices, NULL)) AS index_{y}" for y in years]
    null_checks = [f"iri_{y} IS NOT NULL" for y in years]

    return f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_final` AS
        WITH segment_consistency AS (
            SELECT ROUTE_NAME, segment_id,
                   MIN(from_lat) AS from_lat,
                   MIN(from_lon) AS from_lon,
                   MAX(to_lat) AS to_lat,
                   MAX(to_lon) AS to_lon,
                   AVG(segment_from_measure) AS from_measure,
                   AVG(segment_to_measure) AS to_measure,
                   MAX(surftype) AS surftype,
                   MAX(county_id) AS county_id,
                   COUNT(DISTINCT data_year) AS years_count,
                   {', '.join(iri_columns)},
                   {', '.join(index_columns)},
                   STDDEV(from_lat) AS from_lat_stddev,
                   STDDEV(from_lon) AS from_lon_stddev,
                   STDDEV(to_lat) AS to_lat_stddev,
                   STDDEV(to_lon) AS to_lon_stddev,
                   STDDEV(segment_from_measure) AS from_measure_stddev,
                   STDDEV(segment_to_measure) AS to_measure_stddev
            FROM `{PROJECT_ID}.{county_dataset}.distress_segmented_complete`
            GROUP BY ROUTE_NAME, segment_id
        )
        SELECT ROUTE_NAME, segment_id,
               from_measure, to_measure,
               ROUND((to_measure - from_measure) * 5280, 2) AS length_ft,
               from_lat, from_lon, to_lat, to_lon,
               county_id, surftype,
               years_count, {', '.join([f"iri_{y}" for y in years])},
               {', '.join([f"index_{y}" for y in years])}
        FROM segment_consistency
        WHERE {' AND '.join(null_checks)}
          AND from_measure < to_measure
          AND (from_lat_stddev IS NULL OR from_lat_stddev < 0.0001)
          AND (from_lon_stddev IS NULL OR from_lon_stddev < 0.0001)
          AND (to_lat_stddev IS NULL OR to_lat_stddev < 0.0001)
          AND (to_lon_stddev IS NULL OR to_lon_stddev < 0.0001)
          AND (from_measure_stddev IS NULL OR from_measure_stddev < 0.01)
          AND (to_measure_stddev IS NULL OR to_measure_stddev < 0.01)
          AND years_count = {len(years)}
        ORDER BY ROUTE_NAME, segment_id
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
            if segment_distance <= 0:
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
        client = get_bigquery_client()

        # Get list of available years from tables for this county
        query = f"""
        SELECT table_name
        FROM `{PROJECT_ID}.{county_dataset}.INFORMATION_SCHEMA.TABLES`
        WHERE table_name LIKE 'raw_distress_%'
        ORDER BY table_name
        """

        tables_result = client.query(query).result()
        all_tables = [row.table_name for row in tables_result]

        # Filter tables based on selected years if provided
        if selected_years:
            selected_year_list = [y.strip() for y in selected_years.split(',')]
            tables = [t for t in all_tables if any(t == f"raw_distress_{year}" for year in selected_year_list)]
            logger.info(f"REPROCESSING MODE: Filtering to selected years: {selected_year_list}")
            logger.info(f"Available tables before filtering: {all_tables}")
            logger.info(f"Tables after filtering: {tables}")
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

        logger.info(f"FULL SEGMENTATION PIPELINE STARTING")
        logger.info(f"Processing {len(years)} years for county {county_name}: {years_list}")
        if segmentation_type == "fixed":
            logger.info(f"Segmentation Type: Fixed Number ({num_segments} segments per route)")
        else:
            logger.info(f"Segmentation Type: Uniform Distance ({segment_distance} miles per segment)")

        # Step 1: Build UNION ALL query for all years -> all_years table
        union_parts = []
        for table in tables:
            year = re.sub(r'[^0-9]', '', table)
            union_parts.append(f"""
                SELECT ROUTE_NAME, FROM_MEASURE, TO_MEASURE,
                       BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON,
                       IRI, COUNTY_ID, SURFTYPE,
                       {year} AS data_year
                FROM `{PROJECT_ID}.{county_dataset}.{table}`
                WHERE ROUTE_NAME IS NOT NULL
                  AND FROM_MEASURE IS NOT NULL
                  AND TO_MEASURE IS NOT NULL
                  AND BEGIN_GLAT IS NOT NULL
                  AND BEGIN_GLON IS NOT NULL
                  AND END_GLAT IS NOT NULL
                  AND END_GLON IS NOT NULL
            """)

        combined_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.all_years` AS
        {' UNION ALL '.join(union_parts)}
        """
        logger.info(f"Creating all_years table with {len(tables)} year tables")
        client.query(combined_query).result()

        # Step 2: Find routes with 2+ consecutive years -> valid_routes table
        year_columns = [f"MAX(IF(data_year = {y}, 1, 0)) AS y{y}" for y in years]

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

        valid_routes_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.valid_routes` AS
        WITH route_presence AS (
            SELECT ROUTE_NAME,
                   {', '.join(year_columns)}
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            GROUP BY ROUTE_NAME
        )
        SELECT * FROM route_presence
        WHERE {' OR '.join(year_conditions)}
        """
        logger.info(f"Creating valid_routes table (routes with consecutive years)")
        client.query(valid_routes_query).result()

        # Step 3: Create segmented data with proper overlapping logic
        if segmentation_type == "fixed":
            segment_definitions_cte = _build_fixed_segment_cte(num_segments)
        else:
            segment_definitions_cte = _build_distance_segment_cte(segment_distance)

        segmentation_query = _build_segmentation_query(county_dataset, segment_definitions_cte, years)
        logger.info(f"Creating distress_segmented table with overlapping segment logic")
        client.query(segmentation_query).result()

        if segmentation_type == "fixed":
            logger.info(f"distress_segmented table created with {num_segments} segments per route")
        else:
            logger.info(f"distress_segmented table created with {segment_distance} mile segments")

        # Log overlap statistics
        overlap_stats_query = f"""
        WITH year_bounds AS (
            SELECT ROUTE_NAME, data_year,
                   MIN(FROM_MEASURE) AS year_min,
                   MAX(TO_MEASURE) AS year_max
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM `{PROJECT_ID}.{county_dataset}.valid_routes`)
            GROUP BY ROUTE_NAME, data_year
        ),
        route_bounds AS (
            SELECT ROUTE_NAME,
                   MAX(year_min) AS route_min,
                   MIN(year_max) AS route_max,
                   MIN(year_max) - MAX(year_min) AS overlap_length
            FROM year_bounds
            GROUP BY ROUTE_NAME
            HAVING MAX(year_min) < MIN(year_max)
        )
        SELECT
            COUNT(*) as routes_with_overlap,
            AVG(overlap_length) as avg_overlap_length,
            MIN(overlap_length) as min_overlap_length,
            MAX(overlap_length) as max_overlap_length
        FROM route_bounds
        """
        overlap_stats = list(client.query(overlap_stats_query).result())[0]
        logger.info(f"Routes with overlap: {overlap_stats.routes_with_overlap}")
        logger.info(f"Average overlap length: {overlap_stats.avg_overlap_length:.2f}")
        logger.info(f"Min/Max overlap: {overlap_stats.min_overlap_length:.2f} / {overlap_stats.max_overlap_length:.2f}")

        # Step 4: Keep only routes with all segments across ALL years
        if segmentation_type == "fixed":
            complete_segments_query = _build_complete_segments_query_fixed(county_dataset, num_segments, len(years))
        else:
            complete_segments_query = _build_complete_segments_query_distance(county_dataset, len(years))

        client.query(complete_segments_query).result()

        # Log filtering statistics
        filter_stats_query = f"""
        SELECT
            COUNT(DISTINCT ROUTE_NAME) as routes_with_complete_overlap,
            COUNT(*) as total_segments_in_all_years
        FROM `{PROJECT_ID}.{county_dataset}.distress_segmented_complete`
        """
        filter_stats = list(client.query(filter_stats_query).result())[0]
        logger.info(f"Filtered to {filter_stats.routes_with_complete_overlap} routes with complete overlap across all {len(years)} years")
        logger.info(f"   Total segments (all years): {filter_stats.total_segments_in_all_years}")

        # Step 5: Create final pivoted table
        final_query = _build_final_query(county_dataset, years)
        logger.info(f"Creating distress_final table with IRI columns for years: {years_list}")
        client.query(final_query).result()

        # Get statistics
        stats_query = f"""
        SELECT
            COUNT(*) AS total_rows,
            COUNT(DISTINCT ROUTE_NAME) AS unique_routes,
            CAST(COUNT(*) / {num_segments} AS INT64) AS expected_routes
        FROM `{PROJECT_ID}.{county_dataset}.distress_final`
        """
        stats = list(client.query(stats_query).result())[0]

        logger.info(f"SEGMENTATION COMPLETE!")
        logger.info(f"Final Results: Years={years_list}, Routes={stats.unique_routes}, Segments={stats.total_rows}")

        # Store segmentation metadata in database
        metadata_value = num_segments if segmentation_type == "fixed" else segment_distance
        metadata_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.segmentation_metadata` AS
        SELECT
            '{segmentation_type}' AS segmentation_type,
            CAST({metadata_value} AS FLOAT64) AS segmentation_value,
            '{years_list}' AS processed_years,
            CURRENT_TIMESTAMP() AS created_at
        """
        client.query(metadata_query).result()
        logger.info(f"Stored segmentation metadata: type={segmentation_type}, value={metadata_value}")

        result_data = {
            "status": "success",
            "message": f"Success! Processed {len(years)} years for {county_name}: {years_list}",
            "county": county_name,
            "dataset": county_dataset,
            "segmentation_type": segmentation_type,
            "years_processed": years_list,
            "routes_processed": stats.unique_routes,
            "segments_created": stats.total_rows,
            "statistics": {
                "total_rows": stats.total_rows,
                "unique_routes": stats.unique_routes,
                "expected_routes": stats.expected_routes
            }
        }

        if segmentation_type == "fixed":
            result_data["num_segments"] = num_segments
        else:
            result_data["segment_distance"] = segment_distance

        return result_data

    except Exception as e:
        logger.error(f"Processing error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
