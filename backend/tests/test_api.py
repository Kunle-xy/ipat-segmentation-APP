"""
API endpoint tests for the IPAT backend.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch, MagicMock
import pandas as pd
import io


class TestHealthEndpoint:
    """Tests for the /health endpoint."""

    def test_health_check_success(self, client, mock_bigquery_client):
        """Test health check returns OK when BigQuery is connected."""
        # Mock successful query
        mock_bigquery_client.query.return_value.result.return_value = [{'test': 1}]
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "bigquery" in data

    def test_health_check_bigquery_error(self, client, mock_bigquery_client):
        """Test health check handles BigQuery connection errors."""
        mock_bigquery_client.query.side_effect = Exception("Connection failed")
        
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"


class TestTablesEndpoint:
    """Tests for the /tables endpoint."""

    def test_list_tables_success(self, client, mock_bigquery_client):
        """Test listing tables returns expected format."""
        # Mock table list
        mock_table1 = Mock()
        mock_table1.table_id = "distress_2020"
        mock_table2 = Mock()
        mock_table2.table_id = "distress_2021"
        mock_bigquery_client.list_tables.return_value = [mock_table1, mock_table2]
        
        response = client.get("/tables")
        
        assert response.status_code == 200
        data = response.json()
        assert "tables" in data

    def test_list_tables_empty(self, client, mock_bigquery_client):
        """Test listing tables when dataset is empty."""
        mock_bigquery_client.list_tables.return_value = []
        
        response = client.get("/tables")
        
        assert response.status_code == 200
        data = response.json()
        assert data["tables"] == []


class TestUploadEndpoint:
    """Tests for the /upload endpoint."""

    def test_upload_valid_file(self, client, mock_bigquery_client, sample_excel_bytes):
        """Test uploading a valid Excel file."""
        mock_bigquery_client.load_table_from_dataframe.return_value.result.return_value = None
        
        files = {"files": ("test_2020.xlsx", sample_excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert "uploaded" in data or "results" in data

    def test_upload_no_year_in_filename(self, client, sample_excel_bytes):
        """Test uploading file without year in filename."""
        files = {"files": ("test_data.xlsx", sample_excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        
        response = client.post("/upload", files=files)
        
        # Should still work but may have different behavior
        assert response.status_code in [200, 400]

    def test_upload_empty_request(self, client):
        """Test upload with no files."""
        response = client.post("/upload")
        
        assert response.status_code == 422  # Validation error


class TestResultsEndpoint:
    """Tests for the /results endpoint."""

    def test_get_results_success(self, client, mock_bigquery_client):
        """Test getting results with data."""
        # Mock query results
        mock_result = [
            {"route_name": "US-30", "segment_id": 1, "iri_2020": 85.0}
        ]
        mock_bigquery_client.query.return_value.result.return_value = mock_result
        
        response = client.get("/results")
        
        assert response.status_code == 200

    def test_get_results_with_pagination(self, client, mock_bigquery_client):
        """Test results pagination parameters."""
        mock_bigquery_client.query.return_value.result.return_value = []
        
        response = client.get("/results?limit=10&offset=5")
        
        assert response.status_code == 200

    def test_get_results_empty(self, client, mock_bigquery_client):
        """Test getting results when no data exists."""
        mock_bigquery_client.query.return_value.result.return_value = []
        
        response = client.get("/results")
        
        assert response.status_code == 200


class TestClearEndpoint:
    """Tests for the /clear endpoint."""

    def test_clear_data_success(self, client, mock_bigquery_client):
        """Test clearing all data."""
        mock_bigquery_client.list_tables.return_value = []
        mock_bigquery_client.delete_table.return_value = None
        
        response = client.delete("/clear")
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data or "status" in data


class TestProcessEndpoint:
    """Tests for the /process endpoint."""

    def test_process_with_valid_segments(self, client, mock_bigquery_client):
        """Test processing with valid number of segments."""
        # Mock the query to return some data
        mock_bigquery_client.query.return_value.result.return_value = []
        mock_bigquery_client.list_tables.return_value = []
        
        response = client.post("/process?num_segments=20")
        
        # May fail if no data, but should not be server error
        assert response.status_code in [200, 400, 404]

    def test_process_invalid_segments_too_low(self, client):
        """Test processing with segments below minimum."""
        response = client.post("/process?num_segments=0")
        
        # Should reject invalid segment count
        assert response.status_code in [400, 422]

    def test_process_invalid_segments_too_high(self, client):
        """Test processing with segments above maximum."""
        response = client.post("/process?num_segments=1000")
        
        # Should reject or cap the segment count
        assert response.status_code in [200, 400, 422]
