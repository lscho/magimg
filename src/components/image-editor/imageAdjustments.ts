import type { ImageAdjustments } from "./types";

export const DEFAULT_IMAGE_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: 0
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedValue(value: number | undefined, minimum: number, maximum: number) {
  return clamp(Number.isFinite(value) ? Math.round(value!) : 0, minimum, maximum);
}

export function normalizeImageAdjustments(
  adjustments?: Partial<ImageAdjustments>
): ImageAdjustments {
  return {
    brightness: normalizedValue(adjustments?.brightness, -100, 100),
    contrast: normalizedValue(adjustments?.contrast, -100, 100),
    saturation: normalizedValue(adjustments?.saturation, -100, 100),
    grayscale: normalizedValue(adjustments?.grayscale, 0, 100)
  };
}

export function hasImageAdjustments(adjustments: ImageAdjustments) {
  return Object.values(adjustments).some((value) => value !== 0);
}

function clampChannel(value: number) {
  return Math.min(255, Math.max(0, value));
}

export function applyImageAdjustments(
  pixels: Uint8ClampedArray,
  adjustments: ImageAdjustments
) {
  const brightness = 1 + adjustments.brightness / 100;
  const contrast = 1 + adjustments.contrast / 100;
  const saturation = 1 + adjustments.saturation / 100;
  const grayscale = adjustments.grayscale / 100;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index] * brightness;
    let green = pixels[index + 1] * brightness;
    let blue = pixels[index + 2] * brightness;

    red = (red - 127.5) * contrast + 127.5;
    green = (green - 127.5) * contrast + 127.5;
    blue = (blue - 127.5) * contrast + 127.5;

    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    red = luminance + (red - luminance) * saturation;
    green = luminance + (green - luminance) * saturation;
    blue = luminance + (blue - luminance) * saturation;

    if (grayscale > 0) {
      const gray = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red += (gray - red) * grayscale;
      green += (gray - green) * grayscale;
      blue += (gray - blue) * grayscale;
    }

    pixels[index] = clampChannel(red);
    pixels[index + 1] = clampChannel(green);
    pixels[index + 2] = clampChannel(blue);
  }
}

export function drawAdjustedImage(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  adjustments: ImageAdjustments
) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  if (!hasImageAdjustments(adjustments)) return;

  const imageData = context.getImageData(0, 0, width, height);
  applyImageAdjustments(imageData.data, adjustments);
  context.putImageData(imageData, 0, 0);
}
