import { Symbology } from '@/lib/barcode-utils';

export interface BarcodeItem {
  id: string;
  contents: string;
  symbology: Symbology;
  svgData?: string;
  error?: string;
  isSelected: boolean;
  processedContents?: string;
}

export interface BarcodeSettings {
  quietZone: number;
  fontSize: number;
  offsetLeft: number;
  offsetMiddle: number;
  offsetRight: number;
}

