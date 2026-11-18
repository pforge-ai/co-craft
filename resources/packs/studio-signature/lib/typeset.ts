// A bounded measure for a multi-line signature. Latin letters, digits and CJK
// ideographs have different advances in the system sans-serif face.
export function signatureSize(text: string, width: number, height: number, preferred: number) {
  const weights = text
    .split('\n')
    .map((line) => Array.from(line).reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 1 : 0.64), 0));
  let size = preferred;
  while (
    size > 7 &&
    weights.reduce((n, w) => n + Math.max(1, Math.ceil((w * size) / width)), 0) * size * 1.23 > height
  )
    size *= 0.94;
  return size;
}
