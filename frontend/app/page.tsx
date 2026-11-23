'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Header from '@/components/Header'
import LeftWidget from '@/components/LeftWidget'
import ResultsTable from '@/components/ResultsTable'
import axios from 'axios'
import { Table, Download } from 'lucide-react'
import ErrorBoundary from '@/components/ErrorBoundary'

interface ProcessStatus {
  status: string
  message: string
  county: string
  dataset: string
  segmentation_type: 'fixed' | 'distance'
  years_processed: string
  routes_processed: number
  segments_created: number
  statistics: {
    total_rows: number
    unique_routes: number
    expected_routes: number
  }
  num_segments?: number
  segment_distance?: number
}

interface DataRow {
  ROUTE_NAME: string
  segment_id: number
  from_measure: number
  to_measure: number
  length_ft: number
  from_lat: number
  from_lon: number
  to_lat: number
  to_lon: number
  county_id: string | number
  surftype: string
  years_count: number
  [key: string]: string | number | null
}

interface SegmentationMetadata {
  segmentation_type: 'fixed' | 'distance'
  segmentation_value: number
  processed_years: string
}

interface ResultsResponse {
  status: string
  county: string
  dataset: string
  total: number
  limit: number
  offset: number
  selected_years: string | null
  metadata: SegmentationMetadata | null
  data: DataRow[]
}

interface CountyTable {
  table_name: string
  dataset: string
  county: string
}

interface AnalysisCompleteData {
  routesProcessed: number | string
  segmentsCreated: number | string
}

// Import MapView dynamically to avoid SSR issues with Leaflet
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100 rounded-lg">
      <p className="text-gray-600">Loading map...</p>
    </div>
  )
})

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8010'

async function uploadDistressFile(file: File, county: string) {
  if (process.env.NEXT_PUBLIC_UPLOAD_MODE === 'direct') {
    const form = new FormData()
    form.append('files', file)
    return axios.post(`${API_URL}/upload`, form, { params: { county_name: county } })
  }

  // 1. Get a signed URL to upload the file straight to Cloud Storage.
  //    This bypasses Cloud Run's 32MB request-body limit.
  const urlResp = await axios.post(`${API_URL}/upload-url`, null, {
    params: { county_name: county, filename: file.name }
  })
  const { upload_url, blob_path } = urlResp.data

  // 2. PUT the file directly to GCS (no size limit on this request).
  await axios.put(upload_url, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' }
  })

  // 3. Tell the backend to ingest the staged file into BigQuery.
  return axios.post(`${API_URL}/ingest`, null, {
    params: { county_name: county, blob_path, filename: file.name }
  })
}

interface UploadedFile {
  filename: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  message?: string
}

export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null)
  const [results, setResults] = useState<ResultsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numSegments, setNumSegments] = useState(20)
  const [countyName, setCountyName] = useState('')
  const [segmentationType, setSegmentationType] = useState<'fixed' | 'distance'>('distance')
  const [segmentDistance, setSegmentDistance] = useState(0.1)

  // New states for county dropdown and filters
  const [availableCounties, setAvailableCounties] = useState<string[]>([])
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [surfTypeFilter, setSurfTypeFilter] = useState<string>('all')
  const [showIncreasingOnly, setShowIncreasingOnly] = useState(false)
  const [countyTables, setCountyTables] = useState<CountyTable[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [availableYears, setAvailableYears] = useState<string[]>([])
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [filteredData, setFilteredData] = useState<DataRow[]>([])
  const [countyHasTables, setCountyHasTables] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [processedYears, setProcessedYears] = useState<string[]>([]) // Years used in segmentation
  const [isEditMode, setIsEditMode] = useState(false) // Allow changing year selection
  const [showTable, setShowTable] = useState(false) // Toggle table view
  const [tableHeight, setTableHeight] = useState(50) // Table height percentage (default 50%)
  const [isResizingTable, setIsResizingTable] = useState(false)
  const [searchTerm, setSearchTerm] = useState('') // Search term for table
  const [segmentationMetadata, setSegmentationMetadata] = useState<SegmentationMetadata | null>(null)
  const [showAnalysisCompleteModal, setShowAnalysisCompleteModal] = useState(false)
  const [analysisCompleteData, setAnalysisCompleteData] = useState<AnalysisCompleteData | null>(null)
  const [countyId, setCountyId] = useState('')

  // Get selected segments for map with IRI data (memoized to prevent infinite loops)
  const selectedSegments = useMemo(() => {
    return Array.from(selectedRows).map(index => {
      const row = filteredData[index]
      if (!row) return null

      const columns = Object.keys(row)

      // IRI (avg)
      const iriData: { year: string; iri: number }[] = []
      columns.filter(col => col.startsWith('iri_')).sort().forEach(col => {
        const year = col.replace('iri_', '')
        const v = row[col]
        if (v !== null && v !== undefined && !isNaN(Number(v))) {
          iriData.push({ year: String(year), iri: Number(v) })
        }
      })

      // LIRI (left wheel)
      const liriData: { year: string; liri: number | null }[] = []
      columns.filter(col => col.startsWith('liri_')).sort().forEach(col => {
        const year = col.replace('liri_', '')
        const v = row[col]
        liriData.push({ year: String(year), liri: v !== null && v !== undefined && !isNaN(Number(v)) ? Number(v) : null })
      })

      // RIRI (right wheel)
      const ririData: { year: string; riri: number | null }[] = []
      columns.filter(col => col.startsWith('riri_')).sort().forEach(col => {
        const year = col.replace('riri_', '')
        const v = row[col]
        ririData.push({ year: String(year), riri: v !== null && v !== undefined && !isNaN(Number(v)) ? Number(v) : null })
      })

      return {
        route_name: row.ROUTE_NAME || row.route_name,
        segment_id: row.segment_id,
        from_lat: row.from_lat,
        from_lon: row.from_lon,
        to_lat: row.to_lat,
        to_lon: row.to_lon,
        surftype: row.surftype,
        length: row.length_ft,
        iriData,
        liriData: liriData.length > 0 ? liriData : undefined,
        ririData: ririData.length > 0 ? ririData : undefined,
      }
    }).filter(Boolean)
  }, [selectedRows, filteredData])

  // Ref for dropdown to detect outside clicks
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCountyDropdown(false)
      }
    }

    if (showCountyDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCountyDropdown])

  // Handle table vertical resizing
  const handleTableResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizingTable(true)
    e.preventDefault()
  }, [])

  const handleTableResize = useCallback((e: MouseEvent) => {
    if (!isResizingTable || !containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const mouseY = e.clientY - containerRect.top
    const newHeightPercent = ((containerRect.height - mouseY) / containerRect.height) * 100

    // Constrain between 20% and 80%
    const constrainedHeight = Math.max(20, Math.min(80, newHeightPercent))
    setTableHeight(constrainedHeight)
  }, [isResizingTable])

  const handleTableResizeEnd = useCallback(() => {
    setIsResizingTable(false)
  }, [])

  // Add/remove mouse listeners for table resizing
  useEffect(() => {
    if (isResizingTable) {
      document.addEventListener('mousemove', handleTableResize)
      document.addEventListener('mouseup', handleTableResizeEnd)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleTableResize)
        document.removeEventListener('mouseup', handleTableResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizingTable, handleTableResize, handleTableResizeEnd])

  const handleUploadAll = async (files: File[]) => {
    if (!countyName.trim()) {
      setError('Please enter a county name')
      return
    }

    // Check max 10 datasets limit
    const sanitizedCounty = countyName.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')
    if (!availableCounties.includes(sanitizedCounty) && availableCounties.length >= 5) {
      setError('Maximum of 5 datasets reached. Please delete an existing dataset before adding a new one.')
      return
    }

    setIsUploading(true)
    setError(null)
    setUploadProgress({ current: 0, total: files.length, currentFile: '' })

    let hasSuccessfulUploads = false

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploadProgress({ current: i + 1, total: files.length, currentFile: file.name })
      setUploadedFiles(prev => [...prev, { filename: file.name, status: 'uploading' }])

      try {
        const county = countyName.trim().toLowerCase()

        const response = await uploadDistressFile(file, county)

        setUploadedFiles(prev =>
          prev.map(f =>
            f.filename === file.name && f.status === 'uploading'
              ? { ...f, status: 'success', message: `${response.data.tables?.[0]?.rows || 0} rows` }
              : f
          )
        )
        hasSuccessfulUploads = true
      } catch (err: any) {
        setUploadedFiles(prev =>
          prev.map(f =>
            f.filename === file.name && f.status === 'uploading'
              ? { ...f, status: 'error', message: err.response?.data?.detail || 'Upload failed' }
              : f
          )
        )
      }
    }

    setIsUploading(false)
    setUploadProgress({ current: 0, total: 0, currentFile: '' })

    if (hasSuccessfulUploads) {
      setCountyHasTables(true)
      setTimeout(() => {
        fetchCountyTables()
      }, 1000)
    }
  }

  const handleProcess = async () => {
    if (!countyName.trim()) {
      setError('Please enter a county name')
      return
    }

    if (selectedYears.length < 2) {
      alert('⚠️ You must select at least 2 years for analysis.\n\nPlease select at least two years from the uploaded tables before running segmentation.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const params: any = {
        county_name: countyName.trim().toLowerCase(),
        selected_years: selectedYears.join(','),
        segmentation_type: segmentationType
      }

      if (segmentationType === 'fixed') {
        params.num_segments = numSegments
      } else {
        params.segment_distance = segmentDistance
      }

      if (countyId.trim()) {
        params.county_id = countyId.trim()
      }

      const response = await axios.post(`${API_URL}/process`, null, { params })
      setProcessStatus(response.data)

      // Automatically fetch results and tables after processing
      await fetchResults()
      fetchCountyTables()

      // Automatically show table after successful processing
      setShowTable(true)

      // Lock the processed years and exit edit mode
      setProcessedYears([...selectedYears])
      setIsEditMode(false)

      // Show success message and custom modal
      const stats = response.data
      const successMsg = `✅ Segmentation complete! Processed ${stats.routes_processed || stats.statistics?.unique_routes || 'N/A'} routes with ${stats.segments_created || stats.statistics?.total_rows || 'N/A'} total segments.`
      setSuccessMessage(successMsg)

      // Show custom analysis complete modal
      setAnalysisCompleteData({
        routesProcessed: stats.routes_processed || stats.statistics?.unique_routes || 'N/A',
        segmentsCreated: stats.segments_created || stats.statistics?.total_rows || 'N/A'
      })
      setShowAnalysisCompleteModal(true)

      // Auto-hide success message after 8 seconds
      setTimeout(() => setSuccessMessage(null), 8000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Processing failed')
      setLoading(false)
    }
  }

  const fetchResults = async () => {
    try {
      const response = await axios.get(`${API_URL}/results`, {
        params: {
          limit: 1000000, // Set to 1 million to effectively get all rows
          offset: 0,
          county_name: countyName.trim().toLowerCase(),
          selected_years: selectedYears.join(',')
        }
      })
      setResults(response.data)
      // Store metadata from database
      console.log('📋 Metadata from API:', response.data.metadata)
      if (response.data.metadata) {
        setSegmentationMetadata(response.data.metadata)
        console.log('✅ Metadata stored in state:', response.data.metadata)
      } else {
        console.warn('⚠️ No metadata returned from API')
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch results')
    } finally {
      setLoading(false)
    }
  }

  // Fetch available counties
  const fetchCounties = async () => {
    setLoadingCounties(true)
    setError(null)
    try {
      const response = await axios.get(`${API_URL}/counties`)
      setAvailableCounties(response.data.counties || [])
      setShowCountyDropdown(true)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch counties')
    } finally {
      setLoadingCounties(false)
    }
  }

  // Delete a county dataset
  const handleDeleteCounty = async (county: string) => {
    try {
      await axios.delete(`${API_URL}/clear`, {
        params: { county_name: county }
      })
      // Refresh the counties list
      setAvailableCounties(prev => prev.filter(c => c !== county))
      // If we deleted the currently loaded county, clear state
      if (countyName === county) {
        setCountyName('')
        setResults(null)
        setCountyTables([])
        setSelectedYears([])
        setProcessedYears([])
        setSegmentationMetadata(null)
        setShowTable(false)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete county data')
    }
  }

  // Load data for selected county
  const handleLoadCountyData = async (county: string) => {
    setCountyName(county)
    setShowCountyDropdown(false)
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    setResults(null)

    // Fetch tables first to see what's available
    await fetchCountyTables(county)

    try {
      const response = await axios.get(`${API_URL}/results`, {
        params: {
          limit: 1000000, // Set to 1 million to effectively get all rows
          offset: 0,
          county_name: county,
          selected_years: selectedYears.join(',')
        }
      })
      setResults(response.data)
      setCountyHasTables(true)

      // Store metadata from database
      if (response.data.metadata) {
        setSegmentationMetadata(response.data.metadata)
      }

      // If we successfully loaded results, those years are now the processed years
      if (selectedYears.length >= 2) {
        setProcessedYears([...selectedYears])
        setIsEditMode(false)
      }

      // Show success message
      setSuccessMessage(
        `✅ Loaded county data for ${county.charAt(0).toUpperCase() + county.slice(1).replace(/_/g, ' ')} - ${response.data.total} segments found.`
      )
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (err: any) {
      // Check if it's a "table not found" error (404)
      if (err.response?.status === 404) {
        // This is expected - county has raw data but hasn't been processed yet
        setCountyHasTables(true)
        // Don't show error - just let user see the tables and run segmentation
      } else {
        // Other errors should be shown
        const errorMessage = err.response?.data?.detail || 'Failed to load county data'
        setError(errorMessage)
        setCountyHasTables(false)
      }
    } finally {
      setLoading(false)
    }
  }

  // Fetch tables for the selected county
  const fetchCountyTables = async (county?: string) => {
    const targetCounty = county || countyName
    if (!targetCounty) return

    setLoadingTables(true)
    try {
      const response = await axios.get(`${API_URL}/tables`, {
        params: { county_name: targetCounty }
      })
      const tables = response.data.tables || []
      setCountyTables(tables)

      // Extract years from raw_distress tables
      const years = tables
        .filter((table: CountyTable) => table.table_name.startsWith('raw_distress_'))
        .map((table: CountyTable) => table.table_name.replace('raw_distress_', ''))
        .sort()

      setAvailableYears(years)

      // Auto-select years if they're not already selected or if new years are available
      if (years.length > 0) {
        // If no years selected yet, or if new years were added, select all available years
        if (selectedYears.length === 0 || years.length > selectedYears.length) {
          setSelectedYears(years)
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch tables:', err)
    } finally {
      setLoadingTables(false)
    }
  }

  // Toggle year selection
  const toggleYearSelection = async (year: string) => {
    setSelectedYears(prev => {
      // If NOT in edit mode and have processed years, only allow selection within processed years
      if (!isEditMode && processedYears.length > 0) {
        // Can only toggle years that were in the original segmentation
        if (!processedYears.includes(year)) {
          return prev // Year not in processed set, ignore toggle
        }
      }

      // If trying to deselect and would leave less than 2 years (only when in edit mode or no results yet)
      if (prev.includes(year) && prev.length <= 2) {
        // When NOT in edit mode (just filtering), allow going down to 1 year
        if (!isEditMode && processedYears.length > 0) {
          // Allow deselecting if we have at least 1 year left
          if (prev.length <= 1) {
            alert('⚠️ You must select at least 1 year for filtering results.')
            return prev
          }
        } else {
          // In edit mode or initial setup, require at least 2 years
          alert('⚠️ You must select at least 2 years for analysis.\n\nThe IPAT segmentation requires at least two years of data to compare and analyze IRI trends.')
          return prev // Don't change selection
        }
      }

      let newYears: string[]
      if (prev.includes(year)) {
        newYears = prev.filter(y => y !== year)
      } else {
        newYears = [...prev, year].sort()
      }

      // Automatically refresh results with new year selection (if not in edit mode)
      if (!isEditMode && results && countyName && newYears.length >= 1) {
        // Small delay to ensure state is updated
        setTimeout(() => {
          fetchResults()
        }, 100)
      }

      return newYears
    })
  }

  // Export filtered data to CSV
  const handleExportCSV = () => {
    if (!filteredData || filteredData.length === 0) {
      alert('No data to export. Please ensure you have results displayed.')
      return
    }

    // Get all column keys from the first row
    const headers = Object.keys(filteredData[0])

    // Create CSV header row
    const csvHeaders = headers.join(',')

    // Create CSV data rows
    const csvRows = filteredData.map(row => {
      return headers.map(header => {
        const value = row[header]
        // Handle null/undefined values and escape quotes
        if (value === null || value === undefined) return ''
        const stringValue = String(value)
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      }).join(',')
    })

    // Combine headers and rows
    const csvContent = [csvHeaders, ...csvRows].join('\n')

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const filename = `ipat-results-${countyName || 'export'}-${timestamp}.csv`

    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Reprocess with selected years only - FULL SEGMENTATION
  const handleReprocessSelectedYears = async () => {
    if (!countyName.trim()) {
      setError('Please select a county first')
      return
    }

    if (selectedYears.length < 2) {
      alert('⚠️ You must select at least 2 years for analysis.\n\nPlease select at least two years from the uploaded tables before reprocessing.')
      return
    }

    const segmentInfo = segmentationType === 'fixed'
      ? `${numSegments} segments per route`
      : `${segmentDistance} mile distance per segment`

    const confirmMsg = `🔄 FULL REPROCESSING WITH SELECTED YEARS\n\n` +
      `This will:\n` +
      `• Recreate all segmentation tables\n` +
      `• Apply overlapping segment logic for ${selectedYears.join(', ')}\n` +
      `• Generate ${segmentInfo}\n` +
      `• Only include routes with consecutive years in selection\n\n` +
      `County: ${countyName}\n` +
      `Years: ${selectedYears.join(', ')}\n` +
      `Segmentation: ${segmentInfo}\n\n` +
      `Continue?`

    if (!confirm(confirmMsg)) {
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    console.log(`🔄 Starting full reprocessing for ${countyName} with years: ${selectedYears.join(', ')}`)

    try {
      const params: any = {
        county_name: countyName.trim().toLowerCase(),
        selected_years: selectedYears.join(','),
        segmentation_type: segmentationType
      }

      if (segmentationType === 'fixed') {
        params.num_segments = numSegments
      } else {
        params.segment_distance = segmentDistance
      }

      if (countyId.trim()) {
        params.county_id = countyId.trim()
      }

      const response = await axios.post(`${API_URL}/process`, null, { params })

      console.log('✅ Reprocessing completed:', response.data)
      console.log('📋 Response details:', JSON.stringify(response.data, null, 2))
      setProcessStatus(response.data)

      // Automatically fetch results after processing
      // Add small delay to ensure BigQuery tables are fully committed
      await new Promise(resolve => setTimeout(resolve, 1000))

      console.log('📊 Fetching new segmented results...')
      const resultsResponse = await axios.get(`${API_URL}/results`, {
        params: {
          limit: 1000000,
          offset: 0,
          county_name: countyName.trim().toLowerCase(),
          selected_years: selectedYears.join(','),
          _t: Date.now() // Cache buster
        }
      })
      console.log('📊 Results fetched:', resultsResponse.data)
      setResults(resultsResponse.data)

      // Store metadata from database
      if (resultsResponse.data.metadata) {
        setSegmentationMetadata(resultsResponse.data.metadata)
      }

      // Clear selected rows since data has changed
      setSelectedRows(new Set())
      setFilteredData([])

      // Refresh county tables list
      fetchCountyTables()

      // Lock the processed years and exit edit mode
      setProcessedYears([...selectedYears])
      setIsEditMode(false)

      // Show success message with stats
      const stats = response.data
      setSuccessMessage(
        `✅ Reprocessing complete! Years: ${stats.years_processed || selectedYears.join(', ')} | Routes: ${stats.routes_processed || stats.statistics?.unique_routes || 'N/A'} | Segments: ${stats.segments_created || stats.statistics?.total_rows || 'N/A'}`
      )

      // Auto-hide success message after 8 seconds
      setTimeout(() => setSuccessMessage(null), 8000)
    } catch (err: any) {
      console.error('❌ Reprocessing failed:', err)
      setError(err.response?.data?.detail || 'Reprocessing failed')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    if (!confirm('Are you sure you want to clear all data?')) return

    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      await axios.delete(`${API_URL}/clear`)
      setUploadedFiles([])
      setProcessStatus(null)
      setResults(null)
      setCountyTables([])
      setSelectedYears([])
      setAvailableYears([])
      setCountyHasTables(false)
      setProcessedYears([])
      setIsEditMode(false)

      // Show success message
      setSuccessMessage('✅ All data has been cleared successfully.')
      setTimeout(() => setSuccessMessage(null), 5000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Clear failed')
    } finally {
      setLoading(false)
    }
  }

  const successfulUploads = uploadedFiles.filter(f => f.status === 'success').length

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <Header />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Widget */}
        <LeftWidget
          countyName={countyName}
          setCountyName={setCountyName}
          segmentationType={segmentationType}
          setSegmentationType={setSegmentationType}
          numSegments={numSegments}
          setNumSegments={setNumSegments}
          segmentDistance={segmentDistance}
          setSegmentDistance={setSegmentDistance}
          selectedYears={selectedYears}
          setSelectedYears={setSelectedYears}
          availableYears={availableYears}
          countyTables={countyTables}
          processedYears={processedYears}
          isEditMode={isEditMode}
          setIsEditMode={setIsEditMode}
          loading={loading}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          uploadedFiles={uploadedFiles}
          handleUploadAll={handleUploadAll}
          handleProcess={handleProcess}
          handleLoadCountyData={handleLoadCountyData}
          fetchCounties={fetchCounties}
          availableCounties={availableCounties}
          showCountyDropdown={showCountyDropdown}
          setShowCountyDropdown={setShowCountyDropdown}
          loadingCounties={loadingCounties}
          toggleYearSelection={toggleYearSelection}
          processStatus={processStatus}
          showTable={showTable}
          setShowTable={setShowTable}
          setTableHeight={setTableHeight}
          hasResults={!!results}
          handleDeleteCounty={handleDeleteCounty}
          countyId={countyId}
          setCountyId={setCountyId}
        />

        {/* Right Content Area (Map + Optional Table) */}
        <div ref={containerRef} className="flex-1 flex flex-col relative z-10 min-w-0 overflow-hidden">
          {/* Success/Error Messages */}
          <div className="absolute top-4 left-4 right-4 z-10 space-y-2">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-lg">
                <strong>Error:</strong>
                <div className="mt-1 whitespace-pre-line">{error}</div>
              </div>
            )}

            {successMessage && (
              <div className="bg-green-600 border border-green-700 text-white px-4 py-3 rounded shadow-lg flex items-start gap-3">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <strong>Success!</strong>
                  <div className="mt-1">{successMessage}</div>
                </div>
                <button
                  onClick={() => setSuccessMessage(null)}
                  className="text-white hover:text-green-100"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Map View */}
          <div
            style={{
              height: showTable && results ? `${100 - tableHeight}%` : '100%',
              transition: isResizingTable ? 'none' : 'height 300ms ease-in-out'
            }}
            className="relative"
          >
            <MapView selectedSegments={selectedSegments as any} />
          </div>

          {/* Results Table (shown when toggled and results exist) */}
          {showTable && results && (
            <>
              {/* Resize Handle */}
              <div
                onMouseDown={handleTableResizeStart}
                className="h-2 bg-gradient-to-b from-blue-500 to-blue-600 cursor-ns-resize hover:from-blue-600 hover:to-blue-700 active:from-blue-700 active:to-blue-800 transition-colors group relative z-[1000]"
                title="Drag to resize table"
              >
                {/* Grip indicator */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
                  <div className="w-12 h-1 bg-white/50 rounded-full group-hover:bg-white/70 transition-colors" />
                </div>
              </div>

              {/* Table Container */}
              <div
                style={{
                  height: `${tableHeight}%`,
                  transition: isResizingTable ? 'none' : 'height 300ms ease-in-out'
                }}
                className="bg-white relative w-full min-w-0 overflow-hidden"
              >
                {/* Scrollable Table Content */}
                <div className="h-full flex flex-col p-2">
                  {/* Single Row: Title + Filters + Export */}
                  <div className="flex flex-wrap items-center gap-2 mb-1 pb-1 border-b border-gray-200">
                    <h2 className="text-base font-semibold whitespace-nowrap">Results</h2>

                    <select
                      value={surfTypeFilter}
                      onChange={(e) => setSurfTypeFilter(e.target.value)}
                      className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="all">All Surface Types</option>
                      {Array.from(new Set(results.data.map((row: DataRow) => row.surftype)))
                        .filter(Boolean)
                        .sort()
                        .map((surftype: string) => (
                          <option key={surftype} value={surftype}>
                            {surftype}
                          </option>
                        ))}
                    </select>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={showIncreasingOnly}
                        onChange={(e) => setShowIncreasingOnly(e.target.checked)}
                        className="w-3 h-3 text-blue-600 border-gray-300 rounded"
                        id="iri-increase-filter"
                      />
                      <label htmlFor="iri-increase-filter" className="text-xs text-gray-700 cursor-pointer whitespace-nowrap">
                        IRI Increase
                      </label>
                    </div>

                    {/* Search Input - Compact */}
                    <div className="relative w-32 min-w-[8rem] max-w-[12rem] flex-shrink">
                      <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search routes..."
                        className="block w-full pl-7 pr-7 py-1 text-xs border border-gray-300 rounded leading-tight bg-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {searchTerm && (
                        <button
                          onClick={() => setSearchTerm('')}
                          className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600"
                          title="Clear search"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Segmentation Metadata - Method Only (from database) */}
                    {segmentationMetadata && (
                      <div className="flex items-center gap-1 text-xs bg-blue-50 border border-blue-200 px-2 py-1 rounded min-w-0">
                        <span className="text-blue-700 font-semibold truncate">
                          {segmentationMetadata.segmentation_type === 'fixed'
                            ? `Fixed (${Math.round(segmentationMetadata.segmentation_value)} seg/route)`
                            : `Dist (${segmentationMetadata.segmentation_value} mi/seg)`}
                        </span>
                      </div>
                    )}

                    {/* Export to CSV Button - Next to Segmentation Metadata */}
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors shadow-sm"
                      title="Export filtered results to CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>

                  {/* Table - Takes remaining space */}
                  <div className="flex-1 min-h-0">
                    <ResultsTable
                      key={`${results.total}-${results.data?.length || 0}-${selectedYears.join(',')}`}
                      data={results}
                      surfTypeFilter={surfTypeFilter}
                      showIncreasingOnly={showIncreasingOnly}
                      selectedYears={selectedYears}
                      selectedRows={selectedRows}
                      onRowSelectionChange={setSelectedRows}
                      onFilteredDataChange={setFilteredData}
                      searchTerm={searchTerm}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Analysis Complete Modal */}
      {showAnalysisCompleteModal && analysisCompleteData && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100000]">
          <div className="bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 rounded-lg shadow-2xl p-6 max-w-lg w-full mx-4 ring-1 ring-inset ring-slate-700/50">
            <div className="border-b border-slate-700 pb-4 mb-4">
              <h2 className="text-2xl font-semibold">Analysis Complete</h2>
            </div>

            <div className="space-y-4 mb-6">
              <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 mb-1">Routes Processed</p>
                    <p className="text-2xl font-bold text-green-400">{analysisCompleteData.routesProcessed}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 mb-1">Segments Created</p>
                    <p className="text-2xl font-bold text-green-400">{analysisCompleteData.segmentsCreated}</p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
                <p className="text-sm text-slate-300">
                  The segmentation analysis has been completed successfully. You can now view and interact with the results in the table below.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowAnalysisCompleteModal(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors shadow-lg"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}
