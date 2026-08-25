#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'build', 'app-icon.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const BACKGROUND = [127, 165, 232, 255];

if (!existsSync(SOURCE)) throw new Error(`Missing source icon: ${SOURCE}`);
if (!existsSync(RES)) throw new Error('Android project is missing. Run "npx cap add android" first.');

const source = PNG.sync.read(await readFile(SOURCE));

function resize(input, width, height) {
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sourceY = (y + 0.5) * input.height / height - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(input.height - 1, y0 + 1);
    const fy = Math.max(0, sourceY - y0);
    for (let x = 0; x < width; x++) {
      const sourceX = (x + 0.5) * input.width / width - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(input.width - 1, x0 + 1);
      const fx = Math.max(0, sourceX - x0);
      const targetIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = input.data[(y0 * input.width + x0) * 4 + channel] * (1 - fx)
          + input.data[(y0 * input.width + x1) * 4 + channel] * fx;
        const bottom = input.data[(y1 * input.width + x0) * 4 + channel] * (1 - fx)
          + input.data[(y1 * input.width + x1) * 4 + channel] * fx;
        output.data[targetIndex + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return output;
}

function solid(width, height) {
  const output = new PNG({ width, height });
  for (let index = 0; index < output.data.length; index += 4) {
    output.data.set(BACKGROUND, index);
  }
  return output;
}

function roundedAlpha(x, y, size, radius) {
  const nearestX = Math.max(radius, Math.min(size - radius, x));
  const nearestY = Math.max(radius, Math.min(size - radius, y));
  const distance = Math.hypot(x - nearestX, y - nearestY);
  return Math.max(0, Math.min(1, radius + 0.75 - distance));
}

function placeRounded(canvas, image, left, top, radius) {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = roundedAlpha(x + 0.5, y + 0.5, image.width, radius);
      if (alpha <= 0) continue;
      const sourceIndex = (y * image.width + x) * 4;
      const targetIndex = ((top + y) * canvas.width + left + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        canvas.data[targetIndex + channel] = Math.round(
          image.data[sourceIndex + channel] * alpha + canvas.data[targetIndex + channel] * (1 - alpha)
        );
      }
      canvas.data[targetIndex + 3] = 255;
    }
  }
}

async function save(file, image) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, PNG.sync.write(image));
}

const densities = {
  mdpi: { icon: 48, foreground: 108 },
  hdpi: { icon: 72, foreground: 162 },
  xhdpi: { icon: 96, foreground: 216 },
  xxhdpi: { icon: 144, foreground: 324 },
  xxxhdpi: { icon: 192, foreground: 432 },
};

for (const [density, sizes] of Object.entries(densities)) {
  const folder = path.join(RES, `mipmap-${density}`);
  const icon = resize(source, sizes.icon, sizes.icon);
  await save(path.join(folder, 'ic_launcher.png'), icon);
  await save(path.join(folder, 'ic_launcher_round.png'), icon);
  await save(path.join(folder, 'ic_launcher_foreground.png'), resize(source, sizes.foreground, sizes.foreground));
}

const splashFiles = [
  ['drawable/splash.png', 480, 320],
  ['drawable-land-mdpi/splash.png', 480, 320],
  ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-xhdpi/splash.png', 1280, 720],
  ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['drawable-port-mdpi/splash.png', 320, 480],
  ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-xhdpi/splash.png', 720, 1280],
  ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
];

for (const [relativePath, width, height] of splashFiles) {
  const canvas = solid(width, height);
  const iconSize = Math.round(Math.min(width, height) * 0.58);
  const icon = resize(source, iconSize, iconSize);
  placeRounded(
    canvas,
    icon,
    Math.round((width - iconSize) / 2),
    Math.round((height - iconSize) / 2),
    Math.round(iconSize * 0.18)
  );
  await save(path.join(RES, relativePath), canvas);
}

console.log('Native launcher icons and splash screens generated.');
