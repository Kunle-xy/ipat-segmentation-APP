'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

interface IRIBarChartProps {
  segmentData: {
    route_name: string
    segment_id: number
    iriData: { year: string; iri: number }[]
    liriData?: { year: string; liri: number | null }[]
    ririData?: { year: string; riri: number | null }[]
  }
  compact?: boolean
}

export default function IRIBarChart({ segmentData, compact = false }: IRIBarChartProps) {
  const fmt = (v: any) => {
    const n = Number(v)
    if (isNaN(n)) return ''
    return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
  }

  const hasLiri = segmentData.liriData?.some(d => d.liri !== null && d.liri !== undefined)
  const hasRiri = segmentData.ririData?.some(d => d.riri !== null && d.riri !== undefined)

  const chartData = segmentData.iriData.map(d => ({
    year: d.year,
    'Avg IRI': d.iri,
    ...(hasLiri ? { 'LIRI': segmentData.liriData?.find(l => l.year === d.year)?.liri ?? null } : {}),
    ...(hasRiri ? { 'RIRI': segmentData.ririData?.find(r => r.year === d.year)?.riri ?? null } : {}),
  }))

  if (compact) {
    return (
      <div style={{ width: 252 }}>
        <BarChart
          width={252}
          height={140}
          data={chartData}
          margin={{ top: 12, right: 4, left: -10, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={28} />
          <Tooltip
            contentStyle={{ fontSize: 10 }}
            formatter={(value: any, name: string) => [value !== null ? fmt(value) : 'N/A', name]}
          />
          <Legend wrapperStyle={{ fontSize: 9 }} iconSize={8} />
          {hasLiri && (
            <Bar dataKey="LIRI" fill="#10B981" name="LIRI" isAnimationActive={false} label={{ position: 'top', fontSize: 7, formatter: fmt }} />
          )}
          <Bar dataKey="Avg IRI" fill="#3B82F6" name="Avg IRI" isAnimationActive={false} label={{ position: 'top', fontSize: 7, formatter: fmt }} />
          {hasRiri && (
            <Bar dataKey="RIRI" fill="#F59E0B" name="RIRI" isAnimationActive={false} label={{ position: 'top', fontSize: 7, formatter: fmt }} />
          )}
        </BarChart>
      </div>
    )
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow-lg" style={{ width: 360 }}>
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
        {segmentData.route_name} — Seg {segmentData.segment_id}
      </h3>
      <p className="text-xs text-gray-500 mb-3">IRI by year (in/mi)</p>
      <BarChart
        width={328}
        height={200}
        data={chartData}
        margin={{ top: 16, right: 8, left: 0, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="year" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={32} />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={(value: any, name: string) => [value !== null ? fmt(value) : 'N/A', name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {hasLiri && (
          <Bar dataKey="LIRI" fill="#10B981" name="LIRI" isAnimationActive={false} label={{ position: 'top', fontSize: 8, formatter: fmt }} />
        )}
        <Bar dataKey="Avg IRI" fill="#3B82F6" name="Avg IRI" isAnimationActive={false} label={{ position: 'top', fontSize: 8, formatter: fmt }} />
        {hasRiri && (
          <Bar dataKey="RIRI" fill="#F59E0B" name="RIRI" isAnimationActive={false} label={{ position: 'top', fontSize: 8, formatter: fmt }} />
        )}
      </BarChart>
      <p className="text-xs text-gray-400 mt-1 text-center">Higher IRI = worse condition</p>
    </div>
  )
}
