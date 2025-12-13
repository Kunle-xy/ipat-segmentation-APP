'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface IRIBarChartProps {
  segmentData: {
    route_name: string
    segment_id: number
    iriData: { year: string; iri: number }[]
  }
}

export default function IRIBarChart({ segmentData }: IRIBarChartProps) {
  // Format IRI values to avoid scientific notation and fit on bars
  const formatIRI = (value: any) => {
    const num = Number(value)
    if (num >= 100) {
      return num.toFixed(0) // No decimals for large numbers
    } else if (num >= 10) {
      return num.toFixed(1) // 1 decimal for medium numbers
    } else {
      return num.toFixed(2) // 2 decimals for small numbers
    }
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow-lg">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">
        {segmentData.route_name} - Segment {segmentData.segment_id}
      </h3>
      <p className="text-xs text-gray-600 mb-3">IRI Values by Year</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={segmentData.iriData}
          margin={{ top: 20, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12 }}
            label={{ value: 'Year', position: 'insideBottom', offset: -5, fontSize: 12 }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{ value: 'IRI', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value: any) => [formatIRI(value), 'IRI']}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="iri"
            fill="#3B82F6"
            name="IRI Value"
            label={{
              position: 'top',
              fontSize: 9,
              formatter: formatIRI
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-500 mt-2 text-center">
        Higher IRI = Worse road condition
      </p>
    </div>
  )
}
