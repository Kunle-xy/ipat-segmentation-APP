import os
import logging
from dotenv import load_dotenv
from google.cloud import bigquery
from google.oauth2 import service_account

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# BigQuery setup
PROJECT_ID = os.getenv("GCP_PROJECT_ID", "vernal-citadel-479904-i2")
DATASET_ID = os.getenv("GCP_DATASET_ID", "ipat_dataset")
CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
DATABASE_URL = os.getenv("DATABASE_URL")

# GCS bucket used for direct browser uploads (bypasses Cloud Run's 32MB
# request-body limit). Files are PUT straight to GCS via a signed URL, then
# ingested server-side.
GCS_UPLOAD_BUCKET = os.getenv("GCS_UPLOAD_BUCKET", f"ipat-uploads-{PROJECT_ID}")

# Lazy initialization for BigQuery client
_client = None
_credentials = None
_storage_client = None


def get_bigquery_client():
    """Get BigQuery client with lazy initialization."""
    global _client, _credentials
    if _client is None:
        if CREDENTIALS_PATH and os.path.exists(CREDENTIALS_PATH):
            _credentials = service_account.Credentials.from_service_account_file(CREDENTIALS_PATH)
            _client = bigquery.Client(credentials=_credentials, project=PROJECT_ID)
        else:
            # Use Application Default Credentials (works in Cloud Run)
            _client = bigquery.Client(project=PROJECT_ID)
            _credentials = _client._credentials
    return _client


def get_credentials():
    """Get credentials, initializing client if needed."""
    global _credentials
    if _credentials is None:
        get_bigquery_client()
    return _credentials


def get_storage_client():
    """Get a Cloud Storage client (lazy), using the same service-account
    credentials as BigQuery so it can mint signed upload URLs."""
    global _storage_client
    if _storage_client is None:
        from google.cloud import storage
        creds = get_credentials()
        if creds is not None:
            _storage_client = storage.Client(project=PROJECT_ID, credentials=creds)
        else:
            _storage_client = storage.Client(project=PROJECT_ID)
    return _storage_client


def generate_put_signed_url(blob_path, minutes=30):
    """Generate a v4 signed URL for a PUT upload to the uploads bucket.

    Works in two environments:
      - Local/dev with a service-account key file: signs directly with the key.
      - Cloud Run with ADC (no key in image): signs via the IAM signBlob API
        using the runtime service account's access token. The runtime SA needs
        roles/iam.serviceAccountTokenCreator on itself plus object access on the
        bucket.
    """
    from datetime import timedelta
    from google.oauth2 import service_account
    from google.auth.transport import requests as grequests

    blob = get_storage_client().bucket(GCS_UPLOAD_BUCKET).blob(blob_path)
    creds = get_credentials()

    # Service-account key file (has a private key) -> sign locally.
    if isinstance(creds, service_account.Credentials):
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=minutes),
            method="PUT",
        )

    # ADC (e.g. Cloud Run): sign through the IAM API with a fresh token.
    creds.refresh(grequests.Request())
    sa_email = getattr(creds, "service_account_email", None)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=minutes),
        method="PUT",
        service_account_email=sa_email,
        access_token=creds.token,
    )


def ensure_dataset_exists(dataset_name=None):
    """Create dataset if it doesn't exist"""
    ds_id = dataset_name if dataset_name else DATASET_ID
    dataset_id = f"{PROJECT_ID}.{ds_id}"
    try:
        get_bigquery_client().get_dataset(dataset_id)
        logger.info(f"Dataset {dataset_id} already exists")
    except Exception:
        dataset = bigquery.Dataset(dataset_id)
        dataset.location = "US"
        get_bigquery_client().create_dataset(dataset)
        logger.info(f"Created dataset {dataset_id}")
    return ds_id
