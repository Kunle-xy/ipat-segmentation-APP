from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List
import pandas as pd
import pandas_gbq
import postgres
import io
import re
import time
import logging

from config import (
    PROJECT_ID, GCS_UPLOAD_BUCKET,
    get_credentials, get_storage_client, generate_put_signed_url,
    ensure_dataset_exists,
)
from utils import clean_and_cast_columns

logger = logging.getLogger(__name__)
router = APIRouter()

# Allowed upload extensions
ALLOWED_EXTS = ('.xlsx', '.xls', '.csv')


def _sanitize_county(county_name: str) -> str:
    """Sanitize a county name into a dataset-safe slug."""
    return re.sub(r'[^a-z0-9_]', '_', county_name.lower().strip())


def _extract_year(filename: str) -> str:
    """Extract the (digit) year from a filename, stripping the extension."""
    filename_clean = filename
    for ext in ['.xlsx', '.xls', '.csv']:
        filename_clean = filename_clean.replace(ext, '').replace(ext.upper(), '')
    return ''.join(filter(str.isdigit, filename_clean))


def _read_dataframe(contents: bytes, filename: str) -> pd.DataFrame:
    """Read raw file bytes into a DataFrame based on its extension."""
    if filename.lower().endswith('.csv'):
        return pd.read_csv(io.BytesIO(contents))
    return pd.read_excel(io.BytesIO(contents), engine='openpyxl')


def _process_dataframe(df: pd.DataFrame, filename: str, county_name: str):
    """Clean a raw distress DataFrame and load it into the configured database.

    Shared by the legacy multipart /upload path and the GCS-backed /ingest path.
    Returns the per-file result dict.
    """
    county = _sanitize_county(county_name)
    county_dataset = f"ipat_{county}"

    year = _extract_year(filename)
    if not year:
        raise HTTPException(
            status_code=400,
            detail=f"Could not extract year from filename: {filename}"
        )

    # Validate required columns
    required_columns = [
        "ROUTE_NAME", "FROM_MEASURE", "TO_MEASURE",
        "BEGIN_GLAT", "BEGIN_GLON", "END_GLAT", "END_GLON",
        "IRI", "COUNTY_ID", "SURFTYPE"
    ]

    # Normalize column names (strip whitespace, uppercase)
    df.columns = [col.strip().upper() for col in df.columns]

    # Compute IRI from LIRI/RIRI if IRI column is missing
    if "IRI" not in df.columns and "LIRI" in df.columns and "RIRI" in df.columns:
        df["LIRI"] = pd.to_numeric(df["LIRI"], errors="coerce")
        df["RIRI"] = pd.to_numeric(df["RIRI"], errors="coerce")
        df["IRI"] = df[["LIRI", "RIRI"]].mean(axis=1)
        logger.info(f"Computed IRI from LIRI/RIRI for {filename}")

    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns in {filename}: {', '.join(missing_columns)}. Check the File Format Guide for required columns."
        )

    # Clean and cast all columns properly
    df = clean_and_cast_columns(df, filename)

    # Fix anomalies: swap FROM_MEASURE and TO_MEASURE if FROM > TO
    df['anom'] = df['FROM_MEASURE'] > df['TO_MEASURE']
    anomaly_index = df[df['anom']].index
    if not anomaly_index.empty:
        cols_to_fix = ['FROM_MEASURE', 'TO_MEASURE', 'BEGIN_GLAT', 'BEGIN_GLON', 'END_GLAT', 'END_GLON']
        cols_source = ['TO_MEASURE', 'FROM_MEASURE', 'END_GLAT', 'END_GLON', 'BEGIN_GLAT', 'BEGIN_GLON']
        df.loc[anomaly_index, cols_to_fix] = df.loc[anomaly_index, cols_source].values
        logger.info(f"Fixed {len(anomaly_index)} anomalous rows (FROM_MEASURE > TO_MEASURE)")
    df = df.drop(columns=['anom'])

    # Fill NULL IRI values from LIRI/RIRI where available
    if "LIRI" in df.columns and "RIRI" in df.columns:
        iri_null = df["IRI"].isna()
        if iri_null.any():
            df.loc[iri_null, "IRI"] = df.loc[iri_null, ["LIRI", "RIRI"]].mean(axis=1)
            filled = iri_null.sum() - df["IRI"].isna().sum()
            logger.info(f"Filled {filled} NULL IRI values from LIRI/RIRI in {filename}")

    # Only drop rows with null ROUTE_NAME
    df = df.dropna(subset=["ROUTE_NAME"])

    table_name = f"raw_distress_{year}"
    destination_table = f"{county_dataset}.{table_name}"
    logger.info(f"Uploading {len(df)} rows to {destination_table}")

    if postgres.DATABASE_URL:
        postgres.load_distress(df, county_dataset, table_name)
    else:
        ensure_dataset_exists(county_dataset)
        pandas_gbq.to_gbq(
            df,
            destination_table=destination_table,
            project_id=PROJECT_ID,
            credentials=get_credentials(),
            if_exists='replace',  # WRITE_TRUNCATE
            progress_bar=False
        )

    logger.info(f"Uploaded {filename} to {county_dataset}.{table_name} with {len(df)} rows")
    return {
        "filename": filename,
        "county": county_name,
        "dataset": county_dataset,
        "year": year,
        "table_name": table_name,
        "rows": len(df),
    }


@router.post("/upload-url")
def create_upload_url(county_name: str = None, filename: str = None):
    """Mint a short-lived signed URL so the browser can PUT a file directly to
    Cloud Storage, bypassing Cloud Run's 32MB request-body limit.

    Returns the signed URL plus the blob path to hand back to /ingest.
    """
    if postgres.DATABASE_URL:
        raise HTTPException(status_code=404, detail="Cloud Storage uploads are disabled")
    if not county_name:
        raise HTTPException(status_code=400, detail="County name is required")
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")
    if not filename.lower().endswith(ALLOWED_EXTS):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTS)}"
        )

    county = _sanitize_county(county_name)
    safe_name = re.sub(r'[^A-Za-z0-9._-]', '_', filename)
    blob_path = f"uploads/{county}/{int(time.time())}_{safe_name}"

    try:
        upload_url = generate_put_signed_url(blob_path, minutes=30)
    except Exception as e:
        logger.error(f"Failed to create signed upload URL: {e}")
        raise HTTPException(status_code=500, detail=f"Could not create upload URL: {str(e)}")

    return {
        "status": "success",
        "upload_url": upload_url,
        "blob_path": blob_path,
        "bucket": GCS_UPLOAD_BUCKET,
        "method": "PUT",
    }


@router.post("/ingest")
def ingest_from_gcs(county_name: str = None, blob_path: str = None, filename: str = None):
    """Ingest a file that was uploaded directly to GCS via a signed URL.

    Downloads the object server-side (no request-size limit between Cloud Run
    and GCS), then runs the same cleaning + BigQuery load as /upload.
    """
    if postgres.DATABASE_URL:
        raise HTTPException(status_code=404, detail="Cloud Storage uploads are disabled")
    if not county_name:
        raise HTTPException(status_code=400, detail="County name is required")
    if not blob_path:
        raise HTTPException(status_code=400, detail="blob_path is required")

    # Derive the display filename from the blob path if not supplied
    if not filename:
        filename = blob_path.rsplit('/', 1)[-1]
        # Strip the "{timestamp}_" prefix added by /upload-url
        filename = re.sub(r'^\d+_', '', filename)

    try:
        bucket = get_storage_client().bucket(GCS_UPLOAD_BUCKET)
        blob = bucket.blob(blob_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail=f"Uploaded file not found in storage: {blob_path}")
        contents = blob.download_as_bytes()
        logger.info(f"Downloaded {len(contents)} bytes from gs://{GCS_UPLOAD_BUCKET}/{blob_path}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download {blob_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not read uploaded file: {str(e)}")

    try:
        df = _read_dataframe(contents, filename)
        logger.info(f"Loaded DataFrame with {len(df)} rows, {len(df.columns)} columns from {filename}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file {filename}: {str(e)}")

    result = _process_dataframe(df, filename, county_name)

    # Best-effort cleanup of the staged upload
    try:
        blob.delete()
    except Exception as e:
        logger.warning(f"Could not delete staged upload {blob_path}: {e}")

    return {
        "status": "success",
        "message": f"Ingested {filename} to dataset 'ipat_{_sanitize_county(county_name)}'",
        "county": county_name,
        "dataset": result["dataset"],
        "tables": [result],
    }


@router.post("/upload")
def upload_files(files: List[UploadFile] = File(...), county_name: str = None):
    """
    Upload Excel/CSV distress files via multipart.
    The hosted frontend uses /upload-url + /ingest to bypass Cloud Run request limits.

    Args:
        files: Excel/CSV files to upload
        county_name: Name of the county (required) - used as dataset name
    """
    try:
        if not county_name:
            raise HTTPException(status_code=400, detail="County name is required")

        county_dataset = f"ipat_{_sanitize_county(county_name)}"
        uploaded_tables = []

        for file in files:
            contents = file.file.read()
            logger.info(f"Read {len(contents)} bytes from {file.filename}")
            try:
                df = _read_dataframe(contents, file.filename)
                logger.info(f"Loaded DataFrame with {len(df)} rows, {len(df.columns)} columns")
            except Exception as e1:
                logger.error(f"Failed to read file: {e1}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not read file {file.filename}: {str(e1)}"
                )

            result = _process_dataframe(df, file.filename, county_name)
            uploaded_tables.append(result)

        return {
            "status": "success",
            "message": f"Uploaded {len(files)} file(s) to dataset '{county_dataset}'",
            "county": county_name,
            "dataset": county_dataset,
            "tables": uploaded_tables
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
