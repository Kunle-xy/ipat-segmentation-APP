# IPAT Segmentation Analysis Application

A full-stack application for processing and analyzing pavement distress data with dynamic segmentation using Google Cloud BigQuery.

## Features

- Upload multiple Excel files with distress data
- Dynamic year detection from filenames
- **Configurable number of segments** (1-100 per route)
- Automated route analysis with 2+ consecutive years requirement
- Google Cloud BigQuery for scalable data processing
- Interactive results table
- REST API for data processing
- Infrastructure as Code with Terraform

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: FastAPI, Python 3.11
- **Database**: Google Cloud BigQuery
- **Infrastructure**: Terraform
- **Cloud Platform**: Google Cloud Platform (GCP)

## Prerequisites

- Conda environment (`ipat` already created)
- Node.js 18+ and npm
- GCP account with BigQuery API enabled
- Terraform (optional, for infrastructure management)

## Quick Setup

### 1. Activate Conda Environment

```bash
conda activate ipat
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Configure GCP Credentials

The service account credentials are already configured in `backend/gcp-service-account.json`.

Verify the `.env` file:
```bash
cat backend/.env
```

Should contain:
```
GCP_PROJECT_ID=vernal-citadel-479904-i2
GCP_DATASET_ID=ipat_dataset
GOOGLE_APPLICATION_CREDENTIALS=gcp-service-account.json
```

### 4. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 5. (Optional) Set Up Infrastructure with Terraform

```bash
cd terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
terraform plan
terraform apply
```

This creates the BigQuery dataset and configures permissions.

## Running the Application

### Start Backend (Terminal 1)

```bash
cd backend
python main.py
```

Backend runs on: http://localhost:8010
- API Docs: http://localhost:8010/docs
- Health Check: http://localhost:8010/health

### Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs on: http://localhost:3010

## Usage Guide

### 1. Prepare Your Data

Excel files must:
- **Contain the year in filename** (e.g., `2020.xlsx`, `distress_2021.xlsx`)
- Include these required columns:
  - ROUTE_NAME
  - FROM_MEASURE, TO_MEASURE
  - BEGIN_GLAT, BEGIN_GLON
  - END_GLAT, END_GLON
  - IRI
  - COUNTY_ID
  - SURFTYPE
  - FCLASS
  - WIDTH

### 2. Upload Files

1. Navigate to http://localhost:3010
2. Click "Select Excel Files"
3. Choose your data files (2+ years required)
4. Click "Upload Files"

Files are uploaded to BigQuery tables named `ipat_raw_distress_YYYY`.

### 3. Process Data

1. **Select number of segments** (1-100, default: 20)
2. Click "Run Segmentation"
3. The pipeline will:
   - Detect available years
   - Combine data across years
   - Identify routes with 2+ consecutive years
   - Create N segments per route
   - Filter routes with complete data

### 4. View Results

Results display in a table showing:
- Route name and segment ID
- Measure ranges (from/to)
- Coordinates (from_lat/lon, to_lat/lon)
- Metadata (county, surface type, functional class)
- **IRI values for each year** (dynamic columns)

## API Endpoints

### GET /
Health check

### GET /health
BigQuery connection status

### POST /upload
Upload Excel files
- **Body**: Multipart form data with files
- **Returns**: Upload status and table info

### POST /process?num_segments=20
Run segmentation pipeline
- **Query param**: `num_segments` (1-100, default: 20)
- **Returns**: Processing status and statistics

### GET /results?limit=1000&offset=0
Get processed results
- **Query params**: `limit`, `offset`
- **Returns**: Paginated results

### GET /tables
List uploaded tables

### DELETE /clear
Clear all data tables

## BigQuery SQL Pipeline

The segmentation pipeline runs entirely in BigQuery:

1. **Dynamic Year Detection**: Auto-identifies years from table names
2. **Data Combination**: Merges years, excluding NULLs
3. **Route Validation**: Finds routes with 2+ consecutive years
4. **Dynamic Segmentation**: Creates N segments using overlapping intervals
5. **Completeness Check**: Keeps routes with all N segments
6. **Pivoting**: Creates final table with IRI columns per year

## Project Structure

```
APP/
├── backend/
│   ├── main.py                    # FastAPI app with BigQuery
│   ├── requirements.txt           # Python dependencies
│   ├── gcp-service-account.json   # GCP credentials
│   ├── .env                       # Environment config
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Main page with segment selector
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── FileUpload.tsx
│   │   └── ResultsTable.tsx
│   ├── package.json
│   └── Dockerfile
├── terraform/
│   ├── main.tf                   # GCP resources
│   ├── variables.tf
│   ├── outputs.tf
│   └── README.md
├── docker-compose.yml            # (Updated for GCP)
├── README.md
└── QUICKSTART.md
```

## Infrastructure as Code

### Terraform Resources

- **BigQuery Dataset**: `ipat_dataset`
- **IAM Permissions**: Service account roles
- **(Optional)** Cloud Storage backup bucket
- **(Optional)** Cloud Run deployment

### Managing Infrastructure

```bash
cd terraform

# Initialize
terraform init

# Plan changes
terraform plan

# Apply changes
terraform apply

# View outputs
terraform output

# Destroy (careful!)
terraform destroy
```

## Environment Variables

### Backend (.env)

```
GCP_PROJECT_ID=vernal-citadel-479904-i2
GCP_DATASET_ID=ipat_dataset
GOOGLE_APPLICATION_CREDENTIALS=gcp-service-account.json
```

### Frontend (.env.local)

```
NEXT_PUBLIC_API_URL=http://localhost:8010
```

## Troubleshooting

### BigQuery Connection Error

```bash
# Verify credentials
cat backend/gcp-service-account.json

# Test connection
python -c "from google.cloud import bigquery; client = bigquery.Client(); print('Connected!')"
```

### Upload Fails

- Check file has year in name
- Verify all required columns present
- Check GCP quota limits

### Processing Error

- Need at least 2 years of data
- Routes must span consecutive years
- Check BigQuery logs in GCP Console

### View BigQuery Tables

```bash
# Using bq CLI
bq ls vernal-citadel-479904-i2:ipat_dataset

# Query results
bq query --use_legacy_sql=false \
  'SELECT * FROM `vernal-citadel-479904-i2.ipat_dataset.ipat_distress_final` LIMIT 10'
```

## Cost Optimization

### BigQuery Pricing

- **Storage**: $0.02/GB/month (first 10GB free)
- **Queries**: $5/TB processed (first 1TB/month free)
- **Streaming Inserts**: $0.05/GB

### Estimated Monthly Cost

- Light usage (< 10GB, < 1TB queries): **FREE**
- Medium usage (50GB, 5TB queries): ~$20-30
- Heavy usage (500GB, 50TB queries): ~$200-300

### Cost Saving Tips

1. Use `LIMIT` in queries
2. Partition tables by year
3. Clean up intermediate tables
4. Use table expiration policies

## Security Best Practices

1. **Never commit credentials to Git**
   - Already in `.gitignore`
   - Rotate keys periodically

2. **Use least privilege IAM**
   - Grant minimum required permissions
   - Separate dev/prod service accounts

3. **Enable audit logging**
   - Monitor BigQuery access
   - Review IAM changes

4. **Encrypt data at rest**
   - BigQuery encrypts by default
   - Use customer-managed keys for extra security

## Development

### Backend Development

```bash
conda activate ipat
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8010
```

### Frontend Development

```bash
cd frontend
npm run dev
```

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test
```

## Deployment Options

### Option 1: Local Development (Current)

Run backend and frontend locally with BigQuery in cloud.

### Option 2: Cloud Run + Cloud Storage

Deploy backend to Cloud Run:

```bash
# Build and push image
gcloud builds submit --tag gcr.io/vernal-citadel-479904-i2/ipat-backend backend/

# Deploy with Terraform
cd terraform
terraform apply -var="deploy_cloud_run=true"
```

### Option 3: Full Cloud Deployment

- Frontend: Vercel or Cloud Run
- Backend: Cloud Run
- Database: BigQuery
- Infrastructure: Terraform

## Monitoring

### BigQuery Monitoring

1. Open BigQuery Console
2. View query history
3. Monitor slot usage
4. Check table sizes

### Application Logs

```bash
# Backend logs
tail -f backend/logs/app.log

# View Cloud Run logs (if deployed)
gcloud run services logs tail ipat-backend
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## License

MIT

## Support

For issues or questions:
- Check logs: Backend console, BigQuery console
- Review documentation
- Open issue on repository

## Changelog

### v2.0 (Current)
- Migrated from PostgreSQL to BigQuery
- Added dynamic segment configuration
- Implemented Terraform infrastructure
- Added GCP service account authentication

### v1.0
- Initial release with PostgreSQL
- Fixed 20 segments per route
- Docker-based deployment
