from fastapi import APIRouter, HTTPException
from google.cloud.exceptions import NotFound
import re
import logging

from config import PROJECT_ID, get_bigquery_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/results")
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
        client = get_bigquery_client()

        # Check if the distress_final table exists
        try:
            table_ref = f"{PROJECT_ID}.{county_dataset}.distress_final"
            client.get_table(table_ref)
        except NotFound:
            raise HTTPException(
                status_code=404,
                detail=f"No processed results found for {county_name} county. Please upload data and run the segmentation process first (Step 1 & 2)."
            )

        # Inspect schema once — drives both column selection and ORDER BY
        table_obj = client.get_table(table_ref)
        schema_names = {field.name for field in table_obj.schema}
        has_route_id = 'ROUTE_ID' in schema_names
        order_by = "ROUTE_ID, segment_id" if has_route_id else "ROUTE_NAME, segment_id"
        route_id_col = "ROUTE_ID, " if has_route_id else ""

        # Build column selection based on selected years
        if selected_years:
            selected_year_list = [y.strip() for y in selected_years.split(',')]
            logger.info(f"Fetching results filtered to years: {selected_year_list}")

            available_iri_cols = [field.name for field in table_obj.schema if field.name.startswith('iri_')]
            available_years = [col.replace('iri_', '') for col in available_iri_cols]

            valid_years = [year for year in selected_year_list if year in available_years]

            if not valid_years:
                raise HTTPException(
                    status_code=400,
                    detail=f"None of the selected years ({', '.join(selected_year_list)}) exist in the processed data. Available years: {', '.join(available_years)}"
                )

            if len(valid_years) < len(selected_year_list):
                invalid_years = [year for year in selected_year_list if year not in available_years]
                logger.warning(f"Ignoring invalid years: {invalid_years}. Available years: {available_years}")

            logger.info(f"Using valid years: {valid_years}")

            iri_cols = ', '.join([f'iri_{year}' for year in valid_years])
            index_cols = ', '.join([f'index_{year}' for year in valid_years])

            # Include liri_/riri_ columns only for years where they exist in the schema
            available_liri = {field.name for field in table_obj.schema if field.name.startswith('liri_')}
            available_riri = {field.name for field in table_obj.schema if field.name.startswith('riri_')}
            liri_cols = ', '.join([f'liri_{year}' for year in valid_years if f'liri_{year}' in available_liri])
            riri_cols = ', '.join([f'riri_{year}' for year in valid_years if f'riri_{year}' in available_riri])
            lr_clause = ''
            if liri_cols:
                lr_clause += f', {liri_cols}'
            if riri_cols:
                lr_clause += f', {riri_cols}'

            select_clause = f"""
                {route_id_col}ROUTE_NAME, segment_id,
                from_measure, to_measure, length_ft,
                from_lat, from_lon, to_lat, to_lon,
                county_id, surftype,
                years_count, {iri_cols}, {index_cols}{lr_clause}
            """

            where_conditions = ' AND '.join([f'iri_{year} IS NOT NULL' for year in valid_years])
            where_clause = f"WHERE {where_conditions}"
            logger.info(f"WHERE clause: {where_clause}")
        else:
            select_clause = "*"
            where_clause = ""
            logger.info(f"Fetching all results (no year filter)")

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
        ORDER BY {order_by}
        LIMIT {limit}
        OFFSET {offset}
        """

        result = client.query(query).result()
        rows = [dict(row) for row in result]

        logger.info(f"Results query completed: Total={total}, Returned={len(rows)}")

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
                logger.info(f"Loaded metadata: {metadata}")
        except Exception as e:
            logger.warning(f"Could not load metadata: {e}")

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
        raise
    except Exception as e:
        error_str = str(e)
        logger.error(f"Results error: {error_str}")

        if "Not found: Table" in error_str and "distress_final" in error_str:
            raise HTTPException(
                status_code=404,
                detail=f"No processed results found for {county_name} county. Please upload data and run the segmentation process first (Step 1 & 2)."
            )

        raise HTTPException(status_code=500, detail=error_str)
