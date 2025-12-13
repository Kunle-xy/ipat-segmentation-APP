# IPAT Segmentation Analysis - Complete Project Summary

## 🎯 Overview

A full-stack web application for analyzing pavement distress data with **county-based organization**, dynamic segmentation, and Google Cloud BigQuery integration.

## ✨ Key Features

### 1. County-Based Data Organization
- **Enter county name** before uploading data
- All tables automatically organized by county
- Process multiple counties independently
- Tables named: `ipat_raw_distress_{county}_{year}`

### 2. Dynamic Segmentation
- User selects **1-100 segments per route**
- Default: 20 segments
- Configurable granularity for analysis

### 3. Cloud-Native Architecture
- **Google BigQuery** for scalable data processing
- Automatic year detection from filenames
- Processes routes with 2+ consecutive years
- Dynamic IRI columns for each year

### 4. Infrastructure as Code
- **Terraform** configuration for GCP resources
- Automated BigQuery dataset setup
- IAM permissions management

## 📁 Project Structure

```
APP/
├── backend/
│   ├── main.py                    # FastAPI app with county support
│   ├── requirements.txt           # Python dependencies (BigQuery)
│   ├── gcp-service-account.json   # GCP credentials
│   ├── .env                       # Environment config
│   ├── db/
│   │   └── init.sql              # Original PostgreSQL function (reference)
│   └── Dockerfile
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Main UI with county input
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── FileUpload.tsx        # File upload component
│   │   └── ResultsTable.tsx      # Results display
│   ├── package.json
│   ├── .env.local
│   └── Dockerfile
│
├── terraform/
│   ├── main.tf                   # GCP infrastructure
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   └── README.md
│
├── README.md                      # Full documentation
├── QUICKSTART.md                  # Quick start guide
├── COUNTY_FEATURE.md             # County feature docs
├── PROJECT_SUMMARY.md            # This file
├── docker-compose.yml
├── setup.sh
└── .gitignore
```

## 🚀 Quick Start

### Prerequisites
- Conda environment: `ipat` (already created)
- Node.js 18+
- GCP account (credentials pre-configured)

### Installation

```bash
# 1. Activate environment
conda activate ipat

# 2. Install backend dependencies
cd backend
pip install -r requirements.txt

# 3. Install frontend dependencies
cd ../frontend
npm install
```

### Running

```bash
# Terminal 1: Backend
cd backend
python main.py
# Runs on http://localhost:8010

# Terminal 2: Frontend
cd frontend
npm run dev
# Runs on http://localhost:3010
```

### Usage Flow

1. **Open**: http://localhost:3010
2. **Enter County**: Type county name (e.g., "Alameda")
3. **Upload Files**: Select Excel files named with years (e.g., 2020.xlsx, 2021.xlsx)
4. **Configure**: Choose number of segments (1-100, default: 20)
5. **Process**: Click "Run Segmentation"
6. **View Results**: Browse results table

## 📊 Data Flow

```
Excel Files (2020.xlsx, 2021.xlsx, ...)
    ↓
[County Name + Upload]
    ↓
BigQuery Tables (ipat_raw_distress_{county}_{year})
    ↓
[Process with N segments]
    ↓
Pipeline:
  1. Combine years → ipat_all_years_{county}
  2. Filter routes → ipat_valid_routes_{county}
  3. Create segments → ipat_distress_segmented_{county}
  4. Keep complete → ipat_distress_segmented_complete_{county}
  5. Pivot results → ipat_distress_final_{county}
    ↓
Results Table (displayed in UI)
```

## 🗄️ BigQuery Tables (Per County)

### Raw Data Tables
- `ipat_raw_distress_{county}_2020` - Uploaded data for 2020
- `ipat_raw_distress_{county}_2021` - Uploaded data for 2021
- `ipat_raw_distress_{county}_2022` - Uploaded data for 2022
- ...

### Processing Tables
- `ipat_all_years_{county}` - Combined across years
- `ipat_valid_routes_{county}` - Routes with 2+ consecutive years
- `ipat_distress_segmented_{county}` - All segments
- `ipat_distress_segmented_complete_{county}` - Complete segments only

### Final Results Table
- `ipat_distress_final_{county}` - **Use this for analysis!**

Contains:
- ROUTE_NAME, segment_id
- from_measure, to_measure
- from_lat, from_lon, to_lat, to_lon
- county_id, surftype, fclass, avg_width
- iri_2020, iri_2021, iri_2022, ... (dynamic columns)

## 🌐 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/health` | BigQuery connection status |
| GET | `/counties` | List all counties with data |
| POST | `/upload?county_name={county}` | Upload Excel files |
| POST | `/process?num_segments=20&county_name={county}` | Run segmentation |
| GET | `/results?county_name={county}` | Get processed results |
| GET | `/tables?county_name={county}` | List tables (optional filter) |
| DELETE | `/clear?county_name={county}` | Clear tables (optional filter) |

### API Documentation

Interactive docs: http://localhost:8010/docs

## 🏗️ Technology Stack

### Frontend
- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Axios** - HTTP client

### Backend
- **FastAPI** - Python web framework
- **Python 3.11** - Programming language
- **Pandas** - Data processing
- **google-cloud-bigquery** - BigQuery client

### Cloud Infrastructure
- **Google Cloud BigQuery** - Data warehouse
- **GCP Service Account** - Authentication
- **Terraform** - Infrastructure as Code

### Development Tools
- **Conda** - Environment management
- **npm** - Package management
- **Docker** - Containerization (optional)

## 📋 Excel File Requirements

Files must include these columns:

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

**Naming Convention**: File must contain year in name (e.g., `2020.xlsx`, `distress_2021.xlsx`)

## 💡 Example Workflow

### Processing Alameda County

```bash
# 1. Start services
conda activate ipat
cd backend && python main.py &
cd frontend && npm run dev &

# 2. Open browser
open http://localhost:3010

# 3. Enter county: "Alameda"

# 4. Upload files:
- 2020.xlsx
- 2021.xlsx
- 2022.xlsx

# 5. Set segments: 20

# 6. Click "Run Segmentation"

# 7. View results table
```

### Processing Multiple Counties

```bash
# Process Alameda
County: Alameda → Upload → Process

# Process Santa Clara
County: Santa Clara → Upload → Process

# Process Los Angeles
County: Los Angeles → Upload → Process

# Each county's data is completely separate!
```

## 🔒 Security & Best Practices

### Credentials
- GCP service account credentials in `gcp-service-account.json`
- Never commit credentials to Git (.gitignore configured)
- Rotate service account keys periodically

### IAM Permissions
- Service account has BigQuery admin rights
- Least privilege principle applied
- Audit logs enabled in GCP

### Data Privacy
- Each county's data isolated
- No cross-county queries
- Clear data ownership

## 💰 Cost Estimation

### BigQuery Pricing
- **Storage**: $0.02/GB/month (first 10GB free)
- **Queries**: $5/TB processed (first 1TB/month free)
- **Streaming Inserts**: $0.05/GB

### Estimated Costs
- **Development**: FREE (within free tier)
- **Light Usage**: < $10/month
- **Medium Usage**: $20-50/month
- **Heavy Usage**: $100-300/month

### Cost Optimization
1. Use LIMIT in queries
2. Clean up intermediate tables
3. Use table expiration policies
4. Partition large tables by year

## 📖 Documentation Files

1. **README.md** - Complete application documentation
2. **QUICKSTART.md** - Quick start guide
3. **COUNTY_FEATURE.md** - County feature detailed docs
4. **terraform/README.md** - Infrastructure guide
5. **PROJECT_SUMMARY.md** - This overview

## 🛠️ Development

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

### Infrastructure Management
```bash
cd terraform
terraform init
terraform plan
terraform apply
```

## 🧪 Testing Checklist

- [ ] Upload files for a county
- [ ] Process with 20 segments
- [ ] Process with 50 segments
- [ ] View results table
- [ ] Upload files for different county
- [ ] Process second county independently
- [ ] List counties via API
- [ ] List tables via API
- [ ] Clear specific county data
- [ ] Verify isolation between counties

## 🐛 Troubleshooting

### Common Issues

**1. "County name is required"**
- Enter county name before uploading

**2. "Need at least 2 years of data"**
- Upload files for 2+ consecutive years

**3. BigQuery connection error**
- Check `gcp-service-account.json` exists
- Verify credentials are valid

**4. Frontend can't connect to backend**
- Ensure backend is running on port 8010
- Check CORS settings

**5. Tables not found**
- Verify county name spelling matches
- Check BigQuery console for tables

## 🚢 Deployment Options

### Option 1: Local Development (Current)
- Backend + Frontend run locally
- BigQuery in cloud
- Best for development

### Option 2: Cloud Run
- Deploy backend to Cloud Run
- Host frontend on Vercel
- Terraform configuration provided

### Option 3: Full Cloud
- Backend on Cloud Run
- Frontend on Cloud Run / Vercel
- BigQuery for data
- Managed via Terraform

## 📈 Future Enhancements

Potential features:
- [ ] Export results to CSV/Excel
- [ ] Visualization dashboards
- [ ] Comparison across counties
- [ ] Historical trend analysis
- [ ] Map visualization of routes
- [ ] Email notifications on completion
- [ ] Scheduled automated processing
- [ ] Multi-user authentication

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License

## 📞 Support

For issues or questions:
- Review documentation
- Check API docs: http://localhost:8010/docs
- Review BigQuery console
- Check application logs

## 🎉 Success Criteria

Application is working correctly when:
1. ✅ County name can be entered
2. ✅ Files upload successfully
3. ✅ Processing completes without errors
4. ✅ Results display in table
5. ✅ Multiple counties can be processed separately
6. ✅ Tables are properly named with county prefix
7. ✅ API endpoints return correct data

## 📝 Version History

### v2.1 (Current) - County-Based Organization
- ✅ Added county name input field
- ✅ County-prefixed table naming
- ✅ Separate processing per county
- ✅ County listing endpoint
- ✅ Updated all documentation

### v2.0 - BigQuery Migration
- ✅ Migrated from PostgreSQL to BigQuery
- ✅ Added dynamic segment configuration
- ✅ Implemented Terraform infrastructure
- ✅ GCP service account authentication

### v1.0 - Initial Release
- ✅ PostgreSQL backend
- ✅ Fixed 20 segments per route
- ✅ Docker-based deployment

---

**Built with ❤️ using Next.js, FastAPI, and Google Cloud BigQuery**
