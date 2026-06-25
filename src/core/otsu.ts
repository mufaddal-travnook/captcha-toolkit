/**
 * Otsu's method — compute an optimal binarization threshold from a grayscale
 * histogram. Pure function, no image library, so it's trivially testable.
 *
 * Why per-cell: a single fixed threshold can't separate near-black digits and
 * bright-yellow digits from a pale background at once. Otsu picks the threshold
 * that best splits each cell's OWN pixel distribution into two classes
 * (foreground/background), adapting to whatever color that cell's digit is.
 */

/** Build a 256-bin histogram from 8-bit grayscale pixel values. */
export function histogram(gray: Uint8Array | Buffer): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    hist[gray[i]!]!++;
  }
  return hist;
}

/**
 * Compute the Otsu threshold (0..255) that maximizes between-class variance.
 * Returns the threshold value; pixels <= threshold are one class.
 */
export function otsuThreshold(gray: Uint8Array | Buffer): number {
  const hist = histogram(gray);
  const total = gray.length;
  if (total === 0) return 127;

  // Sum of (intensity * count) over all pixels.
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!;

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    weightBackground += hist[t]!;
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * hist[t]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;

    // Between-class variance.
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}
