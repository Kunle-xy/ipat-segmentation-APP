"use client";
import React, { useState, useCallback, useEffect, useRef, memo } from "react";
import { Upload, RefreshCw, CloudCog, ArrowDownUp, ChevronDown, ChevronUp, FolderOpen, Play, Edit2, X, Table, EyeOff, Trash2 } from "lucide-react";
import FileUpload from "./FileUpload";

interface LeftWidgetProps {
  countyName: string;
  setCountyName: (name: string) => void;
  segmentationType: 'fixed' | 'distance';
  setSegmentationType: (type: 'fixed' | 'distance') => void;
  numSegments: number;
  setNumSegments: (num: number) => void;
  segmentDistance: number;
  setSegmentDistance: (dist: number) => void;
  selectedYears: string[];
  setSelectedYears: (years: string[]) => void;
  availableYears: string[];
  countyTables: any[];
  processedYears: string[];
  isEditMode: boolean;
  setIsEditMode: (mode: boolean) => void;
  loading: boolean;
  isUploading: boolean;
  uploadProgress: { current: number; total: number; currentFile: string };
  uploadedFiles: any[];
  handleUploadAll: (files: File[]) => Promise<void>;
  handleProcess: () => void;
  handleLoadCountyData: (county: string) => Promise<void>;
  fetchCounties: () => void;
  availableCounties: string[];
  showCountyDropdown: boolean;
  setShowCountyDropdown: (show: boolean) => void;
  loadingCounties: boolean;
  toggleYearSelection: (year: string) => void;
  processStatus: any;
  showTable: boolean;
  setShowTable: (show: boolean) => void;
  setTableHeight: (height: number) => void;
  hasResults: boolean;
  handleDeleteCounty: (county: string) => Promise<void>;
}

function LeftWidget({
  countyName,
  setCountyName,
  segmentationType,
  setSegmentationType,
  numSegments,
  setNumSegments,
  segmentDistance,
  setSegmentDistance,
  selectedYears,
  setSelectedYears,
  availableYears,
  countyTables,
  processedYears,
  isEditMode,
  setIsEditMode,
  loading,
  isUploading,
  uploadProgress,
  uploadedFiles,
  handleUploadAll,
  handleProcess,
  handleLoadCountyData,
  fetchCounties,
  availableCounties,
  showCountyDropdown,
  setShowCountyDropdown,
  loadingCounties,
  toggleYearSelection,
  processStatus,
  showTable,
  setShowTable,
  setTableHeight,
  hasResults,
  handleDeleteCounty,
}: LeftWidgetProps) {
  const [open, setOpen] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState(320); // Default: ~20rem
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(320);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCountyDropdown(false);
      }
    };

    if (showCountyDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCountyDropdown, setShowCountyDropdown]);

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    setIsResizing(true);
    setResizeStartX(e.clientX);
    setResizeStartWidth(width);
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = e.clientX - resizeStartX;
    const newWidth = resizeStartWidth + deltaX;
    const constrainedWidth = Math.max(280, Math.min(600, newWidth));
    setWidth(constrainedWidth);
  }, [isResizing, resizeStartX, resizeStartWidth]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const successfulUploads = uploadedFiles.filter(f => f.status === 'success').length;
  const countyHasTables = countyTables.length > 0;

  return (
    <aside
      style={{
        width: open ? `${width}px` : '64px',
        minWidth: open ? '200px' : '64px',
        maxWidth: open ? 'min(40vw, 500px)' : '64px',
        transition: isResizing ? 'none' : 'width 300ms ease-in-out'
      }}
      className={`
        relative h-full p-4 text-slate-100
        bg-gradient-to-b from-slate-900 to-slate-800
        ring-1 ring-inset ring-slate-700/50
        flex flex-col flex-shrink-0 z-[100] overflow-hidden
        ${isResizing ? 'select-none' : ''}
      `}
      aria-label="Controls widget"
    >
      {/* === RESIZE HANDLE === */}
      {open && (
        <div
          onMouseDown={handleResizeStart}
          style={{ pointerEvents: 'auto' }}
          className="absolute top-0 right-0 bottom-0 w-4 cursor-ew-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors group z-[9999]"
          title="Drag to resize sidebar"
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-slate-600 group-hover:bg-blue-400 rounded-full transition-colors" />
        </div>
      )}

      {/* === HEADER === */}
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold shrink-0">
          <Upload className="h-5 w-5" />
        </div>
        <div
          className={`transition-all duration-200 overflow-hidden flex-1 ${
            open ? "opacity-100 w-auto" : "opacity-0 w-0"
          }`}
        >
          <div className="text-sm font-semibold">Segmentation Analysis</div>
          <div className="text-xs text-slate-300">Upload Data and Segment Roadway</div>
        </div>
        {open && (
          <button
            onClick={() => window.location.reload()}
            title="Reload page"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-700 transition-colors shrink-0"
          >
            <RefreshCw className="h-4 w-4 text-slate-300" />
          </button>
        )}
      </div>

      {/* === MAIN CONTENT === */}
      <div
        className={`flex-1 space-y-4 transition-opacity duration-200 overflow-y-auto overflow-x-hidden min-h-0 min-w-0 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* County Selection Section */}
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-2">
            <FolderOpen className="h-3 w-3" />
            <span>County Selection</span>
          </div>

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={fetchCounties}
              disabled={loadingCounties}
              className="w-full flex items-center gap-2 bg-green-600/20 hover:bg-green-600/30 text-green-300 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
              title="Load existing county data"
            >
              {loadingCounties ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <CloudCog className="h-4 w-4" />
              )}
              <span className="text-sm">Load Existing Data</span>
            </button>

            {showCountyDropdown && availableCounties.length > 0 && (
              <div className="absolute left-0 mt-2 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-10 max-h-72 overflow-y-auto">
                <div className="p-2 border-b border-slate-600 bg-slate-700 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-300">Saved Data ({availableCounties.length}/5)</p>
                  {availableCounties.length >= 5 && (
                    <span className="text-[10px] text-amber-400">Limit reached</span>
                  )}
                </div>
                {availableCounties.map((county) => (
                  <div
                    key={county}
                    className="flex items-center justify-between px-3 py-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 transition-colors group"
                  >
                    <button
                      onClick={() => handleLoadCountyData(county)}
                      className="flex-1 text-left"
                    >
                      <span className="text-sm text-slate-200 capitalize">
                        {county.replace(/_/g, ' ')}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(county);
                        setDeleteConfirmText('');
                      }}
                      className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all"
                      title={`Delete ${county} data`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100000]">
                <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-5 max-w-sm w-full mx-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-900/50">
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100">Delete County Data</h3>
                  </div>

                  <p className="text-xs text-slate-300 mb-1">
                    This will permanently delete all segmentation data for
                    <span className="font-semibold text-white capitalize"> {deleteTarget.replace(/_/g, ' ')}</span> from the cloud.
                  </p>
                  <p className="text-xs text-slate-400 mb-4">
                    This action cannot be undone.
                  </p>

                  <label className="block text-xs text-slate-400 mb-1.5">
                    Type <span className="font-mono text-red-400">I confirm</span> to proceed:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="I confirm"
                    className="w-full bg-slate-900 text-sm px-3 py-2 rounded border border-slate-600 focus:outline-none focus:border-red-500 text-slate-200 mb-4"
                    autoFocus
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setDeleteTarget(null);
                        setDeleteConfirmText('');
                      }}
                      className="flex-1 px-3 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setIsDeleting(true);
                        await handleDeleteCounty(deleteTarget);
                        setIsDeleting(false);
                        setDeleteTarget(null);
                        setDeleteConfirmText('');
                      }}
                      disabled={deleteConfirmText !== 'I confirm' || isDeleting}
                      className="flex-1 px-3 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      {isDeleting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Deleting...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              County Name *
            </label>
            <input
              type="text"
              value={countyName}
              onChange={(e) => setCountyName(e.target.value)}
              placeholder="e.g., Polk, Linn, Scott"
              disabled={loading}
              className="w-full bg-slate-800 text-sm px-3 py-2 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Upload Section */}
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-2">
            <Upload className="h-3 w-3" />
            <span>File Upload</span>
          </div>

          {/* Upload Progress Bar */}
          {isUploading && uploadProgress.total > 0 && (
            <div className="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-300">
                  {uploadProgress.current} of {uploadProgress.total} files
                </span>
                <span className="text-xs text-blue-400">
                  {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-blue-900 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                ></div>
              </div>
              <p className="text-xs text-blue-400 truncate">
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
            <div className="p-3 bg-green-900/20 border border-green-700 rounded-lg">
              <p className="text-xs font-semibold text-green-300">
                ✓ {successfulUploads} files uploaded
              </p>
            </div>
          )}
        </div>

        {/* Year Selection */}
        {countyTables.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center justify-between">
              <span>Available Years</span>
              {processedYears.length > 0 && !isEditMode && (
                <button
                  onClick={() => setIsEditMode(true)}
                  className="flex items-center gap-1 text-xs bg-orange-600/20 text-orange-300 px-2 py-1 rounded hover:bg-orange-600/30 transition-colors"
                >
                  <Edit2 className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {countyTables
                .filter((table: any) => table.table_name.startsWith('raw_distress_'))
                .map((table: any) => {
                  const year = table.table_name.replace('raw_distress_', '');
                  const isSelected = selectedYears.includes(year);
                  const isProcessed = processedYears.includes(year);
                  const isDisabled = processedYears.length > 0 && !isEditMode && !isProcessed;

                  return (
                    <label
                      key={table.table_name}
                      className={`px-2 py-2 rounded border-2 transition-all text-xs ${
                        isDisabled
                          ? 'cursor-not-allowed bg-slate-800 border-slate-700 opacity-50'
                          : 'cursor-pointer bg-slate-800 ' + (
                            isSelected
                              ? 'border-blue-500 bg-blue-900/30'
                              : 'border-slate-600 hover:border-slate-500'
                          )
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={() => toggleYearSelection(year)}
                          className="w-3 h-3 text-blue-600 border-slate-500 rounded focus:ring-blue-500"
                        />
                        <span className={`font-medium ${isDisabled ? 'text-slate-600' : 'text-slate-300'}`}>
                          {year}
                        </span>
                      </div>
                    </label>
                  );
                })}
            </div>

            {selectedYears.length < 2 && (
              <p className="text-xs text-red-400">
                ⚠️ Select at least 2 years
              </p>
            )}
          </div>
        )}

        {/* Segmentation Settings */}
        {(successfulUploads >= 2 || countyHasTables) && (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-2">
              <ArrowDownUp className="h-3 w-3" />
              <span>Segmentation Method</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Type
              </label>
              <select
                value={segmentationType}
                onChange={(e) => setSegmentationType(e.target.value as 'fixed' | 'distance')}
                disabled={loading}
                className="w-full bg-slate-800 text-sm px-3 py-2 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="fixed">Fixed Number of Segments</option>
                <option value="distance">Uniform Distance (Miles)</option>
              </select>
            </div>

            {segmentationType === 'fixed' ? (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Number of Segments (10-100)
                </label>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={numSegments}
                  onChange={(e) => setNumSegments(parseInt(e.target.value) || 20)}
                  disabled={loading}
                  className="w-full bg-slate-800 text-sm px-3 py-2 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Each route divided into equal segments
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Segment Distance (Miles)
                </label>
                <input
                  type="number"
                  min="0.01"
                  max="10"
                  step="0.01"
                  value={segmentDistance}
                  onChange={(e) => setSegmentDistance(parseFloat(e.target.value) || 0.1)}
                  disabled={loading}
                  className="w-full bg-slate-800 text-sm px-3 py-2 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Each segment is {segmentDistance} mile{segmentDistance !== 1 ? 's' : ''} long
                </p>
              </div>
            )}

            {/* Process Status */}
            {processStatus && (
              <div className="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
                <p className="text-xs font-semibold text-blue-300 mb-2">
                  Last Processing
                </p>
                <div className="space-y-1 text-xs text-slate-300">
                  <p>Type: {processStatus.segmentation_type === 'fixed' ? 'Fixed' : 'Distance'}</p>
                  {processStatus.segmentation_type === 'fixed' ? (
                    <p>Segments: {processStatus.num_segments}</p>
                  ) : (
                    <p>Distance: {processStatus.segment_distance} mi</p>
                  )}
                  <p>Routes: {processStatus.statistics?.unique_routes}</p>
                  <p>Total Segments: {processStatus.statistics?.total_rows}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* === PROCESS BUTTON (BOTTOM) === */}
      <div className="pt-4 border-t border-slate-700 shrink-0 space-y-2">
        {isEditMode && processedYears.length > 0 && (
          <button
            onClick={() => {
              setIsEditMode(false);
              setSelectedYears([...processedYears]);
            }}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            <span className="text-sm">Cancel Edit</span>
          </button>
        )}

        <button
          onClick={handleProcess}
          disabled={loading || !countyName.trim() || selectedYears.length < 2}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-semibold transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed shadow-lg"
          title={selectedYears.length < 2 ? 'Please select at least 2 years' : ''}
        >
          {loading ? (
            <>
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Play className="h-5 w-5" />
              <span>{isEditMode && processedYears.length > 0 ? 'Reprocess' : 'Run Segmentation'}</span>
            </>
          )}
        </button>

        {/* Show/Hide Table Button */}
        {hasResults && (
          <button
            onClick={() => {
              if (showTable) {
                setShowTable(false);
                setTableHeight(50);
              } else {
                setShowTable(true);
              }
            }}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
              showTable
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {showTable ? (
              <>
                <EyeOff className="h-4 w-4" />
                <span>Hide Table</span>
              </>
            ) : (
              <>
                <Table className="h-4 w-4" />
                <span>Show Table</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* === TOGGLE BUTTON === */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`
          absolute -right-3 top-1/2 z-10
          flex h-9 w-9 items-center justify-center
          rounded-full bg-slate-700/90 hover:bg-slate-600/90
          ring-1 ring-slate-600/60 transition-all
          shadow-lg
        `}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        <svg
          className={`h-5 w-5 text-slate-300 transition-transform duration-200 ${
            open ? "" : "rotate-180"
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.08 10l3.71 3.71a.75.75 0 1 1-1.06 1.06l-4.24-4.24a.75.75 0 0 1 0-1.06l4.24-4.24a.75.75 0 0 1 1.06 0z" />
        </svg>
      </button>
    </aside>
  );
}

export default memo(LeftWidget);
