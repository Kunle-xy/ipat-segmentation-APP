# County-Based Data Organization

## Overview

The IPAT Segmentation Analysis application now organizes all data by county. Each county's data is stored in separate BigQuery tables, allowing you to:

- Process data for multiple counties independently
- Compare results across different counties
- Maintain clean data separation

## How It Works

### 1. County Name Input

Before uploading any data, you must specify the county name. This name will be used to:
- Prefix all raw data tables
- Organize processed results
- Filter queries and results

### 2. Table Naming Convention

All tables are named with the county as a prefix:

**Raw Data Tables:**
- Format: `ipat_raw_distress_{county}_{year}`
- Examples:
  - `ipat_raw_distress_alameda_2020`
  - `ipat_raw_distress_alameda_2021`
  - `ipat_raw_distress_santa_clara_2020`
  - `ipat_raw_distress_los_angeles_2022`

**Processed Tables:**
- `ipat_all_years_{county}` - Combined data across years
- `ipat_valid_routes_{county}` - Routes with 2+ consecutive years
- `ipat_distress_segmented_{county}` - All segments
- `ipat_distress_segmented_complete_{county}` - Complete segments only
- `ipat_distress_final_{county}` - Final pivoted results

### 3. County Name Sanitization

County names are automatically sanitized to ensure valid BigQuery table names:
- Converted to lowercase
- Spaces replaced with underscores
- Special characters replaced with underscores

**Examples:**
- "Alameda" → `alameda`
- "Santa Clara" → `santa_clara`
- "Los Angeles County" → `los_angeles_county`
- "St. Louis" → `st_louis`

## Using the Application

### Step-by-Step Workflow

#### 1. Enter County Name

On the main page, enter the county name in the "County Information" section:

```
County Name: Alameda
```

This field is required before you can upload files or process data.

#### 2. Upload Files

Upload Excel files for that county. Files must still be named with the year:

```
2020.xlsx
2021.xlsx
2022.xlsx
```

These will be uploaded as:
```
ipat_raw_distress_alameda_2020
ipat_raw_distress_alameda_2021
ipat_raw_distress_alameda_2022
```

#### 3. Process Data

Select the number of segments and click "Run Segmentation". The pipeline will:
- Only process data for the selected county
- Create county-specific result tables
- Display statistics for that county

#### 4. View Results

Results are automatically filtered by county. The results table shows data only for the selected county.

## Working with Multiple Counties

### Scenario 1: Uploading Data for Multiple Counties

To work with multiple counties, simply change the county name and upload new files:

```
1. Set County: "Alameda"
2. Upload files: 2020.xlsx, 2021.xlsx
3. Process data

4. Set County: "Santa Clara"
5. Upload files: 2020.xlsx, 2021.xlsx, 2022.xlsx
6. Process data

7. Set County: "Los Angeles"
8. Upload files: 2019.xlsx, 2020.xlsx, 2021.xlsx, 2022.xlsx
9. Process data
```

Each county's data is completely separate.

### Scenario 2: Viewing Available Counties

Use the API endpoint to see all counties with data:

```bash
curl http://localhost:8010/counties
```

Response:
```json
{
  "status": "success",
  "count": 3,
  "counties": ["alameda", "los_angeles", "santa_clara"]
}
```

### Scenario 3: Comparing Counties

To compare results across counties, fetch results for each county separately:

```python
import requests

counties = ["alameda", "santa_clara", "los_angeles"]
results = {}

for county in counties:
    response = requests.get(
        "http://localhost:8010/results",
        params={"county_name": county, "limit": 1000}
    )
    results[county] = response.json()["data"]

# Now analyze results across counties
```

## API Endpoints

### GET /counties

List all counties with uploaded data.

**Request:**
```bash
GET http://localhost:8010/counties
```

**Response:**
```json
{
  "status": "success",
  "count": 2,
  "counties": ["alameda", "santa_clara"]
}
```

### POST /upload?county_name={county}

Upload files for a specific county.

**Request:**
```bash
POST http://localhost:8010/upload?county_name=alameda
Content-Type: multipart/form-data

files: 2020.xlsx, 2021.xlsx
```

**Response:**
```json
{
  "status": "success",
  "message": "Uploaded 2 file(s) for Alameda",
  "county": "Alameda",
  "tables": [
    {
      "filename": "2020.xlsx",
      "county": "Alameda",
      "year": "2020",
      "table_name": "ipat_raw_distress_alameda_2020",
      "rows": 15000
    },
    {
      "filename": "2021.xlsx",
      "county": "Alameda",
      "year": "2021",
      "table_name": "ipat_raw_distress_alameda_2021",
      "rows": 16000
    }
  ]
}
```

### POST /process?num_segments=20&county_name={county}

Process data for a specific county.

**Request:**
```bash
POST http://localhost:8010/process?num_segments=20&county_name=alameda
```

**Response:**
```json
{
  "status": "success",
  "message": "Success! Processed 2 years for Alameda: 2020, 2021",
  "county": "Alameda",
  "num_segments": 20,
  "statistics": {
    "total_rows": 1200,
    "unique_routes": 60,
    "expected_routes": 60
  }
}
```

### GET /results?county_name={county}

Get processed results for a specific county.

**Request:**
```bash
GET http://localhost:8010/results?county_name=alameda&limit=100&offset=0
```

**Response:**
```json
{
  "status": "success",
  "county": "Alameda",
  "total": 1200,
  "limit": 100,
  "offset": 0,
  "data": [...]
}
```

### GET /tables?county_name={county}

List tables, optionally filtered by county.

**Request:**
```bash
# All tables
GET http://localhost:8010/tables

# Tables for specific county
GET http://localhost:8010/tables?county_name=alameda
```

**Response:**
```json
{
  "status": "success",
  "count": 2,
  "county_filter": "alameda",
  "tables": [
    {
      "table_name": "ipat_raw_distress_alameda_2020",
      "county": "alameda",
      "year": "2020"
    },
    {
      "table_name": "ipat_raw_distress_alameda_2021",
      "county": "alameda",
      "year": "2021"
    }
  ]
}
```

### DELETE /clear?county_name={county}

Clear tables, optionally filtered by county.

**Request:**
```bash
# Clear all tables (all counties)
DELETE http://localhost:8010/clear

# Clear only Alameda county tables
DELETE http://localhost:8010/clear?county_name=alameda
```

**Response:**
```json
{
  "status": "success",
  "message": "Cleared 7 table(s) for county Alameda",
  "county": "Alameda",
  "tables": [
    "ipat_raw_distress_alameda_2020",
    "ipat_raw_distress_alameda_2021",
    "ipat_all_years_alameda",
    "ipat_valid_routes_alameda",
    "ipat_distress_segmented_alameda",
    "ipat_distress_segmented_complete_alameda",
    "ipat_distress_final_alameda"
  ]
}
```

## BigQuery Tables Structure

### Example for "Alameda" County

```
ipat_dataset/
├── ipat_raw_distress_alameda_2020      # Raw data, year 2020
├── ipat_raw_distress_alameda_2021      # Raw data, year 2021
├── ipat_raw_distress_alameda_2022      # Raw data, year 2022
├── ipat_all_years_alameda              # Combined years
├── ipat_valid_routes_alameda           # Routes with 2+ consecutive years
├── ipat_distress_segmented_alameda     # All segments
├── ipat_distress_segmented_complete_alameda  # Complete segments only
└── ipat_distress_final_alameda         # Final results (use this!)
```

## Querying BigQuery Directly

### List all counties

```sql
SELECT DISTINCT REGEXP_EXTRACT(table_name, r'ipat_raw_distress_([a-z0-9_]+)_[0-9]+') AS county
FROM `vernal-citadel-479904-i2.ipat_dataset.INFORMATION_SCHEMA.TABLES`
WHERE table_name LIKE 'ipat_raw_distress_%'
ORDER BY county;
```

### Get results for a specific county

```sql
SELECT *
FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final_alameda`
ORDER BY ROUTE_NAME, segment_id
LIMIT 100;
```

### Count segments by county

```sql
SELECT
  'alameda' AS county,
  COUNT(*) AS total_segments,
  COUNT(DISTINCT ROUTE_NAME) AS unique_routes
FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final_alameda`

UNION ALL

SELECT
  'santa_clara' AS county,
  COUNT(*) AS total_segments,
  COUNT(DISTINCT ROUTE_NAME) AS unique_routes
FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final_santa_clara`;
```

## Benefits

1. **Data Isolation**: Each county's data is completely separate, preventing accidental mixing.

2. **Parallel Processing**: Process multiple counties simultaneously without conflicts.

3. **Easier Management**: Clear, delete, or update data for one county without affecting others.

4. **Better Organization**: BigQuery tables are clearly organized and easy to navigate.

5. **Scalability**: Add new counties without impacting existing data or queries.

6. **Comparison**: Easily compare metrics across different counties.

## Best Practices

1. **Consistent Naming**: Always use the same county name spelling/format for a given county.

2. **Documentation**: Keep a list of counties you've processed and their characteristics.

3. **Separate Sessions**: When switching counties, clear the browser cache or use a fresh session to avoid confusion.

4. **Verify County**: Before uploading large datasets, verify the county name is correct.

5. **Backup**: Before clearing county data, export results if needed.

## Troubleshooting

### Error: "County name is required"

**Cause**: You tried to upload or process without entering a county name.

**Solution**: Enter a county name in the "County Information" field first.

### Error: "Need at least 2 years of data for {county}"

**Cause**: The selected county doesn't have enough years of uploaded data.

**Solution**: Upload data for at least 2 consecutive years for that county.

### Can't see my data

**Cause**: You might be viewing results for a different county.

**Solution**: Ensure the county name matches exactly (case-insensitive) what you used during upload.

### Tables from different counties mixed up

**Cause**: This shouldn't happen with the current system, but may occur if you manually edited BigQuery tables.

**Solution**: Use the `/clear?county_name={county}` endpoint to reset that county's data and re-upload.

## Migration Guide

If you have existing data without county prefixes:

1. Export old results
2. Clear old tables
3. Re-upload with county names
4. Process with county-specific pipeline

This ensures clean county-based organization going forward.
