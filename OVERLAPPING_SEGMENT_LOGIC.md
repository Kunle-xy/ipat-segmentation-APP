# IPAT Overlapping Segment Logic

## Overview
This document explains the full segmentation pipeline in `process.py`. The pipeline ensures that segments represent the **same physical road section** across all selected years, using overlapping measure ranges, two segmentation modes, and coordinate/measure stability validation.

## Problem Statement
Different years may have data for different portions of a route:
- **2017**: Route 30 from measure 0.0 to 15.5 miles
- **2019**: Route 30 from measure 2.3 to 18.2 miles
- **2021**: Route 30 from measure 1.5 to 16.8 miles

**Challenge**: We need to segment only the portion that exists in **ALL** years.

---

## Pipeline Overview (3 Queries)

```
Query 1: UNION ALL raw tables --> all_years
Query 2: 11-CTE segmentation pipeline --> distress_final + segmentation_metadata
Query 3: Statistics (route count, segment count)
```

---

## Query 1: Build `all_years` Table

Unions all `raw_distress_{year}` tables for the selected county, adding a `data_year` column:

```sql
CREATE OR REPLACE TABLE all_years AS
SELECT ROUTE_NAME, FROM_MEASURE, TO_MEASURE,
       BEGIN_GLAT, BEGIN_GLON, END_GLAT, END_GLON,
       IRI, COUNTY_ID, SURFTYPE,
       {year} AS data_year
FROM raw_distress_{year}
WHERE ROUTE_NAME IS NOT NULL
  AND FROM_MEASURE IS NOT NULL AND TO_MEASURE IS NOT NULL
  AND BEGIN_GLAT IS NOT NULL AND BEGIN_GLON IS NOT NULL
  AND END_GLAT IS NOT NULL AND END_GLON IS NOT NULL
UNION ALL
... (repeated for each year)
```

**Note**: Rows with NULL IRI are kept. `AVG(IRI)` later ignores NULLs automatically.

---

## Query 2: Segmentation Pipeline (11 CTEs)

### CTE 1: `valid_routes`
Finds routes that exist in at least 2 of the selected years.

```sql
valid_routes AS (
    SELECT ROUTE_NAME
    FROM (
        SELECT ROUTE_NAME,
               MAX(IF(data_year = {y1}, 1, 0)) AS y{y1},
               MAX(IF(data_year = {y2}, 1, 0)) AS y{y2}
        FROM all_years
        GROUP BY ROUTE_NAME
    )
    WHERE (y{y1} = 1 AND y{y2} = 1)  -- present in both years
)
```

For >2 years, generates OR conditions for each pair of consecutive years.

---

### CTE 2: `year_bounds`
Per route per year, find the measure range:

```sql
year_bounds AS (
    SELECT ROUTE_NAME, data_year,
           MIN(FROM_MEASURE) AS year_min,
           MAX(TO_MEASURE) AS year_max
    FROM all_years
    WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes)
    GROUP BY ROUTE_NAME, data_year
)
```

**Example**:
| ROUTE_NAME | data_year | year_min | year_max |
|------------|-----------|----------|----------|
| Route 30   | 2017      | 0.0      | 15.5     |
| Route 30   | 2019      | 2.3      | 18.2     |
| Route 30   | 2021      | 1.5      | 16.8     |

---

### CTE 3: `route_bounds`
Find the **guaranteed overlap** across all years:

```sql
route_bounds AS (
    SELECT ROUTE_NAME,
           MAX(year_min) AS route_min,  -- Latest start = 2.3
           MIN(year_max) AS route_max   -- Earliest end = 15.5
    FROM year_bounds
    GROUP BY ROUTE_NAME
    HAVING MAX(year_min) < MIN(year_max)  -- Overlap must exist
)
```

**Why this works**:
- `MAX(year_min)`: The latest start point ensures all years have data from this point onward
- `MIN(year_max)`: The earliest end point ensures all years have data up to this point

```
2017: [========================================] 0.0 to 15.5
2019:       [=============================================] 2.3 to 18.2
2021:   [==========================================] 1.5 to 16.8
          ^                                   ^
      route_min (2.3)                  route_max (15.5)

Overlapping: [===========================] 2.3 to 15.5 (13.2 miles)
```

---

### CTE 4: `year_overlap_check`
Verify each year actually covers the entire overlapping range:

```sql
year_overlap_check AS (
    SELECT yb.ROUTE_NAME, yb.data_year,
           CASE WHEN yb.year_min <= rb.route_min
                 AND yb.year_max >= rb.route_max
                THEN 1 ELSE 0 END AS has_full_overlap
    FROM year_bounds yb
    JOIN route_bounds rb ON yb.ROUTE_NAME = rb.ROUTE_NAME
)
```

---

### CTE 5: `valid_routes_with_overlap`
Only keep routes where ALL years have full overlap:

```sql
valid_routes_with_overlap AS (
    SELECT ROUTE_NAME
    FROM year_overlap_check
    GROUP BY ROUTE_NAME
    HAVING MIN(has_full_overlap) = 1
)
```

---

### CTE 6: `segment_definitions`

Two segmentation modes:

#### Mode A: Fixed Count (`segmentation_type = "fixed"`)

Divides each route into exactly N equal segments:

```sql
segment_definitions AS (
    SELECT rb.ROUTE_NAME, segment_id,
           rb.route_min + ((segment_id - 1) * (rb.route_max - rb.route_min) / {N}) AS segment_start,
           rb.route_min + (segment_id * (rb.route_max - rb.route_min) / {N}) AS segment_end
    FROM route_bounds rb
    CROSS JOIN UNNEST(GENERATE_ARRAY(1, {N})) AS segment_id
    WHERE rb.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
)
```

**Parameters**: `num_segments` = 10 to 100 (default 10)

**Example** (20 segments, overlap 2.3 to 15.5):
- Each segment = 13.2 / 20 = 0.66 miles
- Segment 1: 2.30 to 2.96
- Segment 2: 2.96 to 3.62
- ...
- Segment 20: 14.84 to 15.50

#### Mode B: Uniform Distance (`segmentation_type = "distance"`)

Creates segments of a fixed mile length, with a possible shorter remainder segment:

```sql
-- First: calculate how many full segments fit
route_segment_counts AS (
    SELECT ROUTE_NAME, route_min, route_max,
           (route_max - route_min) AS route_length,
           CAST(FLOOR((route_max - route_min) / {D}) AS INT64) AS num_full_segments,
           CASE WHEN (route_max - route_min) - FLOOR(...) * {D} > 0.001
                THEN 1 ELSE 0 END AS has_remainder
    FROM route_bounds
    WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
),

-- Then: generate segments
segment_definitions AS (
    SELECT rsc.ROUTE_NAME, segment_id,
           rsc.route_min + ((segment_id - 1) * {D}) AS segment_start,
           CASE
             WHEN segment_id > rsc.num_full_segments THEN rsc.route_max  -- remainder
             ELSE rsc.route_min + (segment_id * {D})
           END AS segment_end
    FROM route_segment_counts rsc
    CROSS JOIN UNNEST(GENERATE_ARRAY(1, rsc.num_full_segments + rsc.has_remainder)) AS segment_id
)
```

**Parameters**: `segment_distance` = 0.01 to 10 miles (default 0.1)

**Example** (0.1 mi segments, overlap 2.3 to 15.5):
- 132 full segments + 0 remainder
- Segment 1: 2.30 to 2.40
- Segment 2: 2.40 to 2.50
- ...
- Segment 132: 15.40 to 15.50

---

### CTE 7: `all_years_with_index`
Add a 0-based row index per route per year (ordered by FROM_MEASURE):

```sql
all_years_with_index AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY ROUTE_NAME, data_year
               ORDER BY FROM_MEASURE
           ) - 1 AS row_index
    FROM all_years
    WHERE ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
)
```

The `row_index` is preserved through the pipeline and output as `index_{year}` — a comma-delimited list of which raw rows contributed to each segment.

---

### CTE 8: `data_with_segments_all_matches` + `data_with_segments`
Join raw records to segments. A record belongs to a segment if its `FROM_MEASURE` falls within `[segment_start, segment_end)`:

```sql
data_with_segments_all_matches AS (
    SELECT d.*, sd.segment_id, sd.segment_start, sd.segment_end,
           ROW_NUMBER() OVER (
               PARTITION BY d.ROUTE_NAME, d.data_year, d.row_index
               ORDER BY ABS(d.FROM_MEASURE - sd.segment_start)
           ) AS segment_rank
    FROM all_years_with_index d
    JOIN segment_definitions sd ON d.ROUTE_NAME = sd.ROUTE_NAME
    WHERE d.FROM_MEASURE >= sd.segment_start
      AND d.FROM_MEASURE < sd.segment_end
),
data_with_segments AS (
    SELECT ... FROM data_with_segments_all_matches
    WHERE segment_rank = 1  -- closest segment wins if a record matches multiple
)
```

The ranking ensures each raw record maps to exactly one segment (the closest by start measure).

---

### CTE 9: `segment_stats`
Aggregate per route, year, and segment:

```sql
segment_stats AS (
    SELECT ROUTE_NAME, data_year, segment_id,
           MIN(segment_start) AS segment_from_measure,
           MAX(segment_end) AS segment_to_measure,
           COUNT(*) AS record_count,
           MAX(COUNTY_ID) AS county_id,
           MAX(SURFTYPE) AS surftype,
           AVG(IRI) AS avg_iri,
           COUNT(IRI) AS iri_count,
           STRING_AGG(CAST(row_index AS STRING), ',' ORDER BY row_index) AS row_indices
    FROM data_with_segments
    GROUP BY ROUTE_NAME, data_year, segment_id
)
```

- `AVG(IRI)` ignores NULLs — if all IRI values in a segment are NULL, `avg_iri` will be NULL
- `row_indices` is a comma-delimited list of contributing raw row indices

---

### CTE 10: `segment_coords`
Extract endpoint coordinates for each segment (first and last record by measure):

```sql
segment_coords AS (
    SELECT ROUTE_NAME, data_year, segment_id,
        ARRAY_AGG(BEGIN_GLAT ORDER BY FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lat,
        ARRAY_AGG(BEGIN_GLON ORDER BY FROM_MEASURE LIMIT 1)[OFFSET(0)] AS from_lon,
        ARRAY_AGG(END_GLAT ORDER BY FROM_MEASURE DESC LIMIT 1)[OFFSET(0)] AS to_lat,
        ARRAY_AGG(END_GLON ORDER BY FROM_MEASURE DESC LIMIT 1)[OFFSET(0)] AS to_lon
    FROM data_with_segments
    GROUP BY ROUTE_NAME, data_year, segment_id
)
```

---

### CTE 11: `segmented_data`
Join stats + coords, filter out NULL coordinates:

```sql
segmented_data AS (
    SELECT s.ROUTE_NAME, s.data_year, s.segment_id,
           s.segment_from_measure, s.segment_to_measure,
           s.record_count,
           sc.from_lat, sc.from_lon, sc.to_lat, sc.to_lon,
           s.county_id, s.surftype, s.avg_iri, s.row_indices
    FROM segment_stats s
    JOIN segment_coords sc
        ON s.ROUTE_NAME = sc.ROUTE_NAME
        AND s.data_year = sc.data_year
        AND s.segment_id = sc.segment_id
    WHERE sc.from_lat IS NOT NULL AND sc.from_lon IS NOT NULL
      AND sc.to_lat IS NOT NULL AND sc.to_lon IS NOT NULL
)
```

---

## Completeness Filter

### For Fixed Segmentation

```sql
-- Segments present in all years with data
segments_in_all_years AS (
    SELECT ROUTE_NAME, segment_id
    FROM segmented_data
    GROUP BY ROUTE_NAME, segment_id
    HAVING COUNT(DISTINCT data_year) = {num_years}
       AND MIN(record_count) > 0
),

-- Routes where ALL N segments are present
routes_with_all_segments AS (
    SELECT ROUTE_NAME
    FROM segments_in_all_years
    GROUP BY ROUTE_NAME
    HAVING COUNT(DISTINCT segment_id) = {num_segments}
),

-- Final filtered data
complete_data AS (
    SELECT s.* FROM segmented_data s
    INNER JOIN segments_in_all_years sia
        ON s.ROUTE_NAME = sia.ROUTE_NAME AND s.segment_id = sia.segment_id
    WHERE s.ROUTE_NAME IN (SELECT ROUTE_NAME FROM routes_with_all_segments)
)
```

### For Distance Segmentation

Same logic, but `expected_segments` is calculated per route (since each route may have a different number of segments):

```sql
route_expected_segments AS (
    SELECT ROUTE_NAME, MAX(segment_id) AS expected_segments
    FROM segmented_data
    GROUP BY ROUTE_NAME
),
routes_with_all_segments AS (
    SELECT sia.ROUTE_NAME
    FROM segments_in_all_years sia
    INNER JOIN route_expected_segments res ON sia.ROUTE_NAME = res.ROUTE_NAME
    GROUP BY sia.ROUTE_NAME, res.expected_segments
    HAVING COUNT(DISTINCT sia.segment_id) = res.expected_segments
)
```

---

## Final Pivot + Stability Validation

### `segment_consistency` CTE

Pivots data across years and computes coordinate/measure standard deviations:

```sql
segment_consistency AS (
    SELECT ROUTE_NAME, segment_id,
           MIN(from_lat) AS from_lat,
           MIN(from_lon) AS from_lon,
           MAX(to_lat) AS to_lat,
           MAX(to_lon) AS to_lon,
           AVG(segment_from_measure) AS from_measure,
           AVG(segment_to_measure) AS to_measure,
           MAX(surftype) AS surftype,
           MAX(county_id) AS county_id,
           COUNT(DISTINCT data_year) AS years_count,

           -- Per-year IRI (pivoted)
           AVG(IF(data_year = {y1}, avg_iri, NULL)) AS iri_{y1},
           AVG(IF(data_year = {y2}, avg_iri, NULL)) AS iri_{y2},

           -- Per-year row indices (pivoted)
           MAX(IF(data_year = {y1}, row_indices, NULL)) AS index_{y1},
           MAX(IF(data_year = {y2}, row_indices, NULL)) AS index_{y2},

           -- Stability metrics
           STDDEV(from_lat) AS from_lat_stddev,
           STDDEV(from_lon) AS from_lon_stddev,
           STDDEV(to_lat) AS to_lat_stddev,
           STDDEV(to_lon) AS to_lon_stddev,
           STDDEV(segment_from_measure) AS from_measure_stddev,
           STDDEV(segment_to_measure) AS to_measure_stddev
    FROM complete_data
    GROUP BY ROUTE_NAME, segment_id
)
```

### Final SELECT with Filters

```sql
SELECT ROUTE_NAME, segment_id,
       from_measure, to_measure,
       ROUND((to_measure - from_measure) * 5280, 2) AS length_ft,
       from_lat, from_lon, to_lat, to_lon,
       county_id, surftype,
       years_count, iri_{y1}, iri_{y2}, index_{y1}, index_{y2}
FROM segment_consistency
WHERE iri_{y1} IS NOT NULL AND iri_{y2} IS NOT NULL     -- IRI exists in all years
  AND from_measure < to_measure                          -- valid measure range
  AND (from_lat_stddev IS NULL OR from_lat_stddev < 0.001)   -- ~111m tolerance
  AND (from_lon_stddev IS NULL OR from_lon_stddev < 0.001)
  AND (to_lat_stddev IS NULL OR to_lat_stddev < 0.001)
  AND (to_lon_stddev IS NULL OR to_lon_stddev < 0.001)
  AND (from_measure_stddev IS NULL OR from_measure_stddev < 0.01)  -- 0.01 mile tolerance
  AND (to_measure_stddev IS NULL OR to_measure_stddev < 0.01)
  AND years_count = {num_years}
ORDER BY ROUTE_NAME, segment_id
```

### Stability Thresholds

| Check | Threshold | Physical Meaning |
|-------|-----------|-----------------|
| `from_lat_stddev` | < 0.001 degrees | Segment start latitude stable within ~111m across years |
| `from_lon_stddev` | < 0.001 degrees | Segment start longitude stable within ~111m across years |
| `to_lat_stddev` | < 0.001 degrees | Segment end latitude stable within ~111m across years |
| `to_lon_stddev` | < 0.001 degrees | Segment end longitude stable within ~111m across years |
| `from_measure_stddev` | < 0.01 miles | Segment start milepost stable within ~53 feet across years |
| `to_measure_stddev` | < 0.01 miles | Segment end milepost stable within ~53 feet across years |

**Why these tolerances?** GPS survey vehicles take slightly different paths each year. For example, `I 35 N_S001910035N` showed latitude differences of 0.0004-0.0008 degrees (~44-89m) between 2017 and 2018 surveys. The threshold of 0.001 degrees (~111m) accommodates this while still rejecting segments with genuinely mismatched coordinates.

A `NULL` stddev (which occurs when a segment has data from only 1 year row) passes the check — the `IS NULL OR` clause handles this.

---

## Metadata Table

Stored alongside results for reference:

```sql
CREATE OR REPLACE TABLE segmentation_metadata AS
SELECT
    '{type}' AS segmentation_type,       -- 'fixed' or 'distance'
    CAST({value} AS FLOAT64) AS segmentation_value,  -- num_segments or distance
    '{years}' AS processed_years,        -- e.g. '2017, 2018'
    CURRENT_TIMESTAMP() AS created_at
```

---

## Query 3: Statistics

```sql
SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT ROUTE_NAME) AS unique_routes,
    CAST(COUNT(*) / GREATEST({num_segments}, 1) AS INT64) AS expected_routes
FROM distress_final
```

---

## IRI Handling

### During Upload (`upload.py`)
1. If `IRI` column is missing but `LIRI` and `RIRI` exist: `IRI = mean(LIRI, RIRI)`
2. After column cleaning, NULL IRI values are backfilled from `LIRI`/`RIRI` averages
3. Rows with NULL IRI are **not** dropped — `AVG()` ignores NULLs during aggregation

### During Segmentation
- `AVG(IRI)` in `segment_stats` ignores NULLs
- If ALL records in a segment have NULL IRI, `avg_iri` is NULL
- The final `WHERE iri_{year} IS NOT NULL` filter excludes segments with no IRI data in any year

---

## What Gets Filtered Out (and Why)

| Filter Stage | What it removes | Why |
|-------------|----------------|-----|
| `valid_routes` | Routes in only 1 year | Need >= 2 years for comparison |
| `route_bounds HAVING` | Routes with no measure overlap | No common road section to compare |
| `valid_routes_with_overlap` | Routes where a year doesn't cover full overlap | Incomplete data would cause missing segments |
| `segment_rank = 1` | Duplicate record-to-segment matches | Each record maps to exactly one segment |
| `NULL coordinate filter` | Segments with missing lat/lon | Can't map or validate without coordinates |
| `segments_in_all_years` | Segments missing from any year | Incomplete comparison data |
| `routes_with_all_segments` | Routes missing any segment | Ensures complete route coverage |
| `iri_{year} IS NOT NULL` | Segments with NULL IRI in any year | No comparison possible |
| Coordinate stddev < 0.001 | Segments where coordinates drift >111m between years | Likely different physical locations |
| Measure stddev < 0.01 | Segments where measures drift >0.01 mi between years | Likely misaligned data |
| `years_count = N` | Segments not present in all selected years | Final safety check |

---

## Example: Complete Flow

**Input**:
- `raw_distress_2017`: Route 30, measures 0.0-15.5, 500 records
- `raw_distress_2019`: Route 30, measures 2.3-18.2, 480 records

**Processing (distance mode, 0.1 mi segments)**:
1. `all_years`: 980 records with data_year column
2. `valid_routes`: Route 30 (present in both years)
3. `route_bounds`: [2.3, 15.5] (13.2 miles overlap)
4. `segment_definitions`: 132 segments of 0.1 miles each
5. `data_with_segments`: ~960 records mapped to segments
6. `segment_stats`: 132 segments x 2 years = 264 rows
7. `segments_in_all_years`: 130 segments (2 had no data in 2019)
8. `routes_with_all_segments`: Route 30 excluded (missing 2 segments)

**If using fixed mode (20 segments)**: Same flow but 20 larger segments — more records per segment means less chance of gaps, so Route 30 would likely pass.

**Output** (`distress_final`):
| ROUTE_NAME | segment_id | from_measure | to_measure | length_ft | iri_2017 | iri_2019 |
|------------|-----------|-------------|-----------|----------|---------|---------|
| Route 30   | 1         | 2.30        | 2.96      | 3484.80  | 68.5    | 72.1    |
| Route 30   | 2         | 2.96        | 3.62      | 3484.80  | 55.2    | 58.9    |
| ...        | ...       | ...         | ...       | ...      | ...     | ...     |

---

## Summary

The pipeline guarantees:
1. **Segments are comparable** across years (same physical location)
2. **Only valid routes** are included (overlap exists, all years cover it)
3. **Coordinates are stable** across years (within ~111m GPS tolerance)
4. **IRI trends are meaningful** (comparing same road section over time)
5. **Two segmentation modes** serve different use cases (fixed for uniform comparison, distance for spatial precision)
