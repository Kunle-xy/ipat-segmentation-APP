# IPAT II Application - Code State Summary

> **Generated**: April 13, 2026
> **Branch**: `main` (commit `fe7aaa5`)
> **Deployed**: Cloud Run (`us-central1`)

---

## Architecture Overview

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14.1.0, React 18, Tailwind CSS | UI, interactive maps, charts |
| Backend | FastAPI 0.109.0, Python 3.11 | API, segmentation pipeline |
| Database | Google BigQuery | Data warehouse |
| Maps | Leaflet 1.9.4, react-leaflet 4.2.1 | Pavement segment visualization |
| Charts | Recharts 3.5.1 | IRI trend bar charts |
| Deployment | Docker Compose, Cloud Run, Terraform | Dev + prod environments |

**GCP Project**: `vernal-citadel-479904-i2`
**Cloud Run URLs**:
- Backend: `https://ipat-backend-466544707868.us-central1.run.app`
- Frontend: `https://ipat-frontend-466544707868.us-central1.run.app`

---

## Data Flow

```
User uploads Excel/CSV files (one per year)
    |
    v
POST /upload --> pandas reads file --> normalize columns --> fix anomalies
    |            --> compute IRI from LIRI/RIRI if missing
    |            --> clean_and_cast_columns() --> BigQuery: raw_distress_{year}
    v
POST /process --> UNION ALL raw tables into all_years
    |          --> 11-CTE segmentation pipeline
    |          --> coordinate/measure stability checks
    |          --> BigQuery: distress_final + segmentation_metadata
    v
GET /results --> query distress_final with year filters
    |         --> frontend renders table, map, charts
    v
MapView (Leaflet) + ResultsTable + IRIBarChart
```

---

## File Structure

```
APP/
+-- backend/
|   +-- main.py                  # FastAPI app, CORS config, health check
|   +-- config.py                # BigQuery client, credentials, dataset mgmt
|   +-- utils.py                 # Data cleaning (numeric/string casting)
|   +-- requirements.txt         # Python dependencies
|   +-- Dockerfile               # Multi-stage (development + production)
|   +-- routes/
|       +-- upload.py            # POST /upload - file ingestion pipeline
|       +-- process.py           # POST /process - segmentation pipeline
|       +-- results.py           # GET /results - fetch processed data
|       +-- counties.py          # GET /counties, /tables, DELETE /clear
|
+-- frontend/
|   +-- app/
|   |   +-- page.tsx             # Main page (state management, API calls)
|   |   +-- layout.tsx           # Root layout
|   |   +-- globals.css          # Global styles
|   +-- components/
|   |   +-- Header.tsx           # PROSPER branding header (v1.1.0)
|   |   +-- LeftWidget.tsx       # Sidebar: county, upload, years, settings
|   |   +-- FileUpload.tsx       # Drag-and-drop file upload with validation
|   |   +-- MapView.tsx          # Leaflet map (segmentation + IRI range views)
|   |   +-- ResultsTable.tsx     # Filterable data table with row selection
|   |   +-- IRIBarChart.tsx      # Per-segment IRI trend chart
|   |   +-- ErrorBoundary.tsx    # Error boundary wrapper
|   +-- package.json             # Node dependencies
|   +-- next.config.js           # standalone output for Docker
|   +-- Dockerfile               # Multi-stage (deps, builder, production)
|
+-- terraform/
|   +-- main.tf                  # BigQuery, Artifact Registry, Cloud Run x2, IAM
|   +-- variables.tf             # Project config, feature flags
|   +-- outputs.tf               # URLs, dataset IDs
|   +-- terraform.tfvars.example # Example values
|
+-- docker-compose.yml           # Development (hot-reload, mounted volumes)
+-- docker-compose.prod.yml      # Production (resource limits, no volumes)
+-- Makefile                     # Dev, prod, test, lint, Cloud Run deploy commands
+-- .env.example                 # Environment variable template
```

---

## Backend Details

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | API status |
| GET | `/health` | BigQuery connectivity check |
| POST | `/upload?county_name=...` | Upload Excel/CSV files |
| POST | `/process?county_name=...&selected_years=...&segmentation_type=...` | Run segmentation |
| GET | `/results?county_name=...&selected_years=...` | Fetch results |
| GET | `/counties` | List county datasets |
| GET | `/tables?county_name=...` | List tables in county |
| DELETE | `/clear?county_name=...` | Delete county dataset |

### Upload Pipeline (`upload.py`)

1. **Extract year** from filename (all digits)
2. **Read file** into pandas (openpyxl for xlsx, pd.read_csv for csv)
3. **Fix anomalies**: swap FROM/TO_MEASURE and coordinates if FROM > TO
4. **Normalize columns**: strip whitespace, uppercase
5. **Compute IRI**: if `IRI` column missing but `LIRI`/`RIRI` exist, compute `IRI = mean(LIRI, RIRI)`
6. **Validate** required columns: ROUTE_NAME, FROM_MEASURE, TO_MEASURE, BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON, IRI, COUNTY_ID, SURFTYPE
7. **Clean & cast** columns via `clean_and_cast_columns()`
8. **Backfill** NULL IRI values from LIRI/RIRI where available
9. **Upload** to BigQuery: `ipat_{county}.raw_distress_{year}`

### Segmentation Pipeline (`process.py`)

**Query 1**: Create `all_years` table (UNION ALL raw tables with `data_year` column)

**Query 2**: 11-CTE pipeline:

| CTE | Purpose |
|-----|---------|
| `valid_routes` | Routes present in >= 2 selected years |
| `year_bounds` | Per route per year: min/max measure range |
| `route_bounds` | Overlapping range: MAX(year_min), MIN(year_max) |
| `year_overlap_check` | Verify each year covers the full overlap range |
| `valid_routes_with_overlap` | Routes where all years have full overlap |
| `segment_definitions` | Create segments (fixed count OR uniform distance) |
| `all_years_with_index` | Add row_index per route per year |
| `data_with_segments_all_matches` | Join records to segments, rank by proximity |
| `segment_stats` | Aggregate: AVG(IRI), record_count, row_indices per segment |
| `segment_coords` | Extract first/last coordinates per segment |
| `segmented_data` | Combine stats + coords |
| `segments_in_all_years` | Segments with data in all years |
| `routes_with_all_segments` | Routes with complete segment coverage |
| `complete_data` | Filtered to complete routes/segments |
| `segment_consistency` | Pivot IRI by year, check coordinate stability |

**Final SELECT filters**:
- `from_measure < to_measure`
- All `iri_{year} IS NOT NULL`
- Coordinate stddev < 0.001 (~111m)
- Measure stddev < 0.01 miles
- `years_count = {num_years}`

**Query 3**: Statistics (total rows, unique routes)

### Segmentation Types

| Type | Parameter | How it works |
|------|-----------|-------------|
| `fixed` | `num_segments` (10-100) | Divides each route into N equal segments |
| `distance` | `segment_distance` (0.01-10 mi) | Creates segments of uniform mile length |

### CORS Configuration (`main.py`)

```python
CORS_ORIGINS env var (falls back to ALLOWED_ORIGINS, then "http://localhost:3010")
```

Split by comma, stripped. Allows all methods, all headers, credentials.

---

## Frontend Details

### Main Page (`page.tsx`)

- Manages all app state (county, upload, processing, results, UI)
- Dynamic import for MapView (no SSR - Leaflet needs browser)
- Resizable table/map split (vertical drag)
- Sequential file upload with per-file status tracking
- Max 5 county datasets enforced

### LeftWidget (Sidebar)

- **County**: select existing or create new, delete with confirmation
- **Upload**: file list with status chips, progress bar
- **Years**: checkbox selection, edit mode for reprocessing
- **Settings**: segmentation type + parameters, last processing info
- Resizable width (280-600px), collapsible

### MapView

- **Segmentation view**: color-coded polylines (8 colors), click to select
- **IRI Range view**: 5-level color scale (Very Good to Very Poor)
  - < 60: Cyan - Very Good
  - 60-95: Lime - Good
  - 95-170: Yellow - Fair
  - 170-220: Orange - Poor
  - >= 220: Red - Very Poor
- Basemaps: OpenStreetMap, Esri Satellite, OpenTopoMap
- Hover tooltip, white outline on selection

### ResultsTable

- Filterable by: selected years, surface type, search term, increasing IRI trend
- Row selection with checkboxes
- IRI trend detection: checks if IRI strictly increases across years

### IRIBarChart

- Per-segment bar chart (years on X-axis, IRI on Y-axis)
- Auto-formatted labels based on magnitude

---

## Critical Thresholds

| Parameter | Value | Location |
|-----------|-------|----------|
| Coordinate stddev limit | 0.001 degrees (~111m) | `process.py:280-283` |
| Measure stddev limit | 0.01 miles | `process.py:284-285` |
| Min segments (fixed) | 10 | `process.py:329` |
| Max segments (fixed) | 100 | `process.py:333` |
| Min segment distance | > 0 miles | `process.py:340` |
| Max segment distance | 10 miles | `process.py:344` |
| Min years required | 2 | `process.py:390` |
| Max county datasets | 5 | `page.tsx` |
| IRI Very Good threshold | < 60 | `MapView.tsx` |
| IRI Poor threshold | >= 170 | `MapView.tsx` |

---

## Numeric Columns (cleaned during upload)

`FROM_MEASURE`, `TO_MEASURE`, `BEGIN_GLAT`, `BEGIN_GLON`, `END_GLAT`, `END_GLON`, `IRI`, `LIRI`, `RIRI`, `COUNTY_ID`

All other columns are cast to string.

---

## Deployment

### Local Development
```bash
make dev          # docker-compose up --build (hot-reload)
make logs         # Follow logs
make down         # Stop
```

### Local Production
```bash
make prod         # docker-compose.prod.yml (4 workers, resource limits)
make prod-down
```

### Cloud Run
```bash
make deploy           # Full: setup + build + deploy backend + frontend
make deploy-setup     # One-time: enable APIs, create Artifact Registry
make deploy-build     # Build & push images
make deploy-backend   # Deploy backend (2 CPU, 2GB, max 10 instances)
make deploy-frontend  # Deploy frontend (1 CPU, 1GB, max 5 instances)
make deploy-status    # Show service URLs
make deploy-update-cors  # Set backend CORS to frontend URL
make deploy-teardown  # Delete Cloud Run services
```

### Terraform
```bash
cd terraform
# Set deploy_cloud_run = true in terraform.tfvars
terraform init && terraform plan && terraform apply
```

### Docker Images
- Registry: `us-central1-docker.pkg.dev/vernal-citadel-479904-i2/ipat/`
- Backend: `ipat-backend:latest` (python:3.11-slim, non-root user, 4 uvicorn workers)
- Frontend: `ipat-frontend:latest` (node:18-alpine, standalone Next.js build)

### Cloud Run Config
| Service | CPU | Memory | Max Instances | Timeout | Port |
|---------|-----|--------|---------------|---------|------|
| ipat-backend | 2 | 2Gi | 10 | 300s | 8010 |
| ipat-frontend | 1 | 1Gi | 5 | 60s | 3010 |

---

## Known Issues & Recent Changes

1. **Year extraction from filename**: Grabs all digits, so `2017_85.xlsx` becomes year `201785`. Files should be named with just the year (e.g., `2017.xlsx`) or the extraction logic needs a 4-digit year regex.

2. **IRI.1 column**: If users manually add an IRI column in Excel when one already exists, pandas creates `IRI.1` which BigQuery rejects (dots not allowed in column names). Column name sanitization should be added.

3. **IRI from LIRI/RIRI**: Upload now computes `IRI = mean(LIRI, RIRI)` when IRI column is missing, and backfills NULL IRI values from LIRI/RIRI after cleaning.

4. **Coordinate stddev threshold**: Relaxed from 0.0001 (~11m) to 0.001 (~111m) because GPS coordinates between survey years can differ by 40-90m on the same route, causing valid routes like `I 35 N_S001910035N` to be filtered out entirely.

5. **CORS env var**: Backend now reads `CORS_ORIGINS` (matching docker-compose) with fallback to `ALLOWED_ORIGINS` (legacy).
