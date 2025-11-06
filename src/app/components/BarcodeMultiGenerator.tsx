'use client';

import { useState, useCallback } from 'react';
import { validateBarcodeInput, type Symbology } from '@/lib/barcode-utils';
import type { BarcodeItem, BarcodeSettings } from '@/types/barcode';
import JSZip from 'jszip';

const MAX_BARCODES = 50;

interface BarcodeMultiGeneratorProps {
  settings: BarcodeSettings;
}

export default function BarcodeMultiGenerator({ settings }: BarcodeMultiGeneratorProps) {
  const [barcodes, setBarcodes] = useState<BarcodeItem[]>([
    {
      id: '1',
      contents: '8809560223070',
      symbology: 'ean13',
      isSelected: false,
    },
  ]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const generateBarcode = useCallback(
    async (item: BarcodeItem): Promise<{ svgData?: string; error?: string; processedContents?: string }> => {
      const validation = validateBarcodeInput(item.contents, item.symbology);
      if (!validation.valid) {
        return { error: validation.message || '입력값이 올바르지 않습니다.' };
      }

      const finalContents = validation.processedContents || item.contents;

      try {
        const response = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: finalContents,
            symbology: item.symbology,
            quietZone: settings.quietZone,
            fontSize: settings.fontSize,
            offsetLeft: settings.offsetLeft,
            offsetMiddle: settings.offsetMiddle,
            offsetRight: settings.offsetRight,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: '바코드 생성에 실패했습니다.' }));
          return { error: errorData.error || '바코드 생성에 실패했습니다.' };
        }

        const svgText = await response.text();
        if (!svgText || svgText.trim().length === 0) {
          return { error: '서버로부터 빈 SVG를 받았습니다.' };
        }

        return { svgData: svgText, processedContents: finalContents };
      } catch (err) {
        return { error: err instanceof Error ? err.message : '바코드 생성에 실패했습니다.' };
      }
    },
    [settings]
  );

  const handleGenerateOne = async (id: string) => {
    const item = barcodes.find((b) => b.id === id);
    if (!item) return;

    setGenerating(id);
    const result = await generateBarcode(item);
    setBarcodes((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              svgData: result.svgData,
              error: result.error,
              processedContents: result.processedContents,
            }
          : b
      )
    );
    setGenerating(null);
  };

  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    const results = await Promise.all(
      barcodes.map(async (item) => {
        const result = await generateBarcode(item);
        return { id: item.id, ...result };
      })
    );

    setBarcodes((prev) =>
      prev.map((b) => {
        const result = results.find((r) => r.id === b.id);
        return {
          ...b,
          svgData: result?.svgData,
          error: result?.error,
          processedContents: result?.processedContents,
        };
      })
    );
    setGeneratingAll(false);
  };

  const handleAddBarcode = () => {
    if (barcodes.length >= MAX_BARCODES) {
      alert(`최대 ${MAX_BARCODES}개까지 생성할 수 있습니다.`);
      return;
    }
    const newId = Date.now().toString();
    setBarcodes([
      ...barcodes,
      {
        id: newId,
        contents: '',
        symbology: 'ean13',
        isSelected: false,
      },
    ]);
  };

  const handleDeleteBarcode = (id: string) => {
    if (barcodes.length <= 1) {
      alert('최소 1개의 바코드는 유지해야 합니다.');
      return;
    }
    setBarcodes(barcodes.filter((b) => b.id !== id));
  };

  const handleUpdateBarcode = (id: string, updates: Partial<BarcodeItem>) => {
    setBarcodes(barcodes.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  const handleToggleSelect = (id: string) => {
    setBarcodes(barcodes.map((b) => (b.id === id ? { ...b, isSelected: !b.isSelected } : b)));
  };

  const handleSelectAll = () => {
    const allSelected = barcodes.every((b) => b.isSelected && b.svgData);
    setBarcodes(barcodes.map((b) => ({ ...b, isSelected: b.svgData ? !allSelected : false })));
  };

  const handleDownloadSVG = async (item: BarcodeItem) => {
    if (!item.svgData) {
      alert('먼저 바코드를 생성해주세요.');
      return;
    }

    const blob = new Blob([item.svgData], { type: 'image/svg+xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.symbology}_${item.processedContents || item.contents}.svg`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDownloadZip = async (selectedOnly: boolean) => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      
      // svgData가 있고 비어있지 않은 항목만 필터링
      const itemsToDownload = selectedOnly
        ? barcodes.filter((b) => b.isSelected && b.svgData && b.svgData.trim().length > 0)
        : barcodes.filter((b) => b.svgData && b.svgData.trim().length > 0);

      console.log('다운로드 대상 항목:', itemsToDownload.map(b => ({ id: b.id, contents: b.contents, hasSvg: !!b.svgData })));

      if (itemsToDownload.length === 0) {
        alert('다운로드할 바코드가 없습니다.');
        setDownloading(false);
        return;
      }

      // 파일명 중복 방지를 위한 맵 (같은 contents를 가진 경우를 위해)
      const filenameCount = new Map<string, number>();

      for (const item of itemsToDownload) {
        if (item.svgData && item.svgData.trim().length > 0) {
          const baseFilename = `${item.symbology}_${item.processedContents || item.contents}`;
          let filename = `${baseFilename}.svg`;
          
          // 중복된 파일명이 있으면 번호 추가
          if (filenameCount.has(filename)) {
            const count = filenameCount.get(filename)! + 1;
            filenameCount.set(filename, count);
            filename = `${baseFilename}_${count}.svg`;
          } else {
            filenameCount.set(filename, 0);
          }
          
          // 디버깅: 어떤 항목이 추가되는지 로그
          console.log(`ZIP에 추가: ${filename}, ID: ${item.id}, Contents: ${item.contents}`);
          
          zip.file(filename, item.svgData);
        } else {
          console.warn(`ZIP에 추가되지 않음: ID ${item.id}, svgData 없음 또는 빈 문자열`);
        }
      }
      
      const fileCount = Object.keys(zip.files).length;
      console.log(`총 ${itemsToDownload.length}개 항목 중 ${fileCount}개 파일이 ZIP에 추가됨`);

      if (fileCount === 0) {
        alert('ZIP에 추가할 파일이 없습니다.');
        setDownloading(false);
        return;
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `barcodes_${timestamp}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('ZIP 다운로드 오류:', err);
      alert('ZIP 파일 다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  };

  const selectedCount = barcodes.filter((b) => b.isSelected && b.svgData).length;
  const validCount = barcodes.filter((b) => b.svgData).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">여러 개 생성</h2>
        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            disabled={validCount === 0}
            className="px-3 py-2 bg-gray-500 text-white rounded-lg text-sm font-semibold hover:bg-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {barcodes.every((b) => b.isSelected && b.svgData) ? '전체 해제' : '전체 선택'}
          </button>
          <button
            onClick={handleGenerateAll}
            disabled={generatingAll || barcodes.length === 0}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generatingAll ? '생성 중...' : '모두 생성'}
          </button>
          <button
            onClick={handleAddBarcode}
            disabled={barcodes.length >= MAX_BARCODES}
            className="px-4 py-2 bg-pink-500 text-white rounded-lg font-semibold hover:bg-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + 추가
          </button>
        </div>
      </div>

      <div className="space-y-4 max-h-[600px] overflow-y-auto">
        {barcodes.map((item, index) => (
          <div
            key={item.id}
            className={`p-4 border-2 rounded-lg ${
              item.error ? 'border-red-300 bg-red-50' : item.svgData ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex items-center pt-2">
                <input
                  type="checkbox"
                  checked={item.isSelected}
                  onChange={() => handleToggleSelect(item.id)}
                  disabled={!item.svgData}
                  className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                />
              </div>

              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">바코드 번호</label>
                    <input
                      type="text"
                      value={item.contents}
                      onChange={(e) => handleUpdateBarcode(item.id, { contents: e.target.value })}
                      placeholder="예: 8801234567890"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">심볼로지</label>
                    <select
                      value={item.symbology}
                      onChange={(e) => handleUpdateBarcode(item.id, { symbology: e.target.value as Symbology })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="ean13">EAN-13</option>
                      <option value="code128">Code128</option>
                      <option value="code39">Code39</option>
                      <option value="ean8">EAN-8</option>
                      <option value="upca">UPC-A</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      onClick={() => handleGenerateOne(item.id)}
                      disabled={generating === item.id || !item.contents.trim()}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {generating === item.id ? '생성 중...' : '생성'}
                    </button>
                    {barcodes.length > 1 && (
                      <button
                        onClick={() => handleDeleteBarcode(item.id)}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 transition-all text-sm"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>

                {item.error && (
                  <div className="text-sm text-red-600 bg-red-100 px-3 py-2 rounded">{item.error}</div>
                )}

                {item.svgData && (
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      <div
                        className="bg-white p-2 border border-gray-300 rounded"
                        style={{ width: '140px' }}
                        dangerouslySetInnerHTML={{ __html: item.svgData }}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-mono text-gray-700 mb-2">
                        {item.processedContents || item.contents}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDownloadSVG(item)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700 transition-all"
                        >
                          SVG 다운로드
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 pt-4 border-t">
        <button
          onClick={() => handleDownloadZip(true)}
          disabled={downloading || selectedCount === 0}
          className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? '다운로드 중...' : `선택 ZIP 다운로드 (${selectedCount})`}
        </button>
        <button
          onClick={() => handleDownloadZip(false)}
          disabled={downloading || validCount === 0}
          className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? '다운로드 중...' : `전체 ZIP 다운로드 (${validCount})`}
        </button>
      </div>
    </div>
  );
}

