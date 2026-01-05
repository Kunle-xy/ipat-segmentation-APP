'use client'

import { useEffect, useRef, useState } from 'react'
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

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
      minZoom: 1
    }).addTo(map)

    mapRef.current = map

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

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

      // Color code by index for visibility
      const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']
      const color = colors[index % colors.length]

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

      // Add popup with segment info and Show Plot button
      const popupContent = `
        <div class="text-sm" style="min-width: 200px;">
          <strong>${segment.route_name}</strong><br/>
          Segment: ${segment.segment_id}<br/>
          Surface: ${segment.surftype || 'N/A'}<br/>
          Length: ${(segment.length || 0).toFixed(2)} ft
          ${segment.iriData && segment.iriData.length > 0 ? `
            <div style="margin-top: 8px;">
              <button
                id="show-plot-${index}"
                style="background-color: #3B82F6; color: white; padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; width: 100%; font-weight: 500;"
                onmouseover="this.style.backgroundColor='#2563EB'"
                onmouseout="this.style.backgroundColor='#3B82F6'"
              >
                📊 Show IRI Plot
              </button>
            </div>
          ` : ''}
        </div>
      `

      const popup = L.popup().setContent(popupContent)
      polyline.bindPopup(popup)

      // Add click handler for the Show Plot button after popup opens
      polyline.on('popupopen', () => {
        const button = document.getElementById(`show-plot-${index}`)
        if (button) {
          button.addEventListener('click', () => {
            setHoveredSegment(segment)
            polyline.closePopup()
          })
        }
      })

      newLayers.push(polyline)
    })

    segmentLayersRef.current = newLayers

    // Fit map to show all selected segments
    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords)
      mapRef.current.fitBounds(bounds, { padding: [50, 50] })
    }
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
      <div className="absolute top-2 left-2 z-[1000]">
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
      </div>

      {/* Segment counter */}
      {selectedSegments.length > 0 && (
        <div className="absolute top-14 right-2 bg-blue-600 text-white px-3 py-2 rounded shadow-lg z-[1000] text-sm">
          <p className="font-semibold">
            {selectedSegments.length} segment{selectedSegments.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      )}

      {/* IRI Bar Chart - shows on click */}
      {hoveredSegment && hoveredSegment.iriData && hoveredSegment.iriData.length > 0 && (
        <div className="absolute bottom-4 left-4 z-[1000] max-w-md">
          <div className="relative">
            <button
              onClick={() => setHoveredSegment(null)}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold hover:bg-red-600 shadow-lg z-10"
              title="Close"
            >
              ×
            </button>
            <IRIBarChart
              segmentData={{
                route_name: hoveredSegment.route_name,
                segment_id: hoveredSegment.segment_id,
                iriData: hoveredSegment.iriData
              }}
            />
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
