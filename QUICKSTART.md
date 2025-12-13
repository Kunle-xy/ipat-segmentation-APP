# Quick Start Guide - IPAT Segmentation Analysis

## Prerequisites

1. **Conda environment** (already created):
```bash
conda activate ipat
```

2. **GCP Setup**: Service account credentials are pre-configured

## Installation

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

### Frontend Setup

```bash
cd frontend
npm install
```

## Running the Application

### Terminal 1: Backend

```bash
cd backend
python main.py
```

Backend runs on: http://localhost:8010

### Terminal 2: Frontend

```bash
cd frontend
npm run dev
```

Frontend runs on: http://localhost:3010

## Using the Application

### Step 1: Open Browser

Navigate to: http://localhost:3010

### Step 2: Upload Excel Files

1. Click "Select Excel Files"
2. Choose files named with years (e.g., `2020.xlsx`, `2021.xlsx`)
3. Must have at least 2 years of data
4. Click "Upload Files"

### Step 3: Configure Segmentation

1. Enter **number of segments** (1-100)
   - Default: 20 segments per route
   - More segments = finer granularity
   - Fewer segments = broader analysis

2. Click "Run Segmentation"

### Step 4: View Results

Results table displays automatically with:
- Route segments
- Geographic coordinates
- IRI values for each year
- Metadata (county, surface type, etc.)

## Excel File Requirements

Your files must include these columns:

- `ROUTE_NAME` - Route identifier
- `FROM_MEASURE` - Start mile marker
- `TO_MEASURE` - End mile marker
- `BEGIN_GLAT` - Start latitude
- `BEGIN_GLON` - Start longitude
- `END_GLAT` - End latitude
- `END_GLON` - End longitude
- `IRI` - International Roughness Index
- `COUNTY_ID` - County identifier
- `SURFTYPE` - Surface type
- `FCLASS` - Functional class
- `WIDTH` - Road width

**Important**: Filename must contain year (e.g., `2020.xlsx`, `data_2021.xlsx`)

## API Documentation

Interactive API docs: http://localhost:8010/docs

Key endpoints:
- `POST /upload` - Upload files
- `POST /process?num_segments=20` - Run segmentation
- `GET /results` - Get processed data
- `GET /tables` - List uploaded tables
- `DELETE /clear` - Clear all data

## Infrastructure Setup (Optional)

### Using Terraform

```bash
cd terraform
terraform init
terraform apply
```

This creates:
- BigQuery dataset (`ipat_dataset`)
- IAM permissions
- (Optional) Cloud Storage backup bucket

## Troubleshooting

### Error: "Cannot find module..."

```bash
conda activate ipat
cd backend
pip install -r requirements.txt
```

### Error: "BigQuery connection failed"

Check credentials:
```bash
cat backend/gcp-service-account.json
```

Verify environment variables:
```bash
cat backend/.env
```

### Port Already in Use

Kill existing processes:
```bash
# Backend (port 8010)
lsof -t -i:8010 | xargs kill -9

# Frontend (port 3010)
lsof -t -i:3010 | xargs kill -9
```

### Upload Fails

- Verify year is in filename
- Check all required columns exist
- Ensure file is .xlsx or .xls format

### Processing Takes Long Time

- Normal for large datasets
- BigQuery processes in cloud
- Check BigQuery console for progress

## Viewing Data in BigQuery

### Using GCP Console

1. Go to: https://console.cloud.google.com/bigquery
2. Select project: `vernal-citadel-479904-i2`
3. Expand dataset: `ipat_dataset`
4. View tables:
   - `ipat_raw_distress_YYYY` - Uploaded data
   - `ipat_distress_final` - Processed results

### Using Command Line

```bash
# List tables
bq ls vernal-citadel-479904-i2:ipat_dataset

# Query results
bq query --use_legacy_sql=false \
  'SELECT * FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final` LIMIT 10'

# Count rows
bq query --use_legacy_sql=false \
  'SELECT COUNT(*) FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final`'
```

## Development Tips

### Hot Reload

Both frontend and backend support hot reload:
- Backend: Auto-reloads on file changes
- Frontend: Auto-refreshes browser

### Testing Changes

1. Make code changes
2. Save file
3. Check browser/terminal for updates
4. Test functionality

### Debugging

Backend logs:
```bash
# In terminal running backend
# Shows all API requests and errors
```

Frontend logs:
```bash
# Open browser console (F12)
# View network requests and errors
```

### Clearing Data

To start fresh:
1. Click "Clear All Data" button, OR
2. Use API: `DELETE http://localhost:8010/clear`, OR
3. Delete tables in BigQuery Console

## Cost Monitoring

### Check BigQuery Usage

1. Go to: https://console.cloud.google.com/bigquery
2. Click "Query history"
3. View bytes processed
4. Monitor costs

### Free Tier Limits

- Storage: 10 GB free/month
- Queries: 1 TB processed free/month
- Streaming: 200 MB free/day

Typical usage stays within free tier for development.

## Next Steps

1. **Upload your data** - Start with 2-3 years
2. **Experiment with segments** - Try different numbers (10, 20, 50)
3. **Analyze results** - Export data for further analysis
4. **Scale up** - Add more years of data
5. **Deploy** - Use Terraform for production setup

## Getting Help

- **API docs**: http://localhost:8010/docs
- **Detailed README**: `README.md`
- **Terraform guide**: `terraform/README.md`
- **Backend code**: `backend/main.py`
- **Frontend code**: `frontend/app/page.tsx`

## Example Workflow

```bash
# 1. Activate environment
conda activate ipat

# 2. Start backend
cd backend && python main.py &

# 3. Start frontend (new terminal)
cd frontend && npm run dev &

# 4. Open browser
open http://localhost:3010

# 5. Upload files (via UI)
# - Select 2020.xlsx, 2021.xlsx, 2022.xlsx

# 6. Process data (via UI)
# - Set segments: 20
# - Click "Run Segmentation"

# 7. View results (via UI)
# - Browse table
# - Export if needed
```

## Configuration Files

- `backend/.env` - Backend config (GCP project, dataset)
- `frontend/.env.local` - Frontend config (API URL)
- `terraform/terraform.tfvars` - Infrastructure config
- `backend/gcp-service-account.json` - GCP credentials

## Common Tasks

### Export Results

```python
import pandas as pd
from google.cloud import bigquery

client = bigquery.Client()
query = """
SELECT * FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final`
"""
df = client.query(query).to_dataframe()
df.to_csv('results.csv', index=False)
```

### Change Number of Segments

Just update the value in the UI before clicking "Run Segmentation".

### Add More Years

Simply upload additional Excel files with different years.

### View Intermediate Tables

Check BigQuery for:
- `ipat_all_years` - Combined data
- `ipat_valid_routes` - Routes with consecutive years
- `ipat_distress_segmented` - All segments
- `ipat_distress_segmented_complete` - Complete segments only
- `ipat_distress_final` - Final pivoted results

Happy analyzing! 🚀
