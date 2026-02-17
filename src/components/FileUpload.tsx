'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react';
import { Platform, PLATFORM_LABELS } from '@/lib/types';
import { formatCurrency, cn } from '@/lib/utils';

interface FileUploadProps {
  platform: Platform;
  onResult: (result: {
    platform: Platform;
    gross_revenue: number;
    file: File;
    file_type: 'csv' | 'pdf';
    confidence: string;
    file_name: string;
  }) => void;
  onClear: () => void;
  result?: {
    gross_revenue: number;
    file_name: string;
    confidence: string;
  } | null;
}

export default function FileUpload({
  platform,
  onResult,
  onClear,
  result,
}: FileUploadProps) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('platform', platform);

      const response = await fetch('/api/parse-file', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to parse file');
        setParsing(false);
        return;
      }

      onResult({
        platform,
        gross_revenue: data.gross_revenue,
        file,
        file_type: data.file_type,
        confidence: data.confidence,
        file_name: file.name,
      });
    } catch {
      setError('Failed to parse file. Please try again.');
    }

    setParsing(false);
  };

  const handleClear = () => {
    setError('');
    onClear();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const platformColors: Record<Platform, string> = {
    deliveroo: 'border-teal-200 bg-teal-50',
    ubereats: 'border-green-200 bg-green-50',
    justeat: 'border-orange-200 bg-orange-50',
    slerp: 'border-violet-200 bg-violet-50',
  };

  const platformAccent: Record<Platform, string> = {
    deliveroo: 'text-teal-700',
    ubereats: 'text-green-700',
    justeat: 'text-orange-700',
    slerp: 'text-violet-700',
  };

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-5 transition-colors',
        result ? platformColors[platform] : 'border-slate-200 bg-white'
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className={cn('text-sm font-semibold', result ? platformAccent[platform] : 'text-slate-700')}>
          {PLATFORM_LABELS[platform]}
        </h3>
        {result && (
          <button
            onClick={handleClear}
            className="rounded p-1 text-slate-400 hover:bg-white/50 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="text-sm text-slate-600">{result.file_name}</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {formatCurrency(result.gross_revenue)}
          </div>
          {result.confidence !== 'high' && (
            <div className="flex items-center gap-1 text-xs text-amber-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {result.confidence === 'medium'
                ? 'Check this value - medium confidence'
                : 'Low confidence - please verify manually'}
            </div>
          )}
        </div>
      ) : (
        <div>
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf,.doc,.docx,.html,.htm"
            onChange={handleFileSelect}
            className="hidden"
            id={`file-${platform}`}
          />

          <label
            htmlFor={`file-${platform}`}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors',
              parsing
                ? 'border-slate-200 bg-slate-50'
                : 'border-slate-300 hover:border-primary hover:bg-orange-50/50'
            )}
          >
            {parsing ? (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs text-slate-500">Parsing file...</span>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-slate-100 p-2">
                  {platform === 'deliveroo' ? (
                    <FileText className="h-5 w-5 text-teal-600" />
                  ) : platform === 'ubereats' ? (
                    <FileText className="h-5 w-5 text-green-600" />
                  ) : (
                    <FileText className="h-5 w-5 text-orange-600" />
                  )}
                </div>
                <div className="text-center">
                  <span className="text-sm font-medium text-slate-700">
                    Upload file
                  </span>
                  <p className="mt-0.5 text-xs text-slate-400">
                    CSV, PDF, or DOC from {PLATFORM_LABELS[platform]}
                  </p>
                </div>
              </>
            )}
          </label>
        </div>
      )}
    </div>
  );
}
