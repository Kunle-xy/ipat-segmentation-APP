'use client'

import { useState, useRef } from 'react'

interface FileUploadProps {
  onUploadAll: (files: File[]) => Promise<void>
  disabled?: boolean
  uploadedFiles: { filename: string; status: 'pending' | 'uploading' | 'success' | 'error'; message?: string }[]
  isUploading?: boolean
}

export default function FileUpload({ onUploadAll, disabled, uploadedFiles, isUploading }: FileUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Add new files to existing selection (avoid duplicates by filename)
      const newFiles = Array.from(e.target.files)
      setSelectedFiles(prev => {
        const existingNames = prev.map(f => f.name)
        const filesToAdd = newFiles.filter(f => !existingNames.includes(f.name))
        return [...prev, ...filesToAdd]
      })
      // Reset input so same file can be selected again if removed
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleUploadAll = async () => {
    if (selectedFiles.length > 0) {
      await onUploadAll(selectedFiles)
      setSelectedFiles([])
    }
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Add Excel Files (must contain year in filename, e.g., 2020.xlsx, 2021.xlsx)
        </label>
        <p className="text-sm text-gray-500 mb-3">
          Click the + button to add files, then click "Upload All" when ready. You need at least 2 years of data.
        </p>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          disabled={disabled || isUploading}
          className="hidden"
        />
        
        <button
          type="button"
          onClick={triggerFileSelect}
          disabled={disabled || isUploading}
          className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors w-full justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-gray-700 font-medium">Add File</span>
        </button>
      </div>

      {/* Files waiting to be uploaded */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Files to Upload ({selectedFiles.length}):
          </p>
          <ul className="space-y-1">
            {selectedFiles.map((file, index) => (
              <li
                key={index}
                className="flex items-center justify-between bg-blue-50 border border-blue-200 px-3 py-2 rounded"
              >
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-blue-700">{file.name}</span>
                  <span className="text-xs text-blue-500">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={isUploading}
                  className="text-red-600 hover:text-red-800 text-sm disabled:text-gray-400 px-2 py-1 hover:bg-red-50 rounded"
                >
                  ✕ Remove
                </button>
              </li>
            ))}
          </ul>
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={triggerFileSelect}
              disabled={disabled || isUploading}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm px-3 py-2 border border-blue-300 rounded hover:bg-blue-50 disabled:text-gray-400 disabled:border-gray-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add More Files
            </button>
            
            <button
              type="button"
              onClick={handleUploadAll}
              disabled={disabled || isUploading || selectedFiles.length < 2}
              className="flex-1 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload All ({selectedFiles.length} files)
                </>
              )}
            </button>
          </div>
          
          {selectedFiles.length < 2 && (
            <p className="text-sm text-yellow-600">
              ⚠ You need at least 2 files (years) to upload
            </p>
          )}
        </div>
      )}

      {/* Already uploaded files */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2 mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm font-medium text-gray-700">
            Uploaded Files ({uploadedFiles.length}):
          </p>
          <ul className="space-y-1">
            {uploadedFiles.map((file, index) => (
              <li
                key={index}
                className={`flex items-center justify-between px-3 py-2 rounded ${
                  file.status === 'success' ? 'bg-green-50 border border-green-200' :
                  file.status === 'error' ? 'bg-red-50 border border-red-200' :
                  file.status === 'uploading' ? 'bg-blue-50 border border-blue-200' :
                  'bg-gray-50 border border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {file.status === 'success' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {file.status === 'error' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  {file.status === 'uploading' && (
                    <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  <span className={`text-sm ${
                    file.status === 'success' ? 'text-green-700' :
                    file.status === 'error' ? 'text-red-700' :
                    'text-gray-700'
                  }`}>
                    {file.filename}
                  </span>
                </div>
                {file.message && (
                  <span className={`text-xs ${
                    file.status === 'success' ? 'text-green-600' :
                    file.status === 'error' ? 'text-red-600' :
                    'text-gray-500'
                  }`}>
                    {file.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
