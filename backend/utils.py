import pandas as pd
import numpy as np


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
