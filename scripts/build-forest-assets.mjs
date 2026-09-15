// Turns the raw model outputs in assets_src/forest into game-ready textures.
// Reads 1024px PNGs, chroma-keys the magenta sprite sheets, splits each plant
// variant into its own anchored sprite and writes public/assets/forest.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';
import { keyed } from './lib/chroma-key.mjs';

const root = resolve(import.meta.dirname, '..');
const rawDir = resolve(root, 'assets_src/forest');
const outDir = resolve(root, 'public/assets/forest');
const OPAQUE = 200;

async function load(name) {
  return decodePng(await readFile(resolve(rawDir, name)));
}

function save(name, image) {
  return writeFile(resolve(outDir, name), encodePng(image));
}


function columnRuns(image) {
  const runs = [];
  let start = -1;
  for (let x = 0; x < image.width; x += 1) {
    let filled = 0;
    for (let y = 0; y < image.height; y += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > OPAQUE) filled += 1;
    }
    if (filled > 0 && start < 0) start = x;
    if (filled === 0 && start >= 0) {
      runs.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, image.width - 1]);
  return runs.filter(([from, to]) => to - from > 6);
}

function boundsIn(image, from, to) {
  let x0 = image.width;
  let x1 = 0;
  let y0 = image.height;
  let y1 = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = from; x <= to; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > OPAQUE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function sampleRegion(image, region, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = region.y0 + Math.floor((ty * region.height) / targetHeight);
    const y1 = Math.max(y0 + 1, region.y0 + Math.floor(((ty + 1) * region.height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = region.x0 + Math.floor((tx * region.width) / targetWidth);
      const x1 = Math.max(x0 + 1, region.x0 + Math.floor(((tx + 1) * region.width) / targetWidth));
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * image.width + x) * 4;
          const alpha = image.data[i + 3];
          sumA += alpha;
          sumR += image.data[i] * alpha;
          sumG += image.data[i + 1] * alpha;
          sumB += image.data[i + 2] * alpha;
          count += 1;
        }
      }
      const o = (ty * targetWidth + tx) * 4;
      out[o + 3] = Math.round(sumA / count);
      if (sumA > 0) {
        out[o] = Math.round(sumR / sumA);
        out[o + 1] = Math.round(sumG / sumA);
        out[o + 2] = Math.round(sumB / sumA);
      }
    }
  }
  return out;
}
function blit(canvas, sprite, offsetX, offsetY) {
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      const source = (y * sprite.width + x) * 4;
      const alpha = sprite.data[source + 3];
      if (alpha === 0) continue;
      const target = ((offsetY + y) * canvas.width + offsetX + x) * 4;
      canvas.data[target] = sprite.data[source];
      canvas.data[target + 1] = sprite.data[source + 1];
      canvas.data[target + 2] = sprite.data[source + 2];
      canvas.data[target + 3] = alpha;
    }
  }
}

function coverage(sprite) {
  let filled = 0;
  for (let i = 3; i < sprite.data.length; i += 4) if (sprite.data[i] > OPAQUE) filled += 1;
  return ((filled / (sprite.width * sprite.height)) * 100).toFixed(1);
}

async function buildSheet(rawName, prefix, count, size) {
  const image = keyed(await load(rawName));
  let runs = columnRuns(image);
  if (runs.length < count) {
    const step = Math.ceil(image.width / count);
    runs = Array.from({ length: count }, (_, index) => [index * step, Math.min(image.width - 1, (index + 1) * step - 1)]);
  } else {
    runs = runs
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
      .slice(0, count)
      .sort((a, b) => a[0] - b[0]);
  }

  for (let index = 0; index < count; index += 1) {
    const bounds = boundsIn(image, runs[index][0], runs[index][1]);
    if (!bounds) {
      console.warn(`${prefix}-${index + 1}: no content found`);
      continue;
    }
    const scale = Math.min(size.w / bounds.width, size.h / bounds.height);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    const sprite = {
      width,
      height,
      data: sampleRegion(image, bounds, width, height),
    };
    const canvas = blankCanvas(size.w, size.h);
    blit(canvas, sprite, Math.round((size.w - width) / 2), size.h - height);
    const name = `${prefix}-${String.fromCharCode(97 + index)}.png`;
    await save(name, canvas);
    console.log(`${name} ${size.w}x${size.h} source ${bounds.width}x${bounds.height} fill ${coverage(canvas)}%`);
  }
}
function blankCanvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

// 2x2 mirrored tile so the seam behaviour of the ground texture is visible at a glance.
function mirrorTile(image, size) {
  const canvas = blankCanvas(size * 2, size * 2);
  for (let y = 0; y < size * 2; y += 1) {
    for (let x = 0; x < size * 2; x += 1) {
      const sourceX = x < size ? Math.floor((x / size) * image.width) : Math.floor(((size * 2 - 1 - x) / size) * image.width);
      const sourceY = y < size ? Math.floor((y / size) * image.height) : Math.floor(((size * 2 - 1 - y) / size) * image.height);
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * canvas.width + x) * 4;
      canvas.data[target] = image.data[source];
      canvas.data[target + 1] = image.data[source + 1];
      canvas.data[target + 2] = image.data[source + 2];
      canvas.data[target + 3] = 255;
    }
  }
  return canvas;
}

async function buildGround() {
  const source = await load('ground-raw.png');
  const size = 512;
  await save('ground.png', { width: size, height: size, data: sampleRegion(source, { x0: 0, y0: 0, width: source.width, height: source.height }, size, size) });
  await writeFile(resolve(rawDir, 'ground-preview.png'), encodePng(mirrorTile(source, size)));
  console.log(`ground.png ${size}x${size} from ${source.width}x${source.height}`);
}


async function buildEdge() {
  const image = keyed(await load('edge-raw.png'));
  const bounds = boundsIn(image, 0, image.width - 1);
  const width = 1024;
  const height = 640;
  const data = sampleRegion(image, bounds, width, height);
  await save('edge.png', { width, height, data });
  console.log(`edge.png ${width}x${height} source ${bounds.width}x${bounds.height} fill ${coverage({ width, height, data })}%`);
}

await buildGround();
await buildSheet('grass-raw.png', 'grass', 3, { w: 128, h: 112 });
await buildSheet('bush-raw.png', 'bush', 3, { w: 160, h: 144 });
await buildEdge();


// Mirror the middle variant of every sheet: generated rows come out nearly
// identical, and a flipped silhouette reads as a different plant for free.
function flipHorizontal(image) {
  const data = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = (y * image.width + (image.width - 1 - x)) * 4;
      data[target] = image.data[source];
      data[target + 1] = image.data[source + 1];
      data[target + 2] = image.data[source + 2];
      data[target + 3] = image.data[source + 3];
    }
  }
  return { ...image, data };
}

await Promise.all(
  ['grass-b.png', 'bush-b.png'].map(async (name) => {
    await save(name, flipHorizontal(decodePng(await readFile(resolve(outDir, name)))));
  }),
);

