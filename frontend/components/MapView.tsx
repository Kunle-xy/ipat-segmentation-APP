'use client'

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root as ReactDOMRoot } from 'react-dom/client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import IRIBarChart from './IRIBarChart'

interface MapSegment {
  route_name: string
  segment_id: number
  from_lat: number
  from_lon: number
  to_lat: number
  to_lon: number
  surftype?: string
  iriData?: { year: string; iri: number }[]
  liriData?: { year: string; liri: number | null }[]
  ririData?: { year: string; riri: number | null }[]
  length?: number
}

interface MapViewProps {
  selectedSegments: MapSegment[]
}

export default function MapView({ selectedSegments }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const segmentLayersRef = useRef<L.Polyline[]>([])
  const segmentIndexMapRef = useRef<Map<number, number>>(new Map()) // Maps segment_id to polyline index
  const whiteOutlineRef = useRef<L.Polyline | null>(null) // White outline for selected segment
  const [hoveredSegment, setHoveredSegment] = useState<MapSegment | null>(null)
  const [zoomEnabled, setZoomEnabled] = useState(true)
  const [viewMode, setViewMode] = useState<'segmentation' | 'iri-range'>('segmentation')
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const [basemap, setBasemap] = useState<'default' | 'satellite' | 'topo'>('default')
  const tileLayerRef = useRef<L.TileLayer | null>(null)

  // Utility function to get all available years from segments
  const getAvailableYears = (segments: MapSegment[]): string[] => {
    const yearsSet = new Set<string>()
    segments.forEach(segment => {
      segment.iriData?.forEach(data => {
        yearsSet.add(data.year)
      })
    })
    return Array.from(yearsSet).sort((a, b) => parseInt(b) - parseInt(a))
  }

  // Utility function to get IRI color based on year
  const getIRIColorForYear = (segment: MapSegment, year: string | null): { color: string; label: string } => {
    if (!year) return { color: '#9CA3AF', label: 'No Year Selected' }

    // Find IRI for the specific year
    const iriForYear = segment.iriData?.find(data => data.year === year)?.iri

    if (iriForYear === undefined) return { color: '#9CA3AF', label: 'No Data' }

    if (iriForYear < 60) return { color: '#00E5FF', label: 'Very Good' }
    if (iriForYear < 95) return { color: '#76FF03', label: 'Good' }
    if (iriForYear < 170) return { color: '#FFEA00', label: 'Fair' }
    if (iriForYear < 220) return { color: '#FF6D00', label: 'Poor' }
    return { color: '#FF1744', label: 'Very Poor' }
  }

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    // Create map centered on Iowa (approximately) with zoom controls
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      boxZoom: true,
      keyboard: true,
      dragging: true,
      minZoom: 1,
      maxZoom: 20
    }).setView([42.0, -93.5], 7)

    // Add default tile layer
    const defaultLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
      minZoom: 1
    }).addTo(map)

    tileLayerRef.current = defaultLayer
    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Auto-select most recent year when switching to IRI Range View or when segments change
  useEffect(() => {
    if (viewMode === 'iri-range') {
      const availableYears = getAvailableYears(selectedSegments)
      if (availableYears.length > 0 && !selectedYear) {
        setSelectedYear(availableYears[0]) // Most recent year
      }
    }
  }, [viewMode, selectedSegments, selectedYear])

  // Toggle zoom functionality
  useEffect(() => {
    if (!mapRef.current) return

    if (zoomEnabled) {
      mapRef.current.scrollWheelZoom.enable()
      mapRef.current.doubleClickZoom.enable()
      mapRef.current.touchZoom.enable()
      mapRef.current.boxZoom.enable()
      mapRef.current.keyboard.enable()
    } else {
      mapRef.current.scrollWheelZoom.disable()
      mapRef.current.doubleClickZoom.disable()
      mapRef.current.touchZoom.disable()
      mapRef.current.boxZoom.disable()
      mapRef.current.keyboard.disable()
    }
  }, [zoomEnabled])

  // Switch basemap layer
  useEffect(() => {
    if (!mapRef.current) return

    const tiles = {
      default: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
      satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      },
      topo: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
      },
    }

    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current)
    }

    const config = tiles[basemap]
    tileLayerRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 20,
      minZoom: 1,
    }).addTo(mapRef.current)

    // Keep segments on top
    segmentLayersRef.current.forEach(layer => layer.bringToFront())
  }, [basemap])

  // Update map when selected segments change
  useEffect(() => {
    if (!mapRef.current) return

    // Remove existing segment layers
    segmentLayersRef.current.forEach(layer => {
      mapRef.current?.removeLayer(layer)
    })
    segmentLayersRef.current = []
    segmentIndexMapRef.current.clear()

    if (selectedSegments.length === 0) return

    const newLayers: L.Polyline[] = []
    const allCoords: L.LatLngExpression[] = []

    // Add each segment as a line
    selectedSegments.forEach((segment, index) => {
      // Store mapping of segment_id to polyline index
      segmentIndexMapRef.current.set(segment.segment_id, index)
      const coords: L.LatLngExpression[] = [
        [segment.from_lat, segment.from_lon],
        [segment.to_lat, segment.to_lon]
      ]

      allCoords.push(...coords)

      // Determine color based on view mode
      let color: string
      if (viewMode === 'segmentation') {
        // Color code by index for visibility
        const colors = [
          '#FF1744', // bright red
          '#00E5FF', // cyan
          '#FFEA00', // vivid yellow
          '#D500F9', // electric purple
          '#76FF03', // vivid lime
          '#FF6D00', // vivid orange
          '#00B0FF', // light blue
          '#F50057', // hot pink
          '#1DE9B6', // teal
          '#FF9100', // amber
          '#651FFF', // deep violet
          '#64DD17', // light green
        ]
        color = colors[index % colors.length]
      } else {
        // IRI Range View - color based on IRI value for selected year
        color = getIRIColorForYear(segment, selectedYear).color
      }

      const polyline = L.polyline(coords, {
        color: color,
        weight: 4,
        opacity: 0.8
      }).addTo(mapRef.current!)

      // Store segment data directly on the polyline for easy access
      ;(polyline as any)._segmentData = segment

      // Add hover effect for visual feedback
      // Note: The selected segment (showing IRI) will maintain its bold style
      // due to the useEffect below that runs when hoveredSegment changes
      polyline.on('mouseover', () => {
        // Check current style - if already bold (weight >= 10), don't change on hover
        const currentWeight = polyline.options.weight
        if (currentWeight && currentWeight < 10) {
          polyline.setStyle({ weight: 6, opacity: 1 })
        }
      })

      polyline.on('mouseout', () => {
        // Check current style - if already bold (weight >= 10), don't reset on mouseout
        const currentWeight = polyline.options.weight
        if (currentWeight && currentWeight < 10) {
          polyline.setStyle({ weight: 4, opacity: 0.8 })
        }
      })

      // Build popup HTML — chart container starts hidden, toggled by checkbox
      const iriForSelectedYear = viewMode === 'iri-range' && selectedYear
        ? segment.iriData?.find(data => data.year === selectedYear)?.iri
        : null

      const hasIriData = segment.iriData && segment.iriData.length > 0

      const popupContent = `
        <div style="font-family: system-ui, sans-serif; min-width: 210px;">
          <div style="font-weight: 600; font-size: 13px; color: #1e293b; margin-bottom: 2px;">${segment.route_name}</div>
          <div style="font-size: 11px; color: #64748b; line-height: 1.6;">
            Seg&nbsp;${segment.segment_id}&nbsp;&nbsp;·&nbsp;&nbsp;${segment.surftype || 'N/A'}&nbsp;&nbsp;·&nbsp;&nbsp;${(segment.length || 0).toFixed(0)}&nbsp;ft
            ${viewMode === 'iri-range' && selectedYear && iriForSelectedYear != null
              ? `<br/>IRI&nbsp;(${selectedYear}):&nbsp;<strong>${iriForSelectedYear.toFixed(1)}</strong>`
              : ''}
          </div>
          <div style="margin-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            ${hasIriData ? `
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:#374151;user-select:none;">
                <input type="checkbox" id="plot-toggle-${index}" style="cursor:pointer;accent-color:#3B82F6;width:13px;height:13px;" />
                IRI Plot
              </label>
            ` : '<span></span>'}
            <button id="street-view-${index}"
              style="background:#F59E0B;color:white;border:none;padding:3px 9px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:500;">
              🛣️ Street View
            </button>
          </div>
          ${hasIriData ? `<div id="iri-chart-${index}" style="display:none;margin-top:6px;border-top:1px solid #e2e8f0;padding-top:6px;"></div>` : ''}
        </div>
      `

      const popup = L.popup({ maxWidth: 290 }).setContent(popupContent)
      polyline.bindPopup(popup)

      // Per-popup chart root (scoped to this polyline's closure)
      const chartState: { root: ReactDOMRoot | null; cleanup: (() => void) | null } = { root: null, cleanup: null }

      polyline.on('popupopen', (e: L.LeafletEvent) => {
        const popupInstance = (e as any).popup as L.Popup
        setHoveredSegment(segment)

        // IRI plot toggle
        if (hasIriData) {
          const checkbox = document.getElementById(`plot-toggle-${index}`) as HTMLInputElement | null
          const chartContainer = document.getElementById(`iri-chart-${index}`) as HTMLDivElement | null

          if (checkbox && chartContainer) {
            const handleToggle = () => {
              if (checkbox.checked) {
                chartContainer.style.display = 'block'
                if (!chartState.root) {
                  chartState.root = createRoot(chartContainer)
                }
                chartState.root.render(
                  <IRIBarChart
                    compact
                    segmentData={{
                      route_name: segment.route_name,
                      segment_id: segment.segment_id,
                      iriData: segment.iriData || [],
                      liriData: segment.liriData,
                      ririData: segment.ririData,
                    }}
                  />
                )
                setTimeout(() => popupInstance?.update?.(), 60)
              } else {
                chartContainer.style.display = 'none'
                popupInstance?.update?.()
              }
            }
            checkbox.addEventListener('change', handleToggle)
            chartState.cleanup = () => checkbox.removeEventListener('change', handleToggle)
          }
        }

        // Street View
        const svBtn = document.getElementById(`street-view-${index}`)
        if (svBtn) {
          svBtn.addEventListener('click', () => {
            const lat = (segment.from_lat + segment.to_lat) / 2
            const lon = (segment.from_lon + segment.to_lon) / 2
            const dLon = (segment.to_lon - segment.from_lon) * Math.PI / 180
            const sy = Math.sin(dLon) * Math.cos(segment.to_lat * Math.PI / 180)
            const sx = Math.cos(segment.from_lat * Math.PI / 180) * Math.sin(segment.to_lat * Math.PI / 180) -
                      Math.sin(segment.from_lat * Math.PI / 180) * Math.cos(segment.to_lat * Math.PI / 180) * Math.cos(dLon)
            const heading = ((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360
            window.open(
              `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}&heading=${Math.round(heading)}&pitch=0&fov=90`,
              '_blank'
            )
          })
        }
      })

      polyline.on('popupclose', () => {
        setHoveredSegment(null)
        chartState.cleanup?.()
        chartState.cleanup = null
        chartState.root?.unmount()
        chartState.root = null
      })

      newLayers.push(polyline)
    })

    segmentLayersRef.current = newLayers

    // Fit map to show all selected segments
    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords)
      mapRef.current.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [selectedSegments, viewMode, selectedYear])

  // Reapply bold styling after segment layers are rebuilt
  useEffect(() => {
    if (!hoveredSegment || !mapRef.current || segmentLayersRef.current.length === 0) return

    // Remove existing white outline
    if (whiteOutlineRef.current && mapRef.current.hasLayer(whiteOutlineRef.current)) {
      mapRef.current.removeLayer(whiteOutlineRef.current)
      whiteOutlineRef.current = null
    }

    segmentLayersRef.current.forEach(polyline => {
      if (!polyline || !mapRef.current?.hasLayer(polyline)) return
      const segmentData = (polyline as any)._segmentData as MapSegment | undefined
      if (segmentData &&
          segmentData.route_name === hoveredSegment.route_name &&
          segmentData.segment_id === hoveredSegment.segment_id) {
        const coords: L.LatLngExpression[] = [
          [segmentData.from_lat, segmentData.from_lon],
          [segmentData.to_lat, segmentData.to_lon]
        ]
        const whiteOutline = L.polyline(coords, {
          color: '#FFFFFF',
          weight: 16,
          opacity: 1,
        }).addTo(mapRef.current!)
        polyline.bringToFront()
        whiteOutlineRef.current = whiteOutline
        polyline.setStyle({ weight: 12, opacity: 1 })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegments])

  // Update segment thickness when plot is shown/closed
  useEffect(() => {
    if (!mapRef.current || segmentLayersRef.current.length === 0) return

    try {
      // Remove existing white outline if any
      if (whiteOutlineRef.current && mapRef.current.hasLayer(whiteOutlineRef.current)) {
        mapRef.current.removeLayer(whiteOutlineRef.current)
        whiteOutlineRef.current = null
      }

      // Iterate through all polylines and update their styling based on whether they're showing IRI
      segmentLayersRef.current.forEach(polyline => {
        if (!polyline || !mapRef.current?.hasLayer(polyline)) return

        const segmentData = (polyline as any)._segmentData as MapSegment | undefined

        // If this is the segment showing IRI plot, make it bold
        // Must match BOTH route_name AND segment_id for unique identification
        if (hoveredSegment && segmentData &&
            segmentData.route_name === hoveredSegment.route_name &&
            segmentData.segment_id === hoveredSegment.segment_id) {

          // Create white outline underneath the colored line
          const coords: L.LatLngExpression[] = [
            [segmentData.from_lat, segmentData.from_lon],
            [segmentData.to_lat, segmentData.to_lon]
          ]

          const whiteOutline = L.polyline(coords, {
            color: '#FFFFFF',
            weight: 16, // Slightly larger than the colored line (12)
            opacity: 1,
            className: 'white-segment-outline'
          })

          // Add white outline first (underneath)
          whiteOutline.addTo(mapRef.current!)
          // Then bring the colored polyline to front
          polyline.bringToFront()

          whiteOutlineRef.current = whiteOutline

          // Make the line much bolder when showing IRI plot
          polyline.setStyle({ weight: 12, opacity: 1 })
        } else {
          // Reset to default thickness
          polyline.setStyle({ weight: 4, opacity: 0.8 })
        }
      })
    } catch (error) {
      console.warn('Error updating segment thickness:', error)
    }
  }, [hoveredSegment])

  return (
    <div className="relative h-full">
      <div ref={mapContainerRef} className="h-full w-full rounded-lg" />

      {/* Zoom toggle button */}
      <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-2">
        <button
          onClick={() => setZoomEnabled(!zoomEnabled)}
          className={`p-2 rounded shadow-lg transition-colors ${
            zoomEnabled
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-400 text-white hover:bg-gray-500'
          }`}
          title={zoomEnabled ? 'Disable zoom' : 'Enable zoom'}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {zoomEnabled ? (
              // Zoom enabled icon (magnifying glass with plus)
              <>
                <circle cx="11" cy="11" r="8" strokeWidth="2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M11 8v6m-3-3h6" />
              </>
            ) : (
              // Zoom disabled icon (magnifying glass with slash)
              <>
                <circle cx="11" cy="11" r="8" strokeWidth="2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M6 6l10 10" />
              </>
            )}
          </svg>
        </button>

        {/* View mode toggle button */}
        <button
          onClick={() => setViewMode(viewMode === 'segmentation' ? 'iri-range' : 'segmentation')}
          className={`p-2 rounded shadow-lg transition-colors ${
            viewMode === 'iri-range'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
          title={viewMode === 'segmentation' ? 'Switch to IRI Range View' : 'Switch to Segmentation View'}
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {viewMode === 'segmentation' ? (
              // Segmentation icon (layers/palette)
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </>
            ) : (
              // IRI Range icon (gauge/speedometer)
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </>
            )}
          </svg>
        </button>

        {/* Basemap switcher - vertical */}
        <div className="bg-white rounded shadow-lg overflow-hidden flex flex-col text-xs">
          {([
            ['default', 'Map'],
            ['satellite', 'Sat'],
            ['topo', 'Topo'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setBasemap(key)}
              className={`px-2.5 py-1.5 transition-colors border-b last:border-b-0 border-gray-200 ${
                basemap === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Segment counter */}
      {selectedSegments.length > 0 && (
        <div className="absolute top-14 right-2 bg-blue-600 text-white px-3 py-2 rounded shadow-lg z-[1000] text-sm">
          <p className="font-semibold">
            {selectedSegments.length} segment{selectedSegments.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}

      {/* Legend - only show in IRI Range View */}
      {selectedSegments.length > 0 && viewMode === 'iri-range' && (
        <div className="absolute top-2 left-16 bg-white px-4 py-3 rounded shadow-lg z-[1000] text-sm max-w-[200px]">
          <p className="font-bold mb-2 text-gray-800">IRI RANGE VIEW</p>

          {/* Year selector for IRI Range View */}
          <div className="mb-3">
            <label className="block text-xs text-gray-600 mb-1">Year:</label>
            <select
              value={selectedYear || ''}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {getAvailableYears(selectedSegments).map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {/* Legend items */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#00E5FF' }} />
              <span className="text-xs text-gray-700">Very Good (&lt; 60)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#76FF03' }} />
              <span className="text-xs text-gray-700">Good (60-95)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#FFEA00' }} />
              <span className="text-xs text-gray-700">Fair (95-170)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#FF6D00' }} />
              <span className="text-xs text-gray-700">Poor (170-220)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: '#FF1744' }} />
              <span className="text-xs text-gray-700">Very Poor (≥ 220)</span>
            </div>
          </div>
        </div>
      )}


      {/* Empty state message */}
      {selectedSegments.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-white bg-opacity-90 px-6 py-4 rounded-lg shadow-lg">
            <p className="text-gray-600 text-center">
              Select rows from the table to view segments on the map
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
