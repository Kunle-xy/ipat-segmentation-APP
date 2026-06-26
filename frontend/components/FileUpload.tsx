'use client'

import { useState, useRef } from 'react'

const REQUIRED_COLUMNS = [
  { name: 'ROUTE_ID', description: 'Unique route identifier (numeric)' },
  { name: 'ROUTE_NAME', description: 'Road identifier (e.g., S001, I035)' },
  { name: 'FROM_MEASURE', description: 'Start milepost of the section' },
  { name: 'TO_MEASURE', description: 'End milepost of the section' },
  { name: 'BEGIN_GLAT', description: 'Start latitude (decimal degrees)' },
  { name: 'BEGIN_GLON', description: 'Start longitude (decimal degrees)' },
  { name: 'END_GLAT', description: 'End latitude (decimal degrees)' },
  { name: 'END_GLON', description: 'End longitude (decimal degrees)' },
  { name: 'IRI', description: 'International Roughness Index value' },
  { name: 'COUNTY_ID', description: 'County identifier number' },
  { name: 'SURFTYPE', description: 'Surface type (e.g., AC, PCC)' },
]

interface FileUploadProps {
  onUploadAll: (files: File[]) => Promise<void>
  disabled?: boolean
  uploadedFiles: { filename: string; status: 'pending' | 'uploading' | 'success' | 'error'; message?: string }[]
  isUploading?: boolean
}

export default function FileUpload({ onUploadAll, disabled, uploadedFiles, isUploading }: FileUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [showGuide, setShowGuide] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Parse CSV header to check columns
  const parseCSVHeader = (text: string): string[] => {
    const firstLine = text.split(/\r?\n/)[0]
    return firstLine.split(',').map(col => col.trim().replace(/^["']|["']$/g, ''))
  }

  // Validate file columns client-side
  const validateFileColumns = async (file: File): Promise<string[]> => {
    const name = file.name.toLowerCase()

    if (name.endsWith('.csv')) {
      const text = await file.text()
      const headers = parseCSVHeader(text)
      const missing = REQUIRED_COLUMNS
        .map(c => c.name)
        .filter(col => !headers.some(h => h.toUpperCase() === col))
      return missing
    }

    // For Excel files, we can't easily parse client-side without a library
    // The backend will validate — return empty (no missing)
    return []
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      setValidationError(null)

      // Validate CSV files client-side
      for (const file of newFiles) {
        if (file.name.toLowerCase().endsWith('.csv')) {
          const missing = await validateFileColumns(file)
          if (missing.length > 0) {
            setValidationError(
              `"${file.name}" is missing required columns: ${missing.join(', ')}`
            )
            setShowGuide(true)
            if (fileInputRef.current) fileInputRef.current.value = ''
            return
          }
        }
      }

      setSelectedFiles(prev => {
        const existingNames = prev.map(f => f.name)
        const filesToAdd = newFiles.filter(f => !existingNames.includes(f.name))
        return [...prev, ...filesToAdd]
      })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    setValidationError(null)
  }

  const handleUploadAll = async () => {
    if (selectedFiles.length > 0) {
      setValidationError(null)
      await onUploadAll(selectedFiles)
      setSelectedFiles([])
    }
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  // Extract year from filename for display
  const getYear = (name: string) => {
    const digits = name.replace(/\.(xlsx|xls|csv)$/i, '').replace(/\D/g, '')
    return digits || '?'
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        disabled={disabled || isUploading}
        className="hidden"
        multiple
      />

      {/* Guide button + dropdown */}
      <button
        type="button"
        onClick={() => setShowGuide(!showGuide)}
        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
      >
        <span className="text-xs text-slate-300 flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          File Format Guide
        </span>
        <svg className={`h-3 w-3 text-slate-400 transition-transform ${showGuide ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showGuide && (
        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 space-y-2">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Required Columns</p>
          <div className="space-y-1">
            {REQUIRED_COLUMNS.map(col => (
              <div key={col.name} className="flex items-start gap-2">
                <code className="text-[10px] text-blue-300 font-mono bg-slate-900 px-1 py-0.5 rounded shrink-0">{col.name}</code>
                <span className="text-[10px] text-slate-400 leading-tight">{col.description}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-slate-700 space-y-1">
            <p className="text-[10px] text-slate-400">
              <span className="text-slate-300 font-medium">Formats:</span> .xlsx, .xls, .csv
            </p>
            <p className="text-[10px] text-slate-400">
              <span className="text-slate-300 font-medium">Filename:</span> Must contain the year (e.g., 2020.xlsx, distress_2021.csv)
            </p>
            <p className="text-[10px] text-slate-400">
              <span className="text-slate-300 font-medium">Minimum:</span> 2 files (years) required
            </p>
          </div>
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-2 flex items-start gap-2">
          <svg className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <p className="text-[10px] text-red-300">{validationError}</p>
            {!showGuide && (
              <button
                onClick={() => setShowGuide(true)}
                className="text-[10px] text-blue-400 hover:text-blue-300 underline mt-1"
              >
                View required columns
              </button>
            )}
          </div>
        </div>
      )}

      {/* Compact add button */}
      <button
        type="button"
        onClick={triggerFileSelect}
        disabled={disabled || isUploading}
        className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-slate-500 rounded-lg hover:border-blue-400 hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="h-4 w-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-xs text-slate-300">Add files (.xlsx, .csv)</span>
      </button>

      {/* Selected files - compact chips */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} ready</span>
            <button
              type="button"
              onClick={triggerFileSelect}
              disabled={disabled || isUploading}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:text-slate-500"
            >
              + Add more
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="group flex items-center gap-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs"
              >
                <span className="text-blue-300 font-mono font-medium">{getYear(file.name)}</span>
                <span className="text-slate-500 text-[10px]">{file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'}</span>
                <span className="text-slate-400 text-[10px]">{(file.size / 1024 / 1024).toFixed(1)}M</span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={isUploading}
                  className="text-slate-500 hover:text-red-400 disabled:text-slate-600 ml-0.5"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {selectedFiles.length < 2 && (
            <p className="text-[10px] text-amber-400">Need at least 2 files (years)</p>
          )}

          <button
            type="button"
            onClick={handleUploadAll}
            disabled={disabled || isUploading || selectedFiles.length < 2}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Upload All ({selectedFiles.length})</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Already uploaded files - compact list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-slate-700">
          <span className="text-xs text-slate-400">Uploaded ({uploadedFiles.length})</span>
          <div className="flex flex-wrap gap-1.5">
            {uploadedFiles.map((file, index) => (
              <div
                key={index}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  file.status === 'success' ? 'bg-green-900/30 border border-green-700/50' :
                  file.status === 'error' ? 'bg-red-900/30 border border-red-700/50' :
                  file.status === 'uploading' ? 'bg-blue-900/30 border border-blue-700/50' :
                  'bg-slate-700 border border-slate-600'
                }`}
              >
                {file.status === 'success' && (
                  <svg className="h-3 w-3 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {file.status === 'error' && (
                  <svg className="h-3 w-3 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {file.status === 'uploading' && (
                  <svg className="animate-spin h-3 w-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                <span className={`font-mono font-medium ${
                  file.status === 'success' ? 'text-green-300' :
                  file.status === 'error' ? 'text-red-300' :
                  'text-slate-300'
                }`}>
                  {getYear(file.filename)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
