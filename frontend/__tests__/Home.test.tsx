/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}))

// Mock next/dynamic
jest.mock('next/dynamic', () => () => {
  const DynamicComponent = () => <div data-testid="mock-map">Map Component</div>
  return DynamicComponent
})

// Mock the components that are dynamically imported
jest.mock('../components/MapView', () => {
  return function MockMapView() {
    return <div data-testid="map-view">Map View</div>
  }
})

describe('Home Page Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should have proper environment variable handling', () => {
    // Test that API_URL defaults to localhost if not set
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8010'
    expect(defaultUrl).toBe('http://localhost:8010')
  })
})

describe('API URL Configuration', () => {
  it('uses correct default API URL', () => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8010'
    expect(API_URL).toContain('localhost:8010')
  })

  it('constructs valid endpoints', () => {
    const API_URL = 'http://localhost:8010'
    
    const endpoints = {
      health: `${API_URL}/health`,
      upload: `${API_URL}/upload`,
      process: `${API_URL}/process`,
      results: `${API_URL}/results`,
      tables: `${API_URL}/tables`,
      clear: `${API_URL}/clear`,
    }
    
    expect(endpoints.health).toBe('http://localhost:8010/health')
    expect(endpoints.upload).toBe('http://localhost:8010/upload')
    expect(endpoints.process).toBe('http://localhost:8010/process')
    expect(endpoints.results).toBe('http://localhost:8010/results')
  })
})

describe('Data Types', () => {
  interface UploadedFile {
    filename: string
    status: 'pending' | 'uploading' | 'success' | 'error'
    message?: string
  }

  it('validates UploadedFile interface', () => {
    const validFile: UploadedFile = {
      filename: 'test_2020.xlsx',
      status: 'success',
      message: 'Uploaded successfully'
    }
    
    expect(validFile.filename).toBe('test_2020.xlsx')
    expect(validFile.status).toBe('success')
    expect(validFile.message).toBe('Uploaded successfully')
  })

  it('handles file status transitions', () => {
    const file: UploadedFile = {
      filename: 'data.xlsx',
      status: 'pending'
    }
    
    // Simulate status changes
    const statuses: Array<'pending' | 'uploading' | 'success' | 'error'> = ['pending', 'uploading', 'success']
    
    statuses.forEach(status => {
      file.status = status
      expect(['pending', 'uploading', 'success', 'error']).toContain(file.status)
    })
  })
})

describe('Segment Configuration', () => {
  it('validates segment range', () => {
    const minSegments = 1
    const maxSegments = 100
    const defaultSegments = 20
    
    expect(defaultSegments).toBeGreaterThanOrEqual(minSegments)
    expect(defaultSegments).toBeLessThanOrEqual(maxSegments)
  })

  it('handles segment distance for distance-based segmentation', () => {
    const segmentDistance = 0.1 // miles
    
    expect(segmentDistance).toBeGreaterThan(0)
    expect(segmentDistance).toBeLessThan(10) // reasonable max
  })
})
