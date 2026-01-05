from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import bigquery
from google.cloud.exceptions import NotFound
from google.oauth2 import service_account
from typing import List
import pandas as pd
import pandas_gbq
import numpy as np
import os
from dotenv import load_dotenv
import logging
import re
import io

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="IPAT Segmentation Analysis API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3010"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# BigQuery setup
PROJECT_ID = os.getenv("GCP_PROJECT_ID", "vernal-citadel-479904-i2")
DATASET_ID = os.getenv("GCP_DATASET_ID", "ipat_dataset")
CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "gcp-service-account.json")

credentials = service_account.Credentials.from_service_account_file(CREDENTIALS_PATH)
client = bigquery.Client(credentials=credentials, project=PROJECT_ID)


def clean_and_cast_columns(df, filename=""):
    """
    OPTIMIZED: Clean and cast columns for BigQuery compatibility.
    Uses vectorized operations for better performance.
    """
    # Columns that should be numeric (float) - only keep essential ones
    numeric_columns = {
        'FROM_MEASURE', 'TO_MEASURE',
        'BEGIN_GLAT', 'BEGIN_GLON', 'END_GLAT', 'END_GLON',
        'IRI', 'COUNTY_ID'
    }

    # Get columns that exist in this dataframe
    cols_to_convert_numeric = [col for col in numeric_columns if col in df.columns]
    cols_to_convert_string = [col for col in df.columns if col not in numeric_columns]

    # Vectorized numeric conversion
    if cols_to_convert_numeric:
        df[cols_to_convert_numeric] = df[cols_to_convert_numeric].apply(
            pd.to_numeric, errors='coerce'
        ).replace([np.inf, -np.inf], np.nan)

    # Vectorized string conversion
    if cols_to_convert_string:
        df[cols_to_convert_string] = df[cols_to_convert_string].fillna('').astype(str)

    return df


def clean_record_for_json(record):
    """
    Clean a single record dict for JSON serialization to BigQuery.
    Handles all edge cases that can cause BigQuery upload failures.
    """
    clean = {}
    for key, value in record.items():
        # Handle None
        if value is None:
            clean[key] = None
        # Handle pandas NA
        elif pd.isna(value):
            clean[key] = None
        # Handle numpy types
        elif isinstance(value, (np.integer,)):
            clean[key] = int(value)
        elif isinstance(value, (np.floating,)):
            if np.isnan(value) or np.isinf(value):
                clean[key] = None
            else:
                clean[key] = float(value)
        # Handle Python float
        elif isinstance(value, float):
            if np.isnan(value) or np.isinf(value):
                clean[key] = None
            else:
                clean[key] = value
        # Handle strings
        elif isinstance(value, str):
            # Clean up problematic string values
            if value.lower() in ('nan', 'none', 'nat', '<na>', 'inf', '-inf', ''):
                clean[key] = None
            else:
                clean[key] = value
        # Handle numpy arrays or other iterables
        elif isinstance(value, np.ndarray):
            clean[key] = value.tolist()
        # Handle datetime
        elif isinstance(value, (pd.Timestamp, np.datetime64)):
            clean[key] = str(value) if not pd.isna(value) else None
        else:
            # Default: convert to string
            clean[key] = str(value)
    return clean


def ensure_dataset_exists(dataset_name=None):
    """Create dataset if it doesn't exist"""
    ds_id = dataset_name if dataset_name else DATASET_ID
    dataset_id = f"{PROJECT_ID}.{ds_id}"
    try:
        client.get_dataset(dataset_id)
        logger.info(f"Dataset {dataset_id} already exists")
    except Exception:
        dataset = bigquery.Dataset(dataset_id)
        dataset.location = "US"
        client.create_dataset(dataset)
        logger.info(f"Created dataset {dataset_id}")
    return ds_id


# Ensure default dataset exists
ensure_dataset_exists()


@app.get("/")
def read_root():
    return {"message": "IPAT Segmentation Analysis API (BigQuery)", "status": "running"}


@app.get("/health")
def health_check():
    try:
        query = "SELECT 1"
        client.query(query).result()
        return {"result": "OK","status": "healthy", "bigquery": "connected", "project": PROJECT_ID }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


@app.post("/upload")
async def upload_files(files: List[UploadFile] = File(...), county_name: str = None):
    """
    Upload multiple Excel files containing IPAT segmentation data.
    Each file should be named with the year (e.g., 2020.xlsx, 2021.xlsx)
    or contain the year in the filename.

    Files are saved to a dataset named after the county (e.g., 'ipat_lee' for Lee county).

    Args:
        files: Excel files to upload
        county_name: Name of the county (required) - used as dataset name
    """
    try:
        if not county_name:
            raise HTTPException(
                status_code=400,
                detail="County name is required"
            )

        # Sanitize county name for use as dataset name
        county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
        
        # Create dataset name with ipat_ prefix
        county_dataset = f"ipat_{county}"
        
        # Ensure the county-specific dataset exists
        ensure_dataset_exists(county_dataset)
        logger.info(f"Using dataset: {county_dataset}")

        uploaded_tables = []

        for file in files:
            # Extract year from filename
            filename = file.filename.replace('.xlsx', '').replace('.xls', '')
            year = ''.join(filter(str.isdigit, filename))
            logger.info(f"Processing file: {file.filename}, extracted year: {year}")

            if not year:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not extract year from filename: {file.filename}"
                )

            # Read Excel file directly from memory - OPTIMIZED
            contents = await file.read()
            logger.info(f"Read {len(contents)} bytes from {file.filename}")

            try:
                # Read directly from BytesIO for faster processing
                df = pd.read_excel(io.BytesIO(contents), engine='openpyxl')
                logger.info(f"Loaded DataFrame with {len(df)} rows, {len(df.columns)} columns")
            except Exception as e1:
                logger.error(f"Failed to read Excel file: {e1}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not read Excel file {file.filename}: {str(e1)}"
                )

            # Fix anomalies: swap FROM_MEASURE and TO_MEASURE if FROM > TO
            df['anom'] = df['FROM_MEASURE'] > df['TO_MEASURE']
            anomaly_index = df[df['anom']].index

            if not anomaly_index.empty:
                cols_to_fix = ['FROM_MEASURE', 'TO_MEASURE', 'BEGIN_GLAT', 'BEGIN_GLON', 'END_GLAT', 'END_GLON']
                cols_source = ['TO_MEASURE', 'FROM_MEASURE', 'END_GLAT', 'END_GLON', 'BEGIN_GLAT', 'BEGIN_GLON']

                df.loc[anomaly_index, cols_to_fix] = df.loc[anomaly_index, cols_source].values
                logger.info(f"🔧 Fixed {len(anomaly_index)} anomalous rows (FROM_MEASURE > TO_MEASURE)")
            else:
                logger.info(f"✅ No anomalies found (all FROM_MEASURE <= TO_MEASURE)")

            # Drop the temporary anomaly column
            df = df.drop(columns=['anom'])

            # Validate required columns
            required_columns = [
                "ROUTE_NAME", "FROM_MEASURE", "TO_MEASURE",
                "BEGIN_GLAT", "BEGIN_GLON", "END_GLAT", "END_GLON",
                "IRI", "COUNTY_ID", "SURFTYPE"
            ]

            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing columns in {file.filename}: {missing_columns}"
                )

            # Clean and cast all columns properly
            df = clean_and_cast_columns(df, file.filename)

            # Only drop rows with null ROUTE_NAME (keep rows with null IRI, etc.)
            # AVG() will automatically ignore NULL values when calculating averages
            df = df.dropna(subset=["ROUTE_NAME"])

            # Create table name (just year since dataset already has county name)
            table_name = f"raw_distress_{year}"
            destination_table = f"{county_dataset}.{table_name}"

            logger.info(f"Uploading {len(df)} rows to {destination_table}")
            
            # Upload directly to BigQuery using pandas_gbq (like df.to_sql)
            pandas_gbq.to_gbq(
                df,
                destination_table=destination_table,
                project_id=PROJECT_ID,
                credentials=credentials,
                if_exists='replace',  # Equivalent to WRITE_TRUNCATE
                progress_bar=False
            )

            uploaded_tables.append({
                "filename": file.filename,
                "county": county_name,
                "dataset": county_dataset,
                "year": year,
                "table_name": table_name,
                "rows": len(df)
            })

            logger.info(f"Uploaded {file.filename} to {county_dataset}.{table_name} with {len(df)} rows")

        return {
            "status": "success",
            "message": f"Uploaded {len(files)} file(s) to dataset '{county_dataset}'",
            "county": county_name,
            "dataset": county_dataset,
            "tables": uploaded_tables
        }

    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process")
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
            # Use exact match to ensure we only get the selected years
            tables = [t for t in all_tables if any(t == f"raw_distress_{year}" for year in selected_year_list)]
            logger.info(f"🔄 REPROCESSING MODE: Filtering to selected years: {selected_year_list}")
            logger.info(f"📋 Available tables before filtering: {all_tables}")
            logger.info(f"✅ Tables after filtering: {tables}")
        else:
            tables = all_tables
            logger.info(f"📋 Processing all available tables: {tables}")

        if len(tables) < 2:
            raise HTTPException(
                status_code=400,
                detail=f"Need at least 2 years of data for {county_name}. Found: {len(tables)} (selected: {selected_years if selected_years else 'all'})"
            )

        # Extract years from table names
        years = [re.sub(r'[^0-9]', '', table.replace('raw_distress_', '')) for table in tables]
        years_list = ', '.join(years)

        logger.info(f"🎯 FULL SEGMENTATION PIPELINE STARTING")
        logger.info(f"📊 Processing {len(years)} years for county {county_name}: {years_list}")
        if segmentation_type == "fixed":
            logger.info(f"🔢 Segmentation Type: Fixed Number ({num_segments} segments per route)")
        else:
            logger.info(f"🔢 Segmentation Type: Uniform Distance ({segment_distance} miles per segment)")
        logger.info(f"🗺️  Will apply overlapping segment logic for years: {years_list}")

        # Build UNION ALL query for all years
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
                  -- IRI can be NULL - AVG() will ignore it
            """)

        # Create combined table
        combined_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.all_years` AS
        {' UNION ALL '.join(union_parts)}
        """
        logger.info(f"🔨 Creating all_years table with {len(tables)} year tables")
        client.query(combined_query).result()
        logger.info(f"✅ all_years table created successfully")

        # Find routes with 2+ consecutive years
        year_columns = [f"MAX(IF(data_year = {y}, 1, 0)) AS y{y}" for y in years]

        # Build consecutive year conditions
        year_conditions = []
        for i in range(len(years)):
            for j in range(i + 1, len(years)):
                condition_parts = []

                # Years before range should be 0
                for k in range(i):
                    condition_parts.append(f"y{years[k]} = 0")

                # Years in range should be 1
                for k in range(i, j + 1):
                    condition_parts.append(f"y{years[k]} = 1")

                # Years after range should be 0
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
        logger.info(f"🔨 Creating valid_routes table (routes with consecutive years)")
        client.query(valid_routes_query).result()
        logger.info(f"✅ valid_routes table created successfully")

        # Create segmented data with proper overlapping logic
        # Build segment_definitions CTE based on segmentation type
        if segmentation_type == "fixed":
            # Fixed number of segments - divide route evenly
            segment_definitions_cte = f"""
        segment_definitions AS (
            SELECT rb.ROUTE_NAME,
                   segment_id,
                   -- Calculate exact start and end measures for each segment
                   rb.route_min + ((segment_id - 1) * (rb.route_max - rb.route_min) / {num_segments}) AS segment_start,
                   rb.route_min + (segment_id * (rb.route_max - rb.route_min) / {num_segments}) AS segment_end
            FROM route_bounds rb
            CROSS JOIN UNNEST(GENERATE_ARRAY(1, {num_segments})) AS segment_id
            WHERE rb.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        )"""
            expected_segments_per_route = num_segments
        else:  # distance-based segmentation
            # Uniform distance segments - create segments of fixed distance
            segment_definitions_cte = f"""
        route_segment_counts AS (
            -- Calculate how many segments each route will have
            SELECT ROUTE_NAME,
                   route_min,
                   route_max,
                   (route_max - route_min) AS route_length,
                   -- Number of full segments that fit
                   CAST(FLOOR((route_max - route_min) / {segment_distance}) AS INT64) AS num_full_segments,
                   -- Check if there's a remainder (will create one more segment)
                   CASE WHEN (route_max - route_min) - FLOOR((route_max - route_min) / {segment_distance}) * {segment_distance} > 0.001
                        THEN 1 ELSE 0 END AS has_remainder
            FROM route_bounds
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        ),
        segment_definitions AS (
            SELECT rsc.ROUTE_NAME,
                   segment_id,
                   -- Calculate start position
                   rsc.route_min + ((segment_id - 1) * {segment_distance}) AS segment_start,
                   -- Calculate end position
                   CASE
                     -- If this is the last segment and we have a remainder, end at route_max
                     WHEN segment_id > rsc.num_full_segments THEN rsc.route_max
                     -- Otherwise, end at the next distance interval
                     ELSE rsc.route_min + (segment_id * {segment_distance})
                   END AS segment_end
            FROM route_segment_counts rsc
            CROSS JOIN UNNEST(GENERATE_ARRAY(1, rsc.num_full_segments + rsc.has_remainder)) AS segment_id
        )"""
            # For distance-based, we don't have a fixed expected count (varies by route)
            expected_segments_per_route = None

        segmentation_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented` AS
        WITH year_bounds AS (
            -- For each route and year, find the min and max measures
            SELECT ROUTE_NAME, data_year,
                   MIN(FROM_MEASURE) AS year_min,
                   MAX(TO_MEASURE) AS year_max
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM `{PROJECT_ID}.{county_dataset}.valid_routes`)
            GROUP BY ROUTE_NAME, data_year
        ),
        route_bounds AS (
            -- Find the OVERLAPPING segment: MAX(all year_mins), MIN(all year_maxs)
            -- This ensures we only segment the portion that exists in ALL years
            SELECT ROUTE_NAME,
                   MAX(year_min) AS route_min,  -- Latest start point across all years
                   MIN(year_max) AS route_max   -- Earliest end point across all years
            FROM year_bounds
            GROUP BY ROUTE_NAME
            -- Only keep routes where overlap exists (max start < min end)
            HAVING MAX(year_min) < MIN(year_max)
        ),
        -- Verify each year has data within the overlapping range
        year_overlap_check AS (
            SELECT yb.ROUTE_NAME, yb.data_year,
                   rb.route_min, rb.route_max,
                   yb.year_min, yb.year_max,
                   -- Check if this year covers the overlapping range
                   CASE WHEN yb.year_min <= rb.route_min AND yb.year_max >= rb.route_max
                        THEN 1 ELSE 0 END AS has_full_overlap
            FROM year_bounds yb
            JOIN route_bounds rb ON yb.ROUTE_NAME = rb.ROUTE_NAME
        ),
        valid_routes_with_overlap AS (
            -- Only keep routes where ALL years have data in the overlapping range
            SELECT ROUTE_NAME
            FROM year_overlap_check
            GROUP BY ROUTE_NAME
            HAVING MIN(has_full_overlap) = 1  -- All years must have full overlap
        ),
        -- Define exact segment boundaries based on route overlapping range
        {segment_definitions_cte},
        all_years_with_index AS (
            -- Add row index (0-based) for each route and year
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY ROUTE_NAME, data_year ORDER BY FROM_MEASURE) - 1 AS row_index
            FROM `{PROJECT_ID}.{county_dataset}.all_years`
            WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
        ),
        data_with_segments_all_matches AS (
            -- Find all potential segment matches for each row
            SELECT d.ROUTE_NAME, d.data_year,
                   sd.segment_id,
                   sd.segment_start,
                   sd.segment_end,
                   d.FROM_MEASURE, d.TO_MEASURE,
                   d.BEGIN_GLAT, d.BEGIN_GLON, d.END_GLAT, d.END_GLON,
                   d.IRI, d.COUNTY_ID, d.SURFTYPE,
                   d.row_index,
                   -- Rank segments by how well they match this row (prefer segment where FROM_MEASURE is closest to segment_start)
                   ROW_NUMBER() OVER (
                       PARTITION BY d.ROUTE_NAME, d.data_year, d.row_index
                       ORDER BY ABS(d.FROM_MEASURE - sd.segment_start)
                   ) AS segment_rank
            FROM all_years_with_index d
            JOIN segment_definitions sd ON d.ROUTE_NAME = sd.ROUTE_NAME
            WHERE d.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
              -- Only include rows where FROM_MEASURE is within the segment boundaries
              AND d.FROM_MEASURE >= sd.segment_start
              AND d.FROM_MEASURE < sd.segment_end
        ),
        data_with_segments AS (
            -- Ensure each row is assigned to exactly ONE segment (the best matching one)
            SELECT ROUTE_NAME, data_year, segment_id, segment_start, segment_end,
                   FROM_MEASURE, TO_MEASURE,
                   BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON,
                   IRI, COUNTY_ID, SURFTYPE, row_index
            FROM data_with_segments_all_matches
            WHERE segment_rank = 1
        ),
        segment_stats AS (
            -- SIMPLE AVERAGE of all rows within each segment, per year
            -- AVG() automatically ignores NULL values - only averages non-NULL IRI
            SELECT ROUTE_NAME, data_year, segment_id,
                   MIN(segment_start) AS segment_from_measure,
                   MAX(segment_end) AS segment_to_measure,
                   COUNT(*) AS record_count,
                   MAX(COUNTY_ID) AS county_id,
                   MAX(SURFTYPE) AS surftype,  -- MAX surftype
                   AVG(IRI) AS avg_iri,        -- Simple average - NULL values ignored
                   -- Count non-NULL values for debugging
                   COUNT(IRI) AS iri_count,
                   -- Collect row indices used for this segment (comma-separated)
                   STRING_AGG(CAST(row_index AS STRING), ',' ORDER BY row_index) AS row_indices
            FROM data_with_segments
            GROUP BY ROUTE_NAME, data_year, segment_id
        ),
        -- Use actual GPS coordinates from first and last rows in each segment
        -- No interpolation - just use the real data points
        segment_coords AS (
            SELECT
                dws.ROUTE_NAME,
                dws.data_year,
                dws.segment_id,
                dws.segment_start,
                dws.segment_end,
                -- Get coordinates from FIRST row in segment (ordered by FROM_MEASURE)
                ARRAY_AGG(dws.BEGIN_GLAT ORDER BY dws.FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lat,
                ARRAY_AGG(dws.BEGIN_GLON ORDER BY dws.FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lon,
                -- Get coordinates from LAST row in segment (ordered by FROM_MEASURE)
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
        logger.info(f"🔨 Creating distress_segmented table with overlapping segment logic")
        client.query(segmentation_query).result()
        if segmentation_type == "fixed":
            logger.info(f"✅ distress_segmented table created with {num_segments} segments per route")
        else:
            logger.info(f"✅ distress_segmented table created with {segment_distance} mile segments")

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

        # Keep only routes with all segments across ALL years
        # Each segment must exist in every selected year
        if segmentation_type == "fixed":
            # For fixed segments, all routes should have exactly num_segments segments
            complete_segments_query = f"""
            CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented_complete` AS
            WITH segments_in_all_years AS (
                -- Get route-segment combinations that exist in all years
                SELECT ROUTE_NAME, segment_id
                FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
                GROUP BY ROUTE_NAME, segment_id
                HAVING COUNT(DISTINCT data_year) = {len(years)}
                   AND MIN(record_count) > 0
            ),
            routes_with_all_segments AS (
                -- Get routes that have all {num_segments} segments in all years
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
        else:  # distance-based
            # For distance segments, each route can have different number of segments
            # Just ensure each segment exists in all years
            complete_segments_query = f"""
            CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_segmented_complete` AS
            WITH segments_in_all_years AS (
                -- Get route-segment combinations that exist in all years
                SELECT ROUTE_NAME, segment_id
                FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
                GROUP BY ROUTE_NAME, segment_id
                HAVING COUNT(DISTINCT data_year) = {len(years)}
                   AND MIN(record_count) > 0
            ),
            route_expected_segments AS (
                -- For each route, get the expected number of segments (max segment_id)
                SELECT ROUTE_NAME, MAX(segment_id) AS expected_segments
                FROM `{PROJECT_ID}.{county_dataset}.distress_segmented`
                GROUP BY ROUTE_NAME
            ),
            routes_with_all_segments AS (
                -- Get routes where all expected segments exist in all years
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
        client.query(complete_segments_query).result()

        # Log filtering statistics
        filter_stats_query = f"""
        SELECT
            COUNT(DISTINCT ROUTE_NAME) as routes_with_complete_overlap,
            COUNT(*) as total_segments_in_all_years
        FROM `{PROJECT_ID}.{county_dataset}.distress_segmented_complete`
        """
        filter_stats = list(client.query(filter_stats_query).result())[0]
        logger.info(f"✅ Filtered to {filter_stats.routes_with_complete_overlap} routes with complete overlap across all {len(years)} years")
        logger.info(f"   Total segments (all years): {filter_stats.total_segments_in_all_years}")

        # Create final pivoted table with segment consistency checks
        iri_columns = [f"AVG(IF(data_year = {y}, avg_iri, NULL)) AS iri_{y}" for y in years]
        index_columns = [f"MAX(IF(data_year = {y}, row_indices, NULL)) AS index_{y}" for y in years]
        # Only require data for all selected years
        null_checks = [f"iri_{y} IS NOT NULL" for y in years]

        final_query = f"""
        CREATE OR REPLACE TABLE `{PROJECT_ID}.{county_dataset}.distress_final` AS
        WITH segment_consistency AS (
            SELECT ROUTE_NAME, segment_id,
                   -- Use MIN for start coordinates (earliest point) and MAX for end coordinates (latest point)
                   -- This ensures the segment spans the full extent across all years
                   MIN(from_lat) AS from_lat,
                   MIN(from_lon) AS from_lon,
                   MAX(to_lat) AS to_lat,
                   MAX(to_lon) AS to_lon,
                   -- Use consistent segment measures (should be same across all years)
                   AVG(segment_from_measure) AS from_measure,
                   AVG(segment_to_measure) AS to_measure,
                   -- Surface type should be consistent across years
                   MAX(surftype) AS surftype,
                   MAX(county_id) AS county_id,
                   COUNT(DISTINCT data_year) AS years_count,
                   {', '.join(iri_columns)},
                   {', '.join(index_columns)},
                   -- Check coordinate consistency (all years should have similar coords)
                   STDDEV(from_lat) AS from_lat_stddev,
                   STDDEV(from_lon) AS from_lon_stddev,
                   STDDEV(to_lat) AS to_lat_stddev,
                   STDDEV(to_lon) AS to_lon_stddev,
                   -- Check measure consistency
                   STDDEV(segment_from_measure) AS from_measure_stddev,
                   STDDEV(segment_to_measure) AS to_measure_stddev
            FROM `{PROJECT_ID}.{county_dataset}.distress_segmented_complete`
            GROUP BY ROUTE_NAME, segment_id
        )
        SELECT ROUTE_NAME, segment_id,
               from_measure, to_measure,
               -- Calculate length in feet (measures are in miles)
               ROUND((to_measure - from_measure) * 5280, 2) AS length_ft,
               from_lat, from_lon, to_lat, to_lon,
               county_id, surftype,
               years_count, {', '.join([f"iri_{y}" for y in years])},
               {', '.join([f"index_{y}" for y in years])}
        FROM segment_consistency
        WHERE {' AND '.join(null_checks)}
          -- Ensure segment measures are valid (from < to)
          AND from_measure < to_measure
          -- Ensure coordinates are consistent across years (within ~10 meters for interpolation variance)
          AND (from_lat_stddev IS NULL OR from_lat_stddev < 0.0001)
          AND (from_lon_stddev IS NULL OR from_lon_stddev < 0.0001)
          AND (to_lat_stddev IS NULL OR to_lat_stddev < 0.0001)
          AND (to_lon_stddev IS NULL OR to_lon_stddev < 0.0001)
          -- Ensure measure consistency (segments should have same boundaries across years)
          AND (from_measure_stddev IS NULL OR from_measure_stddev < 0.01)
          AND (to_measure_stddev IS NULL OR to_measure_stddev < 0.01)
          -- Ensure we have data for all required years
          AND years_count = {len(years)}
        ORDER BY ROUTE_NAME, segment_id
        """
        logger.info(f"🔨 Creating distress_final table with IRI columns for years: {years_list}")
        client.query(final_query).result()
        logger.info(f"✅ distress_final table created successfully")

        # Get statistics
        stats_query = f"""
        SELECT
            COUNT(*) AS total_rows,
            COUNT(DISTINCT ROUTE_NAME) AS unique_routes,
            CAST(COUNT(*) / {num_segments} AS INT64) AS expected_routes
        FROM `{PROJECT_ID}.{county_dataset}.distress_final`
        """
        stats = list(client.query(stats_query).result())[0]

        logger.info(f"🎉 SEGMENTATION COMPLETE!")
        logger.info(f"📊 Final Results:")
        logger.info(f"   • Years processed: {years_list}")
        logger.info(f"   • Routes: {stats.unique_routes}")
        logger.info(f"   • Total segments: {stats.total_rows}")
        if segmentation_type == "fixed":
            logger.info(f"   • Segments per route: {num_segments}")
        else:
            logger.info(f"   • Segment distance: {segment_distance} miles")

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
        logger.info(f"✅ Stored segmentation metadata: type={segmentation_type}, value={metadata_value}")

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


@app.get("/results")
def get_results(
    limit: int = 1000000,
    offset: int = 0,
    county_name: str = None,
    selected_years: str = None
):
    """
    Get the processed results from distress_final table for a specific county.
    Supports pagination and year filtering.

    Args:
        limit: Maximum number of rows to return (default: 1000000 to get all rows)
        offset: Number of rows to skip
        county_name: Name of the county (required)
        selected_years: Comma-separated list of years to include (optional)
    """
    try:
        if not county_name:
            raise HTTPException(
                status_code=400,
                detail="County name is required"
            )

        # Sanitize county name
        county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
        county_dataset = f"ipat_{county}"

        # Check if the distress_final table exists
        try:
            table_ref = f"{PROJECT_ID}.{county_dataset}.distress_final"
            client.get_table(table_ref)
        except NotFound:
            raise HTTPException(
                status_code=404,
                detail=f"No processed results found for {county_name} county. Please upload data and run the segmentation process first (Step 1 & 2)."
            )

        # Build column selection based on selected years
        if selected_years:
            selected_year_list = [y.strip() for y in selected_years.split(',')]
            logger.info(f"📊 Fetching results filtered to years: {selected_year_list}")

            # Get available IRI columns from the table schema
            table = client.get_table(table_ref)
            available_iri_cols = [field.name for field in table.schema if field.name.startswith('iri_')]
            available_years = [col.replace('iri_', '') for col in available_iri_cols]

            # Filter to only include years that exist in the processed data
            valid_years = [year for year in selected_year_list if year in available_years]

            if not valid_years:
                raise HTTPException(
                    status_code=400,
                    detail=f"None of the selected years ({', '.join(selected_year_list)}) exist in the processed data. Available years: {', '.join(available_years)}"
                )

            if len(valid_years) < len(selected_year_list):
                invalid_years = [year for year in selected_year_list if year not in available_years]
                logger.warning(f"⚠️ Ignoring invalid years: {invalid_years}. Available years: {available_years}")

            logger.info(f"✓ Using valid years: {valid_years}")

            # Select only IRI and index columns for valid years
            iri_cols = ', '.join([f'iri_{year}' for year in valid_years])
            index_cols = ', '.join([f'index_{year}' for year in valid_years])
            select_clause = f"""
                ROUTE_NAME, segment_id,
                from_measure, to_measure, length_ft,
                from_lat, from_lon, to_lat, to_lon,
                county_id, surftype,
                years_count, {iri_cols}, {index_cols}
            """

            # Filter to only rows that have data for ALL selected valid years
            # This ensures segment consistency across the selected time period
            where_conditions = ' AND '.join([f'iri_{year} IS NOT NULL' for year in valid_years])
            where_clause = f"WHERE {where_conditions}"
            logger.info(f"📋 WHERE clause: {where_clause}")
        else:
            select_clause = "*"
            where_clause = ""
            logger.info(f"📊 Fetching all results (no year filter)")

        # Get total count
        count_query = f"""
        SELECT COUNT(*) AS total
        FROM `{PROJECT_ID}.{county_dataset}.distress_final`
        {where_clause}
        """
        total = list(client.query(count_query).result())[0].total

        # Get paginated data
        query = f"""
        SELECT {select_clause}
        FROM `{PROJECT_ID}.{county_dataset}.distress_final`
        {where_clause}
        ORDER BY ROUTE_NAME, segment_id
        LIMIT {limit}
        OFFSET {offset}
        """

        result = client.query(query).result()
        rows = [dict(row) for row in result]

        logger.info(f"✅ Results query completed:")
        logger.info(f"   • Total rows matching filters: {total}")
        logger.info(f"   • Rows returned in this page: {len(rows)}")
        if len(rows) > 0:
            logger.info(f"   • Sample row columns: {list(rows[0].keys())}")
            logger.info(f"   • First row route: {rows[0].get('route_name', 'N/A')}")

        # Fetch segmentation metadata
        metadata = None
        try:
            metadata_query = f"""
            SELECT segmentation_type, segmentation_value, processed_years
            FROM `{PROJECT_ID}.{county_dataset}.segmentation_metadata`
            LIMIT 1
            """
            metadata_result = client.query(metadata_query).result()
            metadata_rows = list(metadata_result)
            if metadata_rows:
                metadata = {
                    "segmentation_type": metadata_rows[0].segmentation_type,
                    "segmentation_value": metadata_rows[0].segmentation_value,
                    "processed_years": metadata_rows[0].processed_years
                }
                logger.info(f"📋 Loaded metadata: {metadata}")
        except Exception as e:
            logger.warning(f"⚠️ Could not load metadata: {e}")

        return {
            "status": "success",
            "county": county_name,
            "dataset": county_dataset,
            "total": total,
            "limit": limit,
            "offset": offset,
            "selected_years": selected_years,
            "metadata": metadata,
            "data": rows
        }

    except HTTPException:
        # Re-raise HTTP exceptions (like our 404 check above)
        raise
    except Exception as e:
        error_str = str(e)
        logger.error(f"Results error: {error_str}")

        # Check if it's a table not found error from BigQuery
        if "Not found: Table" in error_str and "distress_final" in error_str:
            raise HTTPException(
                status_code=404,
                detail=f"No processed results found for {county_name} county. Please upload data and run the segmentation process first (Step 1 & 2)."
            )

        raise HTTPException(status_code=500, detail=error_str)


@app.get("/counties")
def list_counties():
    """
    List all counties that have datasets (ipat_* datasets).
    """
    try:
        # List all datasets that start with 'ipat_'
        datasets = list(client.list_datasets())
        counties = []
        
        for dataset in datasets:
            ds_id = dataset.dataset_id
            if ds_id.startswith('ipat_') and ds_id != 'ipat_dataset':
                county = ds_id.replace('ipat_', '')
                counties.append(county)

        return {
            "status": "success",
            "count": len(counties),
            "counties": sorted(counties)
        }

    except Exception as e:
        logger.error(f"List counties error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tables")
def list_tables(county_name: str = None):
    """
    List all tables in BigQuery.
    If county_name is provided, list tables in that county's dataset.

    Args:
        county_name: Optional county name to filter tables
    """
    try:
        if county_name:
            county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
            county_dataset = f"ipat_{county}"
            
            query = f"""
            SELECT table_name
            FROM `{PROJECT_ID}.{county_dataset}.INFORMATION_SCHEMA.TABLES`
            ORDER BY table_name
            """
            
            result = client.query(query).result()
            tables = [
                {
                    "table_name": row.table_name,
                    "dataset": county_dataset,
                    "county": county
                }
                for row in result
            ]
        else:
            # List all ipat_ datasets and their tables
            datasets = list(client.list_datasets())
            tables = []
            
            for dataset in datasets:
                ds_id = dataset.dataset_id
                if ds_id.startswith('ipat_'):
                    try:
                        query = f"""
                        SELECT table_name
                        FROM `{PROJECT_ID}.{ds_id}.INFORMATION_SCHEMA.TABLES`
                        ORDER BY table_name
                        """
                        result = client.query(query).result()
                        for row in result:
                            tables.append({
                                "table_name": row.table_name,
                                "dataset": ds_id,
                                "county": ds_id.replace('ipat_', '') if ds_id != 'ipat_dataset' else None
                            })
                    except:
                        pass

        return {
            "status": "success",
            "count": len(tables),
            "county_filter": county_name,
            "tables": tables
        }

    except Exception as e:
        logger.error(f"List tables error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/clear")
def clear_data(county_name: str = None):
    """
    Clear data for a county (deletes the entire dataset).
    If county_name is provided, only clear that county's dataset.
    Otherwise, clear all ipat_* datasets.

    Args:
        county_name: Optional county name to filter deletion
    """
    try:
        deleted_datasets = []
        
        if county_name:
            county = re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())
            county_dataset = f"ipat_{county}"
            
            try:
                client.delete_dataset(f"{PROJECT_ID}.{county_dataset}", delete_contents=True)
                deleted_datasets.append(county_dataset)
                logger.info(f"Deleted dataset: {county_dataset}")
            except Exception as e:
                logger.warning(f"Could not delete dataset {county_dataset}: {e}")
            
            message = f"Cleared dataset for county {county_name}"
        else:
            # Delete all ipat_ datasets except the default
            datasets = list(client.list_datasets())
            for dataset in datasets:
                ds_id = dataset.dataset_id
                if ds_id.startswith('ipat_') and ds_id != 'ipat_dataset':
                    try:
                        client.delete_dataset(f"{PROJECT_ID}.{ds_id}", delete_contents=True)
                        deleted_datasets.append(ds_id)
                        logger.info(f"Deleted dataset: {ds_id}")
                    except Exception as e:
                        logger.warning(f"Could not delete dataset {ds_id}: {e}")
            
            message = f"Cleared {len(deleted_datasets)} dataset(s)"

        return {
            "status": "success",
            "message": message,
            "county": county_name,
            "deleted_datasets": deleted_datasets
        }

    except Exception as e:
        logger.error(f"Clear error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8010)
