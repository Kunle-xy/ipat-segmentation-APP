"""
Unit tests for utility functions in main.py
"""
import pytest
import pandas as pd
import numpy as np
from unittest.mock import patch
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestCleanAndCastColumns:
    """Tests for the clean_and_cast_columns function."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Import function with mocked credentials."""
        with patch('main.service_account.Credentials.from_service_account_file'):
            with patch('main.bigquery.Client'):
                from main import clean_and_cast_columns
                self.clean_and_cast_columns = clean_and_cast_columns

    def test_converts_numeric_columns(self):
        """Test that numeric columns are properly converted."""
        df = pd.DataFrame({
            'FROM_MEASURE': ['1.5', '2.0', '3.5'],
            'TO_MEASURE': ['2.0', '3.0', '4.5'],
            'IRI': ['85', '90', '75']
        })
        
        result = self.clean_and_cast_columns(df)
        
        assert result['FROM_MEASURE'].dtype in [np.float64, float]
        assert result['TO_MEASURE'].dtype in [np.float64, float]
        assert result['IRI'].dtype in [np.float64, float]

    def test_handles_invalid_numeric_values(self):
        """Test that invalid values are converted to NaN."""
        df = pd.DataFrame({
            'IRI': ['85', 'invalid', '75'],
            'FROM_MEASURE': ['1.0', '', '3.0']
        })
        
        result = self.clean_and_cast_columns(df)
        
        assert pd.isna(result['IRI'].iloc[1])

    def test_handles_infinity_values(self):
        """Test that infinity values are handled."""
        df = pd.DataFrame({
            'IRI': [85.0, np.inf, -np.inf],
            'FROM_MEASURE': [1.0, 2.0, 3.0]
        })
        
        result = self.clean_and_cast_columns(df)
        
        assert pd.isna(result['IRI'].iloc[1])
        assert pd.isna(result['IRI'].iloc[2])

    def test_string_columns_preserved(self):
        """Test that string columns are converted to strings."""
        df = pd.DataFrame({
            'ROUTE_NAME': ['US-30', 'I-80', None],
            'SURFTYPE': ['AC', 'PCC', 'AC']
        })
        
        result = self.clean_and_cast_columns(df)
        
        assert result['ROUTE_NAME'].dtype == object
        assert result['SURFTYPE'].dtype == object

    def test_empty_dataframe(self):
        """Test handling of empty DataFrame."""
        df = pd.DataFrame()
        
        result = self.clean_and_cast_columns(df)
        
        assert len(result) == 0


class TestCleanRecordForJson:
    """Tests for the clean_record_for_json function."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Import function with mocked credentials."""
        with patch('main.service_account.Credentials.from_service_account_file'):
            with patch('main.bigquery.Client'):
                from main import clean_record_for_json
                self.clean_record_for_json = clean_record_for_json

    def test_handles_none_values(self):
        """Test that None values are preserved."""
        record = {'field': None}
        
        result = self.clean_record_for_json(record)
        
        assert result['field'] is None

    def test_handles_nan_values(self):
        """Test that NaN values become None."""
        record = {'field': np.nan}
        
        result = self.clean_record_for_json(record)
        
        assert result['field'] is None

    def test_handles_numpy_integers(self):
        """Test that numpy integers are converted to Python int."""
        record = {'field': np.int64(42)}
        
        result = self.clean_record_for_json(record)
        
        assert result['field'] == 42
        assert isinstance(result['field'], int)

    def test_handles_numpy_floats(self):
        """Test that numpy floats are converted to Python float."""
        record = {'field': np.float64(3.14)}
        
        result = self.clean_record_for_json(record)
        
        assert abs(result['field'] - 3.14) < 0.001
        assert isinstance(result['field'], float)

    def test_handles_infinity(self):
        """Test that infinity values become None."""
        record = {'pos_inf': np.inf, 'neg_inf': -np.inf}
        
        result = self.clean_record_for_json(record)
        
        assert result['pos_inf'] is None
        assert result['neg_inf'] is None

    def test_preserves_regular_values(self):
        """Test that regular values are preserved."""
        record = {
            'string': 'hello',
            'integer': 42,
            'float': 3.14
        }
        
        result = self.clean_record_for_json(record)
        
        assert result['string'] == 'hello'
        assert result['integer'] == 42
        assert result['float'] == 3.14


class TestYearExtraction:
    """Tests for year extraction from filenames."""

    def test_extracts_year_from_filename(self):
        """Test extracting 4-digit year from filename."""
        import re
        
        filenames = [
            ('distress_2020.xlsx', '2020'),
            ('2021_data.xlsx', '2021'),
            ('data_2019_final.xlsx', '2019'),
            ('2022.xlsx', '2022'),
        ]
        
        for filename, expected_year in filenames:
            match = re.search(r'(19|20)\d{2}', filename)
            assert match is not None, f"Failed to extract year from {filename}"
            assert match.group() == expected_year

    def test_no_year_in_filename(self):
        """Test handling filename without year."""
        import re
        
        filename = 'data_file.xlsx'
        match = re.search(r'(19|20)\d{2}', filename)
        
        assert match is None
