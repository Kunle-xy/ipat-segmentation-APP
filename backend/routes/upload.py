from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List
import pandas as pd
import pandas_gbq
import io
import re
import logging

from config import PROJECT_ID, get_credentials, ensure_dataset_exists
from utils import clean_and_cast_columns

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload")
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
                logger.info(f"Fixed {len(anomaly_index)} anomalous rows (FROM_MEASURE > TO_MEASURE)")
            else:
                logger.info(f"No anomalies found (all FROM_MEASURE <= TO_MEASURE)")

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
                credentials=get_credentials(),
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
