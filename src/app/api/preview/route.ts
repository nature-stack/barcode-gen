import { NextRequest, NextResponse } from 'next/server';
import bwipjs from 'bwip-js';
import { BarcodeRequestSchema } from '@/lib/validation';
import { getBarcodeOptions } from '@/lib/barcode-utils';
import * as fs from 'fs';
import * as path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contents, symbology, quietZone, fontSize, offsetLeft, offsetMiddle, offsetRight } = BarcodeRequestSchema.parse(body);

    const options = getBarcodeOptions(symbology, quietZone);

    // bwip-js로 SVG 생성 (바코드만, 텍스트 제외)
    let svg = bwipjs.toSVG({
      ...options,
      text: contents,
      includetext: false,
    });

    // SVG에 명시적인 width와 height 추가
    svg = addSVGDimensions(svg);
    
    // SVG에 폰트 스타일 추가
    svg = addFontStyle(svg);

    // EAN-13의 경우 처리
    if (symbology === 'ean13') {
      // 가드바 길이 조정 + 바코드 그룹화 + 숫자 추가를 한 번에 처리
      svg = processEAN13(svg, contents, fontSize, offsetLeft, offsetMiddle, offsetRight);
    } else {
      // 다른 심볼로지는 간단한 처리
      svg = addCenterText(svg, contents, fontSize);
    }

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
      },
    });
  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '바코드 생성에 실패했습니다.' },
      { status: 400 }
    );
  }
}

function addSVGDimensions(svg: string): string {
  try {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    if (viewBoxMatch) {
      const viewBoxValues = viewBoxMatch[1].split(' ');
      const width = viewBoxValues[2];
      const height = viewBoxValues[3];
      
      svg = svg.replace(
        /<svg /,
        `<svg width="${width}" height="${height}" `
      );
    }
    return svg;
  } catch (error) {
    console.error('Error adding SVG dimensions:', error);
    return svg;
  }
}

// 폰트를 base64로 캐싱
let cachedFontBase64: string | null = null;

function getFontBase64(): string {
  if (cachedFontBase64) {
    return cachedFontBase64;
  }
  
  try {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'ocrb', 'ocr-b-10-bt.ttf');
    const fontBuffer = fs.readFileSync(fontPath);
    cachedFontBase64 = fontBuffer.toString('base64');
    return cachedFontBase64;
  } catch (error) {
    console.error('Error loading font:', error);
    return '';
  }
}

function addFontStyle(svg: string): string {
  try {
    const fontBase64 = getFontBase64();
    
    const fontStyle = fontBase64 ? `
  <defs>
    <style type="text/css">
      @font-face {
        font-family: 'OCR-B';
        src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    </style>
  </defs>` : `
  <defs>
    <style type="text/css">
      @font-face {
        font-family: 'OCR-B';
        src: url('/fonts/ocrb/ocr-b-10-bt.ttf') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    </style>
  </defs>`;
    
    svg = svg.replace(/<svg ([^>]*)>/, `<svg $1>${fontStyle}`);
    return svg;
  } catch (error) {
    console.error('Error adding font style:', error);
    return svg;
  }
}

/**
 * EAN-13 인코딩 패턴
 */
const EAN13_L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'
];

const EAN13_G_CODES = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111'
];

const EAN13_R_CODES = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100'
];

const EAN13_FIRST_DIGIT_PATTERNS = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
];

/**
 * EAN-13 바코드를 직접 생성 (bwip-js 사용 안 함)
 */
function generateEAN13Barcode(text: string, fontSize: number = 31, offsetLeft: number = 0, offsetMiddle: number = 0, offsetRight: number = 0): string {
  try {
    // EAN-13은 13자리여야 함
    if (text.length !== 13) {
      throw new Error('EAN-13 must be 13 digits');
    }

    // 상수 정의
    const SVG_WIDTH = 346;
    const SVG_HEIGHT = 220;
    const BAR_WIDTH = 3;
    const GUARD_BAR_HEIGHT = 200;
    const DATA_BAR_HEIGHT = 165;
    const TEXT_Y = 185;
    const START_X = 30;

    // 첫 번째 숫자로 인코딩 패턴 결정
    const firstDigit = parseInt(text[0]);
    const pattern = EAN13_FIRST_DIGIT_PATTERNS[firstDigit];

    // 바코드 비트 문자열 생성
    let barcodeBits = '101'; // Start guard

    // 왼쪽 6자리 인코딩
    for (let i = 0; i < 6; i++) {
      const digit = parseInt(text[i + 1]);
      if (pattern[i] === 'L') {
        barcodeBits += EAN13_L_CODES[digit];
      } else {
        barcodeBits += EAN13_G_CODES[digit];
      }
    }

    barcodeBits += '01010'; // Center guard

    // 오른쪽 6자리 인코딩
    for (let i = 0; i < 6; i++) {
      const digit = parseInt(text[i + 7]);
      barcodeBits += EAN13_R_CODES[digit];
    }

    barcodeBits += '101'; // End guard

    // Compound path 생성
    const pathSegments: string[] = [];
    let currentX = START_X;

    for (let i = 0; i < barcodeBits.length; i++) {
      if (barcodeBits[i] === '1') {
        // 가드바 판별: Start (0-2), Center (42-46), End (92-94)
        const isGuard = (i >= 0 && i <= 2) || (i >= 42 && i <= 46) || (i >= 92 && i <= 94);
        const barBottom = isGuard ? GUARD_BAR_HEIGHT : DATA_BAR_HEIGHT;

        pathSegments.push(`M${currentX} 0L${currentX} ${barBottom}`);
      }
      currentX += BAR_WIDTH;
    }

    // 폰트 임베딩
    const fontBase64 = getFontBase64();
    const fontDataUrl = fontBase64 ? `data:font/truetype;charset=utf-8;base64,${fontBase64}` : '/fonts/ocrb/ocr-b-10-bt.ttf';

    // SVG 생성
    const svg = `<svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style type="text/css">
      @font-face {
        font-family: 'OCR-B';
        src: url(${fontDataUrl}) format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    </style>
  </defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#FFFFFF"/>
  <g id="barcode-bars">
    <path stroke="#000000" stroke-width="${BAR_WIDTH}" d="${pathSegments.join(' ')}" />
  </g>
  <g id="first-digit">
    <text x="${START_X - 16 - 5 + offsetLeft}" y="${TEXT_Y + 10}" font-family="OCR-B, OCRB, 'OCR B', monospace" font-size="${fontSize - 1}" text-anchor="start" fill="#000000">${text[0]}</text>
  </g>
  <g id="left-group">
    <text x="${START_X + 27 - 17 + offsetMiddle}" y="${TEXT_Y + 10}" font-family="OCR-B, OCRB, 'OCR B', monospace" font-size="${fontSize}" letter-spacing="-0.025em" fill="#000000">${text.substring(1, 7)}</text>
  </g>
  <g id="right-group">
    <text x="${START_X + 174 - 25 + 3 + offsetRight}" y="${TEXT_Y + 10}" font-family="OCR-B, OCRB, 'OCR B', monospace" font-size="${fontSize}" letter-spacing="-0.025em" fill="#000000">${text.substring(7, 13)}</text>
  </g>
</svg>`;

    return svg;
  } catch (error) {
    console.error('Error generating EAN13:', error);
    throw error;
  }
}

/**
 * EAN-13 처리: 직접 생성된 바코드 반환
 */
function processEAN13(svg: string, text: string, fontSize: number = 31, offsetLeft: number = 0, offsetMiddle: number = 0, offsetRight: number = 0): string {
  // bwip-js 결과 무시하고 직접 생성
  return generateEAN13Barcode(text, fontSize, offsetLeft, offsetMiddle, offsetRight);
}

/**
 * 중앙 하단에 텍스트 추가 (Code128, Code39 등)
 */
function addCenterText(svg: string, text: string, fontSize: number = 16): string {
  try {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    
    if (!viewBoxMatch) {
      return svg;
    }

    const viewBoxValues = viewBoxMatch[1].split(' ');
    const vbWidth = parseFloat(viewBoxValues[2]);
    const vbHeight = parseFloat(viewBoxValues[3]);

    const textElement = `
  <text x="${vbWidth / 2}" y="${vbHeight - 2}" font-family="OCR-B, OCRB, 'OCR B', monospace" font-size="${fontSize}" text-anchor="middle" fill="#000000">${text}</text>`;

    const modifiedSvg = svg.replace('</svg>', `${textElement}\n</svg>`);
    return modifiedSvg;
  } catch (error) {
    console.error('Error adding center text:', error);
    return svg;
  }
}
