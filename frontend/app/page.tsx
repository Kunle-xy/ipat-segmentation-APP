'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Header from '@/components/Header'
import LeftWidget from '@/components/LeftWidget'
import ResultsTable from '@/components/ResultsTable'
import axios from 'axios'
import { Table } from 'lucide-react'

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

interface UploadedFile {
  filename: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  message?: string
}

export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [processStatus, setProcessStatus] = useState<any>(null)
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numSegments, setNumSegments] = useState(20)
  const [countyName, setCountyName] = useState('')
  const [segmentationType, setSegmentationType] = useState<'fixed' | 'distance'>('fixed')
  const [segmentDistance, setSegmentDistance] = useState(0.1)

  // New states for county dropdown and filters
  const [availableCounties, setAvailableCounties] = useState<string[]>([])
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [surfTypeFilter, setSurfTypeFilter] = useState<string>('all')
  const [showIncreasingOnly, setShowIncreasingOnly] = useState(false)
  const [countyTables, setCountyTables] = useState<any[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [availableYears, setAvailableYears] = useState<string[]>([])
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [filteredData, setFilteredData] = useState<any[]>([])
  const [countyHasTables, setCountyHasTables] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [processedYears, setProcessedYears] = useState<string[]>([]) // Years used in segmentation
  const [isEditMode, setIsEditMode] = useState(false) // Allow changing year selection
  const [showTable, setShowTable] = useState(false) // Toggle table view
  const [tableHeight, setTableHeight] = useState(50) // Table height percentage (default 50%)
  const [isResizingTable, setIsResizingTable] = useState(false)
  const [searchTerm, setSearchTerm] = useState('') // Search term for table
  const [segmentationMetadata, setSegmentationMetadata] = useState<any>(null) // Metadata from database

  // Get selected segments for map with IRI data (memoized to prevent infinite loops)
  const selectedSegments = useMemo(() => {
    return Array.from(selectedRows).map(index => {
      const row = filteredData[index]
      if (!row) return null

      // Extract IRI data from all iri_YYYY columns
      const iriData: { year: string; iri: number }[] = []
      const columns = Object.keys(row)
      const iriColumns = columns.filter(col => col.startsWith('iri_')).sort()

      iriColumns.forEach(col => {
        const year = col.replace('iri_', '')
        const iriValue = row[col]
        if (iriValue !== null && iriValue !== undefined && !isNaN(iriValue)) {
          iriData.push({
            year: year,
            iri: parseFloat(iriValue)
          })
        }
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
        iriData: iriData
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

    setIsUploading(true)
    setError(null)
    setUploadProgress({ current: 0, total: files.length, currentFile: '' })

    // Track successful uploads locally (don't rely on async state)
    let hasSuccessfulUploads = false

    // Upload files one by one sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setUploadProgress({ current: i + 1, total: files.length, currentFile: file.name })

      // Add file to list with uploading status
      setUploadedFiles(prev => [...prev, { filename: file.name, status: 'uploading' }])

      try {
        const formData = new FormData()
        formData.append('files', file)

        const response = await axios.post(`${API_URL}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          params: { county_name: countyName.trim().toLowerCase() },
          onUploadProgress: (progressEvent) => {
            // This shows upload progress for individual file
            const percentCompleted = progressEvent.total
              ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
              : 0
            // We can use this for more granular progress if needed
          }
        })

        // Update file status to success
        setUploadedFiles(prev =>
          prev.map(f =>
            f.filename === file.name && f.status === 'uploading'
              ? { ...f, status: 'success', message: `${response.data.tables?.[0]?.rows || 0} rows` }
              : f
          )
        )

        // Mark that we had at least one successful upload
        hasSuccessfulUploads = true
      } catch (err: any) {
        // Update file status to error
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

    // If uploads were successful, fetch tables and set flag
    if (hasSuccessfulUploads) {
      setCountyHasTables(true)
      // Add small delay to ensure BigQuery metadata is updated
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

      // Show success message and alert
      const stats = response.data
      const successMsg = `✅ Segmentation complete! Processed ${stats.routes_processed || stats.statistics?.unique_routes || 'N/A'} routes with ${stats.segments_created || stats.statistics?.total_rows || 'N/A'} total segments.`
      setSuccessMessage(successMsg)

      // Show alert notification
      alert(`🎉 Analysis Complete!\n\n${stats.routes_processed || stats.statistics?.unique_routes || 'N/A'} routes processed\n${stats.segments_created || stats.statistics?.total_rows || 'N/A'} total segments created\n\nYou can now view the results in the table below.`)

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
        .filter((table: any) => table.table_name.startsWith('raw_distress_'))
        .map((table: any) => table.table_name.replace('raw_distress_', ''))
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
        />

        {/* Right Content Area (Map + Optional Table) */}
        <div ref={containerRef} className="flex-1 flex flex-col relative z-10">
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

          {/* Table Toggle Button */}
          {results && !showTable && (
            <button
              onClick={() => setShowTable(true)}
              className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg shadow-lg border border-gray-300 transition-colors"
              title="Show table"
            >
              <Table className="h-5 w-5" />
              <span className="text-sm font-medium">Show Table</span>
            </button>
          )}

          {/* Hide Table Button - positioned above map */}
          {showTable && results && (
            <button
              onClick={() => {
                setShowTable(false)
                setTableHeight(50) // Reset to default height
              }}
              style={{ pointerEvents: 'auto' }}
              className="absolute top-4 right-4 z-[9999] flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg shadow-2xl border-2 border-red-800 transition-all hover:scale-105 font-semibold"
              title="Hide table and expand map to full view"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="text-sm">Hide Table</span>
            </button>
          )}

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
              {/* FIXED Close Button - Escapes all containers */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowTable(false)
                  setTableHeight(50)
                }}
                className="fixed z-[99999] flex items-center justify-center w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-2xl transition-all hover:scale-110 border-2 border-white cursor-pointer"
                style={{
                  top: `calc(${100 - tableHeight}% + 65px)`,
                  right: '20px',
                  pointerEvents: 'auto'
                }}
                title="Close table and return to full map view"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

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
                className="bg-white relative w-full"
              >
                {/* Scrollable Table Content */}
                <div className="h-full flex flex-col p-2">
                  {/* Compact Header Row - Everything Aligned */}
                  <div className="flex flex-wrap items-center gap-2 mb-1.5 pb-1.5 border-b border-gray-200">
                    <h2 className="text-base font-semibold whitespace-nowrap">Results</h2>

                    <select
                      value={surfTypeFilter}
                      onChange={(e) => setSurfTypeFilter(e.target.value)}
                      className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="all">All Surface Types</option>
                      {Array.from(new Set(results.data.map((row: any) => row.surftype)))
                        .filter(Boolean)
                        .sort()
                        .map((surftype: any) => (
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
                    <div className="relative w-48">
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
                      <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 px-3 py-1 rounded shrink-0">
                        <span className="font-semibold text-blue-900">Segmentation Method:</span>
                        <span className="text-blue-700 font-semibold">
                          {segmentationMetadata.segmentation_type === 'fixed'
                            ? `Fixed (${Math.round(segmentationMetadata.segmentation_value)} segments per route)`
                            : `Distance-Based (${segmentationMetadata.segmentation_value} mile${segmentationMetadata.segmentation_value !== 1 ? 's' : ''} per segment)`}
                        </span>
                      </div>
                    )}
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
    </div>
  )
}
