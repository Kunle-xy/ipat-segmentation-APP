"""
Pytest configuration and fixtures for backend tests.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch, MagicMock
import pandas as pd
import numpy as np
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def mock_bigquery_client():
    """Mock BigQuery client for testing without GCP credentials."""
    with patch('main.client') as mock_client:
        mock_client.query.return_value.result.return_value = []
        mock_client.get_table.return_value = Mock()
        yield mock_client


@pytest.fixture
def mock_credentials():
    """Mock GCP credentials."""
    with patch('main.credentials') as mock_creds:
        yield mock_creds


@pytest.fixture
def client(mock_bigquery_client, mock_credentials):
    """Create test client with mocked dependencies."""
    from main import app
    return TestClient(app)


@pytest.fixture
def sample_dataframe():
    """Create a sample DataFrame for testing."""
    return pd.DataFrame({
        'ROUTE_NAME': ['US-30', 'US-30', 'I-80'],
        'FROM_MEASURE': [0.0, 1.0, 0.0],
        'TO_MEASURE': [1.0, 2.0, 1.0],
        'BEGIN_GLAT': [41.5, 41.6, 42.0],
        'BEGIN_GLON': [-93.5, -93.4, -93.0],
        'END_GLAT': [41.6, 41.7, 42.1],
        'END_GLON': [-93.4, -93.3, -92.9],
        'IRI': [85.0, 90.0, 75.0],
        'COUNTY_ID': [77, 77, 50],
        'SURFTYPE': ['AC', 'AC', 'PCC'],
        'FCLASS': ['1', '1', '1'],
        'WIDTH': [24.0, 24.0, 24.0]
    })


@pytest.fixture
def sample_excel_bytes(sample_dataframe):
    """Create sample Excel file bytes for upload testing."""
    import io
    buffer = io.BytesIO()
    sample_dataframe.to_excel(buffer, index=False)
    buffer.seek(0)
    return buffer.getvalue()
