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

# Lazy initialization for BigQuery client
_client = None
_credentials = None


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
