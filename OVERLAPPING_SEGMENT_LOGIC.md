# IPAT Overlapping Segment Logic

## Overview
This document explains how the IPAT segmentation ensures that segments represent the **same physical road section** across all selected years using overlapping measure ranges.

## Problem Statement
Different years may have data for different portions of a route:
- **2017**: Route 30 from measure 0.0 to 15.5 miles
- **2019**: Route 30 from measure 2.3 to 18.2 miles
- **2021**: Route 30 from measure 1.5 to 16.8 miles

**Challenge**: We need to segment only the portion that exists in **ALL** years.

## Solution: Overlapping Range

### Step 1: Find Year Bounds
For each route and year, find min and max measures:
```sql
year_bounds AS (
    SELECT ROUTE_NAME, data_year,
           MIN(FROM_MEASURE) AS year_min,  -- Earliest point in this year
           MAX(TO_MEASURE) AS year_max      -- Latest point in this year
    FROM all_years
    GROUP BY ROUTE_NAME, data_year
)
```

**Example Result**:
| ROUTE_NAME | data_year | year_min | year_max |
|------------|-----------|----------|----------|
| Route 30   | 2017      | 0.0      | 15.5     |
| Route 30   | 2019      | 2.3      | 18.2     |
| Route 30   | 2021      | 1.5      | 16.8     |

### Step 2: Calculate Overlapping Range
Find the **guaranteed overlap** that exists in all years:
```sql
route_bounds AS (
    SELECT ROUTE_NAME,
           MAX(year_min) AS route_min,  -- Latest start = 2.3 (from 2019)
           MIN(year_max) AS route_max   -- Earliest end = 15.5 (from 2017)
    FROM year_bounds
    GROUP BY ROUTE_NAME
    HAVING MAX(year_min) < MIN(year_max)  -- Ensure overlap exists
)
```

**Why This Works**:
- **MAX(year_min)**: The latest start point ensures all years have data from this point onward
- **MIN(year_max)**: The earliest end point ensures all years have data up to this point
- **Result**: Range from 2.3 to 15.5 exists in ALL three years

**Visual Representation**:
```
2017: [========================================] 0.0 to 15.5
2019:       [=============================================] 2.3 to 18.2
2021:   [==========================================] 1.5 to 16.8
          ^                                   ^
      route_min (2.3)                  route_max (15.5)

Overlapping: [===========================] 2.3 to 15.5 (13.2 miles)
```

### Step 3: Verify Full Overlap
Check that each year actually covers the entire overlapping range:
```sql
year_overlap_check AS (
    SELECT yb.ROUTE_NAME, yb.data_year,
           -- Check if this year fully covers the overlapping range
           CASE WHEN yb.year_min <= rb.route_min
                 AND yb.year_max >= rb.route_max
                THEN 1 ELSE 0 END AS has_full_overlap
    FROM year_bounds yb
    JOIN route_bounds rb ON yb.ROUTE_NAME = rb.ROUTE_NAME
)
```

**Example Check**:
| ROUTE_NAME | data_year | has_full_overlap | Reason                            |
|------------|-----------|------------------|-----------------------------------|
| Route 30   | 2017      | 1 (YES)          | 0.0 ≤ 2.3 AND 15.5 ≥ 15.5 ✓     |
| Route 30   | 2019      | 1 (YES)          | 2.3 ≤ 2.3 AND 18.2 ≥ 15.5 ✓     |
| Route 30   | 2021      | 1 (YES)          | 1.5 ≤ 2.3 AND 16.8 ≥ 15.5 ✓     |

### Step 4: Filter Valid Routes
Only keep routes where ALL years have full overlap:
```sql
valid_routes_with_overlap AS (
    SELECT ROUTE_NAME
    FROM year_overlap_check
    GROUP BY ROUTE_NAME
    HAVING MIN(has_full_overlap) = 1  -- All years must pass
)
```

### Step 5: Segment Within Overlap
Create segments ONLY within the overlapping range:
```sql
data_with_segments AS (
    SELECT d.ROUTE_NAME, d.data_year,
           -- Calculate segment based on position within OVERLAPPING range
           CEIL(num_segments *
               (d.FROM_MEASURE - rb.route_min) /
               (rb.route_max - rb.route_min)
           ) AS segment_id
    FROM all_years d
    JOIN route_bounds rb ON d.ROUTE_NAME = rb.ROUTE_NAME
    WHERE d.ROUTE_NAME IN (SELECT ROUTE_NAME FROM valid_routes_with_overlap)
      AND d.FROM_MEASURE >= rb.route_min  -- Only data within overlap
      AND d.TO_MEASURE <= rb.route_max
)
```

**Example Segmentation** (20 segments):
- Overlap: 2.3 to 15.5 miles (13.2 miles total)
- Each segment: 13.2 / 20 = 0.66 miles
- Segment 1: 2.30 to 2.96 miles
- Segment 2: 2.96 to 3.62 miles
- ...
- Segment 20: 14.84 to 15.50 miles

## Benefits of This Approach

### ✅ Guaranteed Consistency
Every segment represents the **exact same physical road section** across all years:
- Segment 5 in 2017 = Segment 5 in 2019 = Segment 5 in 2021
- Same start measure, same end measure
- Same geographic location

### ✅ Valid Comparisons
IRI trends are meaningful because you're comparing the **same location** over time:
```
Route 30, Segment 5 (measures 4.9 to 5.6):
- 2017: IRI = 2.3
- 2019: IRI = 2.5
- 2021: IRI = 2.8
→ Valid conclusion: This section is deteriorating
```

### ✅ No Spurious Data
Routes where years don't overlap are automatically excluded:
```
Route 45:
2017: [=====] 0.0 to 5.0
2019:              [=====] 10.0 to 15.0
         No overlap!
→ Route 45 excluded from analysis
```

### ✅ Handles Edge Cases
- **Routes extended over time**: Uses only the original overlapping portion
- **Routes shortened over time**: Uses only the remaining overlapping portion
- **Routes with gaps**: Automatically filters out non-overlapping sections

## Statistics Logged

The system logs overlap statistics during processing:
```
Routes with overlap: 145
Average overlap length: 12.34 miles
Min/Max overlap: 0.52 / 45.67 miles
```

This helps you understand:
- How many routes have sufficient overlap
- Typical overlap distance
- Whether any routes have very short overlaps (may be unreliable)

## Example: Complete Flow

**Input Data**:
```
Route 30 - 2017: Measures 0.0 to 15.5, IRI data available
Route 30 - 2019: Measures 2.3 to 18.2, IRI data available
Route 30 - 2021: Measures 1.5 to 16.8, IRI data available
```

**Processing**:
1. **Year Bounds**:
   - 2017: [0.0, 15.5]
   - 2019: [2.3, 18.2]
   - 2021: [1.5, 16.8]

2. **Overlapping Range**: [2.3, 15.5] (13.2 miles)

3. **Verification**: All years cover [2.3, 15.5] ✓

4. **Segmentation**: Create 20 segments within [2.3, 15.5]

5. **Coordinates**: Use lat/lon from records at measure boundaries within overlap

**Output**:
- 20 segments for Route 30
- Each segment exists in all 3 years
- IRI values comparable across years
- Coordinates consistent (within 1 meter)

## Key SQL Constructs

### MAX of Minimums (Latest Start)
```sql
MAX(year_min) AS route_min
```
Ensures all years have data **from this point onward**.

### MIN of Maximums (Earliest End)
```sql
MIN(year_max) AS route_max
```
Ensures all years have data **up to this point**.

### Overlap Validation
```sql
HAVING MAX(year_min) < MIN(year_max)
```
Only keeps routes where overlap actually exists (start < end).

### Full Coverage Check
```sql
year_min <= route_min AND year_max >= route_max
```
Verifies each year covers the entire overlapping range.

## Summary

The overlapping segment logic ensures:
1. **Segments are comparable** across years (same location)
2. **Only valid routes** are included (those with consecutive year overlap)
3. **Coordinates are consistent** (same physical section)
4. **IRI trends are meaningful** (comparing same road section over time)

This is critical for longitudinal pavement analysis where you need to track the **same sections** over time to identify deterioration patterns.
