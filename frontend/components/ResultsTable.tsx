'use client'

import { useEffect, useMemo } from 'react'

interface ResultsTableProps {
  data: {
    total: number
    limit: number
    offset: number
    data: any[]
  }
  surfTypeFilter?: string
  showIncreasingOnly?: boolean
  selectedYears?: string[]
  selectedRows?: Set<number>
  onRowSelectionChange?: (selectedIndexes: Set<number>) => void
  onFilteredDataChange?: (filteredData: any[]) => void
  searchTerm?: string
}

export default function ResultsTable({
  data,
  surfTypeFilter = 'all',
  showIncreasingOnly = false,
  selectedYears = [],
  selectedRows = new Set(),
  onRowSelectionChange,
  onFilteredDataChange,
  searchTerm = ''
}: ResultsTableProps) {
  // ALL HOOKS MUST BE AT THE TOP

  // Check if IRI values are consistently increasing
  const hasIncreasingIRI = (row: any, iriColumns: string[]) => {
    const iriValues = iriColumns
      .map(col => row[col])
      .filter(val => val !== null && val !== undefined && !isNaN(val))

    if (iriValues.length < 2) return false

    for (let i = 1; i < iriValues.length; i++) {
      if (iriValues[i] <= iriValues[i - 1]) {
        return false
      }
    }
    return true
  }

  // Separate IRI and index columns from others (memoized)
  const { iriColumns, indexColumns, otherColumns } = useMemo(() => {
    if (!data || !data.data || data.data.length === 0) {
      return { iriColumns: [], indexColumns: [], otherColumns: [] }
    }
    const columns = Object.keys(data.data[0])
    let iriCols = columns.filter(col => col.startsWith('iri_')).sort()
    let indexCols = columns.filter(col => col.startsWith('index_')).sort()
    const otherCols = columns.filter(col => !col.startsWith('iri_') && !col.startsWith('index_'))

    // Filter IRI and index columns based on selected years
    if (selectedYears.length > 0) {
      iriCols = iriCols.filter(col => {
        const year = col.replace('iri_', '')
        return selectedYears.includes(year)
      })
      indexCols = indexCols.filter(col => {
        const year = col.replace('index_', '')
        return selectedYears.includes(year)
      })
    }

    return { iriColumns: iriCols, indexColumns: indexCols, otherColumns: otherCols }
  }, [data, selectedYears])

  // Apply filters (memoized to prevent infinite loops)
  const filteredData = useMemo(() => {
    if (!data || !data.data) return []

    let filtered = data.data

    // Filter by selected years - only show rows with at least one selected year having data
    if (selectedYears.length > 0) {
      filtered = filtered.filter(row => {
        return selectedYears.some(year => {
          const iriCol = `iri_${year}`
          return row[iriCol] !== null && row[iriCol] !== undefined
        })
      })
    }

    // Filter by surface type
    if (surfTypeFilter && surfTypeFilter !== 'all') {
      filtered = filtered.filter(row => row.surftype === surfTypeFilter)
    }

    // Filter by increasing IRI (only consider selected years)
    if (showIncreasingOnly) {
      filtered = filtered.filter(row => hasIncreasingIRI(row, iriColumns))
    }

    // Filter by search term (route name) - only if it produces results
    if (searchTerm.trim()) {
      const searchFiltered = filtered.filter(row => {
        const routeName = (row.ROUTE_NAME || row.route_name || '').toString().toLowerCase()
        return routeName.includes(searchTerm.toLowerCase())
      })

      // Only apply search filter if it matches something, otherwise keep all current results
      if (searchFiltered.length > 0) {
        filtered = searchFiltered
      }
    }

    return filtered
  }, [data, searchTerm, selectedYears, surfTypeFilter, showIncreasingOnly, iriColumns])

  // Notify parent of filtered data changes
  useEffect(() => {
    if (onFilteredDataChange) {
      onFilteredDataChange(filteredData)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData])

  // Early returns AFTER all hooks
  if (!data || !data.data || data.data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No results available
      </div>
    )
  }

  // Show message for non-search filters that return no results
  if (filteredData.length === 0 && !searchTerm.trim()) {
    return (
      <div className="text-center py-8 text-gray-500">
        No results match the selected filters (year, surface type, or IRI trend)
      </div>
    )
  }

  // Handle checkbox toggle
  const handleRowToggle = (rowIndex: number) => {
    if (!onRowSelectionChange) return

    const newSelection = new Set(selectedRows)
    if (newSelection.has(rowIndex)) {
      newSelection.delete(rowIndex)
    } else {
      newSelection.add(rowIndex)
    }
    onRowSelectionChange(newSelection)
  }

  // Select all visible rows
  const handleSelectAll = () => {
    if (!onRowSelectionChange) return

    if (selectedRows.size === filteredData.length) {
      // Deselect all
      onRowSelectionChange(new Set())
    } else {
      // Select all visible
      const allIndexes = new Set(filteredData.map((_, index) => index))
      onRowSelectionChange(allIndexes)
    }
  }

  // Export to CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) return

    // Combine all columns in proper order: other columns, then IRI columns, then index columns
    const allColumns = [...otherColumns, ...iriColumns, ...indexColumns]

    // Create CSV header
    const header = allColumns.map(col => col.replace(/_/g, ' ').toUpperCase()).join(',')

    // Create CSV rows
    const rows = filteredData.map(row => {
      return allColumns.map(col => {
        const value = row[col]
        if (value === null || value === undefined) return ''
        if (typeof value === 'number') {
          // Use 8 decimal places for coordinates, 2 for length, 4 for other numbers
          if (col.includes('lat') || col.includes('lon')) {
            return value.toFixed(8)
          }
          if (col === 'length_ft') {
            return value.toFixed(2)
          }
          return value.toFixed(4)
        }
        // Escape values with commas or quotes
        if (String(value).includes(',') || String(value).includes('"')) {
          return `"${String(value).replace(/"/g, '""')}"`
        }
        return value
      }).join(',')
    }).join('\n')

    // Combine header and rows
    const csv = `${header}\n${rows}`

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `ipat_results_${new Date().toISOString().slice(0,10)}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Check if search has no matches
  const searchHasNoMatches = useMemo(() => {
    if (!searchTerm.trim()) return false
    return !filteredData.some(row => {
      const routeName = (row.ROUTE_NAME || row.route_name || '').toString().toLowerCase()
      return routeName.includes(searchTerm.toLowerCase())
    })
  }, [searchTerm, filteredData])

  return (
    <div className="h-full flex flex-col">
      {/* No Match Warning */}
      {searchHasNoMatches && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-2 py-1.5 rounded flex items-start gap-1.5 text-xs mb-2">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <strong>No matches for "{searchTerm}"</strong>
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex justify-between items-center mb-2 flex-shrink-0">
        <p className="text-xs text-gray-600">
          <span className="font-semibold text-gray-900">{filteredData.length}</span> rows
          {filteredData.length < data.data.length && !searchHasNoMatches && (
            <span className="ml-1 text-blue-600">(of {data.data.length})</span>
          )}
          {data.total > data.data.length && (
            <span className="ml-1 text-gray-500">• {data.total} total</span>
          )}
        </p>

        <button
          onClick={exportToCSV}
          disabled={filteredData.length === 0}
          className="flex items-center gap-1.5 bg-green-600 text-white px-2.5 py-1 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-xs"
          title="Download CSV"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          CSV
        </button>
      </div>

      {/* Table container with VISIBLE scrollbar */}
      <div
        className="flex-1 border rounded-lg"
        style={{
          overflow: 'auto',
          maxHeight: 'calc(100% - 40px)',
          minHeight: '200px'
        }}
      >
        <div style={{ width: '2000px', minWidth: '100%' }}>
          <table className="w-full divide-y divide-gray-200">
            <thead className="sticky top-0 z-[5] shadow-sm">
            <tr>
              <th className="px-2 py-2 text-left bg-gray-50 sticky left-0 z-10">
                <input
                  type="checkbox"
                  checked={selectedRows.size === filteredData.length && filteredData.length > 0}
                  onChange={handleSelectAll}
                  className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  title="Select all visible rows"
                />
              </th>
              {otherColumns.map(column => (
                <th
                  key={column}
                  className="px-2 py-2 text-left text-[10px] font-medium text-gray-500 uppercase tracking-tight whitespace-nowrap bg-gray-50"
                >
                  {column.replace(/_/g, ' ')}
                </th>
              ))}
              {iriColumns.map(column => (
                <th
                  key={column}
                  className="px-2 py-2 text-left text-[10px] font-medium text-gray-500 uppercase tracking-tight whitespace-nowrap bg-gray-50"
                >
                  {column.replace(/_/g, ' ')}
                </th>
              ))}
              {indexColumns.map(column => (
                <th
                  key={column}
                  className="px-2 py-2 text-left text-[10px] font-medium text-blue-600 uppercase tracking-tight whitespace-nowrap bg-blue-50"
                  title="Row indices used for this segment"
                >
                  {column.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredData.map((row, rowIndex) => {
              const isIncreasing = hasIncreasingIRI(row, iriColumns)
              const isSelected = selectedRows.has(rowIndex)
              return (
                <tr
                  key={rowIndex}
                  className={`hover:bg-gray-50 ${isIncreasing ? 'bg-green-50' : ''} ${isSelected ? 'bg-blue-100' : ''}`}
                  title={isIncreasing ? 'This route has consistent IRI increase' : ''}
                >
                  <td className="px-2 py-1 text-center sticky left-0 bg-white z-[1]">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleRowToggle(rowIndex)}
                    className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </td>
                {otherColumns.map(column => (
                  <td
                    key={column}
                    className="px-2 py-1 text-[11px] text-gray-900 whitespace-nowrap"
                  >
                    {typeof row[column] === 'number'
                      ? column.includes('lat') || column.includes('lon')
                        ? row[column].toFixed(8)
                        : column === 'length_ft'
                        ? row[column].toFixed(2)
                        : row[column].toFixed(4)
                      : row[column]}
                  </td>
                ))}
                {iriColumns.map(column => (
                  <td
                    key={column}
                    className="px-2 py-1 text-[11px] text-gray-900 whitespace-nowrap"
                  >
                    {row[column] ? row[column].toFixed(4) : 'N/A'}
                  </td>
                ))}
                {indexColumns.map(column => (
                  <td
                    key={column}
                    className="px-2 py-1 text-[11px] text-blue-700 whitespace-nowrap bg-blue-50 font-mono"
                    title={`Row indices: ${row[column] || 'N/A'}`}
                  >
                    {row[column] || 'N/A'}
                  </td>
                ))}
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
