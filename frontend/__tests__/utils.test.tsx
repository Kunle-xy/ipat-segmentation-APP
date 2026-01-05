/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// Utility function tests
describe('Year Extraction Utility', () => {
  const extractYearFromFilename = (filename: string): string | null => {
    const match = filename.match(/(19|20)\d{2}/)
    return match ? match[0] : null
  }

  it('extracts year from various filename formats', () => {
    expect(extractYearFromFilename('distress_2020.xlsx')).toBe('2020')
    expect(extractYearFromFilename('2021_data.xlsx')).toBe('2021')
    expect(extractYearFromFilename('data_2019_final.xlsx')).toBe('2019')
    expect(extractYearFromFilename('2022.xlsx')).toBe('2022')
  })

  it('returns null for filename without year', () => {
    expect(extractYearFromFilename('data_file.xlsx')).toBeNull()
    expect(extractYearFromFilename('distress.xlsx')).toBeNull()
  })

  it('handles edge cases', () => {
    expect(extractYearFromFilename('file_1999.xlsx')).toBe('1999')
    expect(extractYearFromFilename('2099_future.xlsx')).toBe('2099')
  })
})

describe('IRI Data Processing', () => {
  interface IRIData {
    year: string
    iri: number
  }

  const extractIRIData = (row: Record<string, any>): IRIData[] => {
    const iriData: IRIData[] = []
    const columns = Object.keys(row)
    const iriColumns = columns.filter(col => col.startsWith('iri_')).sort()

    iriColumns.forEach(col => {
      const year = col.replace('iri_', '')
      const iriValue = row[col]
      if (iriValue !== null && iriValue !== undefined && !isNaN(iriValue)) {
        iriData.push({ year, iri: iriValue })
      }
    })

    return iriData
  }

  it('extracts IRI data from row correctly', () => {
    const row = {
      route_name: 'US-30',
      iri_2020: 85.5,
      iri_2021: 90.2,
      iri_2022: 88.0
    }

    const result = extractIRIData(row)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ year: '2020', iri: 85.5 })
    expect(result[1]).toEqual({ year: '2021', iri: 90.2 })
    expect(result[2]).toEqual({ year: '2022', iri: 88.0 })
  })

  it('handles missing IRI values', () => {
    const row = {
      route_name: 'US-30',
      iri_2020: 85.5,
      iri_2021: null,
      iri_2022: undefined
    }

    const result = extractIRIData(row)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ year: '2020', iri: 85.5 })
  })

  it('handles NaN IRI values', () => {
    const row = {
      iri_2020: 85.5,
      iri_2021: NaN
    }

    const result = extractIRIData(row)

    expect(result).toHaveLength(1)
  })

  it('returns empty array when no IRI columns', () => {
    const row = {
      route_name: 'US-30',
      segment_id: 1
    }

    const result = extractIRIData(row)

    expect(result).toHaveLength(0)
  })
})

describe('Filter Utilities', () => {
  it('filters data by surface type', () => {
    const data = [
      { route_name: 'US-30', surftype: 'AC' },
      { route_name: 'I-80', surftype: 'PCC' },
      { route_name: 'US-20', surftype: 'AC' }
    ]

    const filtered = data.filter(row => row.surftype === 'AC')

    expect(filtered).toHaveLength(2)
    expect(filtered.every(row => row.surftype === 'AC')).toBe(true)
  })

  it('filters for increasing IRI only', () => {
    const data = [
      { route_name: 'US-30', iri_2020: 80, iri_2021: 85 }, // increasing
      { route_name: 'I-80', iri_2020: 90, iri_2021: 85 },  // decreasing
      { route_name: 'US-20', iri_2020: 75, iri_2021: 80 }  // increasing
    ]

    const isIncreasing = (row: any) => {
      const years = Object.keys(row).filter(k => k.startsWith('iri_')).sort()
      if (years.length < 2) return false
      const firstIRI = row[years[0]]
      const lastIRI = row[years[years.length - 1]]
      return lastIRI > firstIRI
    }

    const filtered = data.filter(isIncreasing)

    expect(filtered).toHaveLength(2)
  })
})

describe('Search Functionality', () => {
  it('filters data by search term', () => {
    const data = [
      { route_name: 'US-30', county: 'POLK' },
      { route_name: 'I-80', county: 'STORY' },
      { route_name: 'US-30', county: 'STORY' }
    ]

    const searchTerm = 'US-30'
    const filtered = data.filter(row => 
      row.route_name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    expect(filtered).toHaveLength(2)
  })

  it('handles case-insensitive search', () => {
    const data = [{ route_name: 'US-30' }]
    const searchTerm = 'us-30'

    const filtered = data.filter(row => 
      row.route_name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    expect(filtered).toHaveLength(1)
  })

  it('handles empty search term', () => {
    const data = [
      { route_name: 'US-30' },
      { route_name: 'I-80' }
    ]
    const searchTerm = ''

    const filtered = searchTerm 
      ? data.filter(row => row.route_name.includes(searchTerm))
      : data

    expect(filtered).toHaveLength(2)
  })
})
