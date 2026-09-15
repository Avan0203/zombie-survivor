// Cuts a flat studio background out of a generated sprite sheet.
// Only background pixels connected to the image border are removed, so bright
// interior highlights survive; edges get a one pixel feather plus un-premultiplied
// colour recovery so no white halo is left behind.
const MAX_DISTANCE = 441.67;

export function keyed(image, options = {}) {
  const target = options.target ?? { r: 255, g: 255, b: 255 };
  const softLow = options.softLow ?? 0.08;
  const softHigh = options.softHigh ?? 0.3;
  const { width, height, data } = image;
  const total = width * height;
  const distance = new Float32Array(total);
  const candidate = new Uint8Array(total);

  for (let index = 0; index < total; index += 1) {
    const o = index * 4;
    const dr = data[o] - target.r;
    const dg = data[o + 1] - target.g;
    const db = data[o + 2] - target.b;
    distance[index] = Math.sqrt(dr * dr + dg * dg + db * db) / MAX_DISTANCE;
    candidate[index] = distance[index] < softHigh ? 1 : 0;
  }
  const removed = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const push = (index) => {
    if (!candidate[index] || removed[index]) return;
    removed[index] = 1;
    stack[top++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (index >= width) push(index - width);
    if (index < total - width) push(index + width);
  }

  const out = Buffer.alloc(data.length);
  for (let index = 0; index < total; index += 1) {
    if (removed[index]) continue;
    const o = index * 4;
    const x = index % width;
    const y = (index / width) | 0;
    const next = Math.min(0.52, softHigh + 0.22);
    const touchingBorder =
      (x > 0 && removed[index - 1] === 1) ||
      (x < width - 1 && removed[index + 1] === 1) ||
      (y > 0 && removed[index - width] === 1) ||
      (y < height - 1 && removed[index + width] === 1);
    let alpha = 255;
    if (touchingBorder && distance[index] < next) {
      alpha = Math.round(((distance[index] - softHigh) / (next - softHigh)) * 255);
      if (alpha < 0) alpha = 0;
    }
    out[o + 3] = alpha;
    if (alpha === 255) {
      out[o] = data[o];
      out[o + 1] = data[o + 1];
      out[o + 2] = data[o + 2];
    } else if (alpha > 30) {
      const a = alpha / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = Math.round((data[o + channel] - (1 - a) * 255) / a);
        out[o + channel] = value < 0 ? 0 : value > 255 ? 255 : value;
      }
    }
  }
  return { width, height, data: out };
}
