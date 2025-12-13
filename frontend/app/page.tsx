'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import FileUpload from '@/components/FileUpload'
import ResultsTable from '@/components/ResultsTable'
import axios from 'axios'

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
      const response = await axios.post(`${API_URL}/process`, null, {
        params: {
          num_segments: numSegments,
          county_name: countyName.trim().toLowerCase(),
          selected_years: selectedYears.join(',')
        }
      })
      setProcessStatus(response.data)

      // Automatically fetch results and tables after processing
      await fetchResults()
      fetchCountyTables()

      // Lock the processed years and exit edit mode
      setProcessedYears([...selectedYears])
      setIsEditMode(false)

      // Show success message
      const stats = response.data
      setSuccessMessage(
        `✅ Segmentation complete! Processed ${stats.routes_processed || stats.statistics?.unique_routes || 'N/A'} routes with ${stats.segments_created || stats.statistics?.total_rows || 'N/A'} total segments.`
      )

      // Auto-hide success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000)
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

    const confirmMsg = `🔄 FULL REPROCESSING WITH SELECTED YEARS\n\n` +
      `This will:\n` +
      `• Recreate all segmentation tables\n` +
      `• Apply overlapping segment logic for ${selectedYears.join(', ')}\n` +
      `• Generate ${numSegments} segments per route\n` +
      `• Only include routes with consecutive years in selection\n\n` +
      `County: ${countyName}\n` +
      `Years: ${selectedYears.join(', ')}\n` +
      `Segments: ${numSegments}\n\n` +
      `Continue?`

    if (!confirm(confirmMsg)) {
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    console.log(`🔄 Starting full reprocessing for ${countyName} with years: ${selectedYears.join(', ')}`)

    try {
      const response = await axios.post(`${API_URL}/process`, null, {
        params: {
          num_segments: numSegments,
          county_name: countyName.trim().toLowerCase(),
          selected_years: selectedYears.join(',')
        }
      })

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
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            IPAT Segmentation Analysis
          </h1>
          <p className="mt-2 text-gray-600">
            Upload Excel files with pavement distress data and run dynamic segmentation analysis
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            <strong>Error:</strong>
            <div className="mt-1 whitespace-pre-line">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <strong>Success!</strong>
              <div className="mt-1">{successMessage}</div>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-green-600 hover:text-green-800"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">County Information</h2>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={fetchCounties}
                  disabled={loadingCounties}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  title="Load existing county data"
                >
                  {loadingCounties ? (
                    <svg className="animate-spin w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                  )}
                  {loadingCounties ? 'Loading...' : 'Load Data'}
                </button>

                {showCountyDropdown && availableCounties.length > 0 && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-300 rounded-lg shadow-xl z-10 max-h-80 overflow-y-auto">
                    <div className="p-2 border-b border-gray-200 bg-gray-50">
                      <p className="text-sm font-semibold text-gray-700">Select County</p>
                    </div>
                    {availableCounties.map((county) => (
                      <button
                        key={county}
                        onClick={() => handleLoadCountyData(county)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
                      >
                        <span className="text-sm font-medium text-gray-900 capitalize">
                          {county.replace(/_/g, ' ')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {showCountyDropdown && availableCounties.length === 0 && !loadingCounties && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-300 rounded-lg shadow-xl z-10 p-4">
                    <p className="text-sm text-gray-600">No counties with data found</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                County Name *
              </label>
              <input
                type="text"
                value={countyName}
                onChange={(e) => setCountyName(e.target.value)}
                placeholder="e.g., Polk, Linn, Scott, Johnson, Black Hawk"
                disabled={loading}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-200"
              />
              <p className="mt-1 text-sm text-gray-500">
                All uploaded tables and results will be saved under this county name. Or click "Load Data" to view existing counties.
              </p>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Data Upload & Segmentation</h2>

            {/* Upload Progress Bar */}
            {isUploading && uploadProgress.total > 0 && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-900">
                    Uploading {uploadProgress.current} of {uploadProgress.total} files
                  </span>
                  <span className="text-sm text-blue-700">
                    {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-xs text-blue-600">
                  📁 {uploadProgress.currentFile}
                </p>
              </div>
            )}

            <FileUpload
              onUploadAll={handleUploadAll}
              disabled={loading || !countyName.trim()}
              uploadedFiles={uploadedFiles}
              isUploading={isUploading}
            />

            {successfulUploads >= 2 && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
                <p className="font-semibold text-green-800">
                  ✓ {successfulUploads} files uploaded successfully for {countyName}
                </p>
                <p className="text-sm text-green-700 mt-1">
                  Select years and segments below to run segmentation.
                </p>
              </div>
            )}

            {successfulUploads === 1 && !isUploading && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                <p className="font-semibold text-yellow-800">
                  ⚠ 1 file uploaded - you need at least 2 years of data
                </p>
                <p className="text-sm text-yellow-700 mt-1">
                  Please upload at least one more file with a different year.
                </p>
              </div>
            )}

            {/* County Tables Info - Show if uploaded or loaded */}
            {countyName && countyTables.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-blue-900">
                    📊 Uploaded Tables for {countyName.charAt(0).toUpperCase() + countyName.slice(1).replace(/_/g, ' ')}
                    {processedYears.length > 0 && !isEditMode && (
                      <span className="ml-2 text-xs font-normal text-green-700">
                        (Locked to: {processedYears.join(', ')})
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2">
                    {processedYears.length > 0 && !isEditMode && (
                      <button
                        onClick={() => setIsEditMode(true)}
                        disabled={loading}
                        className="flex items-center gap-1 text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        title="Edit year selection and reprocess"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                <>
                  <div className="mb-3">
                    <p className="text-xs text-blue-700">
                      {processedYears.length > 0 && !isEditMode
                        ? '🔍 Filter results by year (toggle within processed years):'
                        : 'Select years to process (minimum 2 years):'}
                    </p>
                    {isEditMode && processedYears.length > 0 && (
                      <p className="text-xs text-orange-600 mt-1 font-semibold">
                        ⚠️ Edit Mode: Changing years will reprocess the entire segmentation
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {countyTables
                      .filter((table: any) => table.table_name.startsWith('raw_distress_'))
                      .map((table: any) => {
                        const year = table.table_name.replace('raw_distress_', '')
                        const isSelected = selectedYears.includes(year)
                        const isProcessed = processedYears.includes(year)
                        const isDisabled = processedYears.length > 0 && !isEditMode && !isProcessed

                        return (
                          <label
                            key={table.table_name}
                            className={`px-3 py-2 rounded border-2 transition-all ${
                              isDisabled
                                ? 'cursor-not-allowed bg-gray-100 border-gray-300 opacity-50'
                                : 'cursor-pointer bg-white ' + (
                                  isSelected
                                    ? 'border-blue-500 bg-blue-100'
                                    : 'border-blue-300 hover:border-blue-400'
                                )
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isDisabled}
                                onChange={() => toggleYearSelection(year)}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:cursor-not-allowed"
                              />
                              <span className={`text-sm font-medium ${isDisabled ? 'text-gray-500' : 'text-blue-800'}`}>
                                📅 {year}
                                {isDisabled && (
                                  <span className="ml-1 text-xs">🔒</span>
                                )}
                              </span>
                            </div>
                          </label>
                        )
                      })}
                  </div>
                  {isEditMode || processedYears.length === 0 ? (
                    <>
                      {selectedYears.length < 2 && (
                        <p className="mt-2 text-xs text-red-600">
                          ⚠️ Please select at least 2 years for processing (currently: {selectedYears.length})
                        </p>
                      )}
                      {selectedYears.length >= 2 && (
                        <p className="mt-2 text-xs text-blue-600">
                          ✓ {selectedYears.length} year{selectedYears.length !== 1 ? 's' : ''} selected for processing
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-green-600">
                      🔍 Filtering results from processed years: {processedYears.join(', ')} (showing: {selectedYears.join(', ')})
                    </p>
                  )}
                </>
              </div>
            )}

            {/* Segmentation Settings - Show when tables available */}
            {(successfulUploads >= 2 || countyHasTables) && (
              <div className="mt-6">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Number of Segments per Route
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="100"
                    value={numSegments}
                    onChange={(e) => setNumSegments(parseInt(e.target.value) || 20)}
                    disabled={loading}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-200"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Choose between 10 and 100 segments (default: 20)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isEditMode && processedYears.length > 0 && (
                    <button
                      onClick={() => {
                        setIsEditMode(false)
                        setSelectedYears([...processedYears])
                      }}
                      disabled={loading}
                      className="flex items-center gap-1 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                      title="Cancel editing and restore previous selection"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleProcess}
                    disabled={loading || !countyName.trim() || selectedYears.length < 2}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    title={selectedYears.length < 2 ? 'Please select at least 2 years' : ''}
                  >
                    {loading && (
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    )}
                    {loading ? 'Processing...' : (isEditMode && processedYears.length > 0 ? 'Reprocess Segmentation' : 'Run Segmentation')}
                  </button>
                </div>

                {selectedYears.length < 2 && countyTables.length > 0 && (
                  <p className="mt-2 text-sm text-red-600">
                    ⚠️ Please select at least 2 years to run segmentation
                  </p>
                )}

                {processStatus && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                    <p className="font-semibold text-blue-800">
                      {processStatus.message}
                    </p>
                    <div className="mt-2 text-sm text-blue-700">
                      <p>County: {countyName}</p>
                      <p>Segments per Route: {processStatus.num_segments}</p>
                      <p>Total Rows: {processStatus.statistics?.total_rows}</p>
                      <p>Unique Routes: {processStatus.statistics?.unique_routes}</p>
                      <p>Expected Routes: {processStatus.statistics?.expected_routes}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {results && (
            <>
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Result Filters</h2>

                {/* Data Filters */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Surface Type
                      </label>
                      <select
                        value={surfTypeFilter}
                        onChange={(e) => setSurfTypeFilter(e.target.value)}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
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
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showIncreasingOnly}
                          onChange={(e) => setShowIncreasingOnly(e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          Show only routes with consistent IRI increase
                        </span>
                      </label>
                    </div>
                  </div>
              </div>

              {results && (
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-xl font-semibold mb-4">Step 3: Results & Map</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Results Table */}
                    <div>
                      <ResultsTable
                        key={`${results.total}-${results.data?.length || 0}-${selectedYears.join(',')}`}
                        data={results}
                        surfTypeFilter={surfTypeFilter}
                        showIncreasingOnly={showIncreasingOnly}
                        selectedYears={selectedYears}
                        selectedRows={selectedRows}
                        onRowSelectionChange={setSelectedRows}
                        onFilteredDataChange={setFilteredData}
                      />
                    </div>

                    {/* Map View */}
                    <div className="h-[600px] border rounded-lg overflow-hidden">
                      <MapView selectedSegments={selectedSegments as any} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {successfulUploads >= 1 && (
            <div className="bg-white shadow rounded-lg p-6">
              <button
                onClick={handleClear}
                disabled={loading}
                className="flex items-center gap-2 bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading && (
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {loading ? 'Clearing...' : 'Clear All Data'}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
