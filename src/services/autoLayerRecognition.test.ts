import { describe, expect, it } from "vitest";
import {
  chooseAutoLayerOcrLines,
  inferAutoLayerFontStyleFromPixels,
  inferAutoLayerTextGlyphAlphaFromPixels,
  normalizeAutoLayerOcrText
} from "@/services/autoLayerRecognition";

function textCrop(strokeWidth: number) {
  const width = 24;
  const height = 24;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 245;
    pixels[index + 1] = 245;
    pixels[index + 2] = 245;
    pixels[index + 3] = 255;
  }
  const paint = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 25;
    pixels[offset + 1] = 25;
    pixels[offset + 2] = 25;
  };
  for (let y = 3; y < 21; y += 1) {
    for (let x = 9; x < 9 + strokeWidth; x += 1) paint(x, y);
  }
  for (let y = 9; y < 9 + strokeWidth; y += 1) {
    for (let x = 3; x < 21; x += 1) paint(x, y);
  }
  return { pixels, width, height };
}

describe("automatic-layer font style inference", () => {
  it("keeps regular thin Chinese UI text at weight 400", () => {
    const crop = textCrop(1);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "修行奖励"
    ).fontWeight).toBe(400);
  });

  it("keeps medium or outlined Chinese strokes at the regular fallback", () => {
    const crop = textCrop(4);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "修行奖励"
    ).fontWeight).toBe(400);
  });

  it("keeps merely thick raster strokes at the regular fallback", () => {
    const crop = textCrop(6);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "修行奖励"
    ).fontWeight).toBe(400);
  });

  it("only promotes unmistakably heavy strokes to semibold", () => {
    const crop = textCrop(14);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "修行奖励"
    ).fontWeight).toBe(600);
  });

  it("keeps short numeric UI labels regular despite heavy outline evidence", () => {
    const crop = textCrop(14);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "5"
    ).fontWeight).toBe(400);
    expect(inferAutoLayerFontStyleFromPixels(
      crop.pixels,
      crop.width,
      crop.height,
      "10"
    ).fontWeight).toBe(400);
  });
});

describe("automatic-layer OCR text normalization", () => {
  it("normalizes a full-width time separator without altering Chinese text", () => {
    expect(normalizeAutoLayerOcrText("01：44")).toBe("01:44");
    expect(normalizeAutoLayerOcrText("通关时间")).toBe("通关时间");
  });
});

describe("automatic-layer text removal matte", () => {
  it("uses original glyph pixels without absorbing nearby low-contrast material texture", () => {
    const width = 7;
    const height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 190;
      pixels[index + 1] = 180;
      pixels[index + 2] = 160;
      pixels[index + 3] = 255;
    }
    const texture = (1 * width + 1) * 4;
    pixels[texture] = 170;
    pixels[texture + 1] = 165;
    pixels[texture + 2] = 150;
    const glyph = (2 * width + 3) * 4;
    pixels[glyph] = 35;
    pixels[glyph + 1] = 45;
    pixels[glyph + 2] = 60;

    const alpha = inferAutoLayerTextGlyphAlphaFromPixels(pixels, width, height);
    expect(alpha[1 * width + 1]).toBe(0);
    expect(alpha[2 * width + 3]).toBe(255);
  });
});

describe("automatic-layer OCR line reconciliation", () => {
  const line = (text: string, confidence: number) => ({
    text, confidence, x: 0, y: 0, width: 40, height: 20
  });

  it("uses whole-line recognition when detection fragments one manual text box", () => {
    expect(chooseAutoLayerOcrLines(
      [line("a", 0.1), line("c", 0.45), line("0", 0.23)],
      line("to", 0.24)
    )).toEqual([line("10", 0.24)]);
  });

  it("uses whole-line recognition when it recovers missing characters", () => {
    expect(chooseAutoLayerOcrLines(
      [line("前", 0.72)],
      line("前往", 0.88)
    )).toEqual([line("前往", 0.88)]);
  });

  it("keeps reliable detected lines when whole-box recognition is weaker", () => {
    const detected = [line("第一行", 0.95), line("第二行", 0.93)];
    expect(chooseAutoLayerOcrLines(detected, line("第一行第二行", 0.6))).toEqual(detected);
  });

  it("removes border artifacts beside Chinese and pure numeric text", () => {
    expect(normalizeAutoLayerOcrText("c前往")).toBe("前往");
    expect(normalizeAutoLayerOcrText("[5")).toBe("5");
    expect(normalizeAutoLayerOcrText("(0/3)")).toBe("(0/3)");
  });
});
