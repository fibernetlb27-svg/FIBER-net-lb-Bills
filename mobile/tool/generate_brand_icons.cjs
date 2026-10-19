'use strict';
// Native build assets, using the existing desktop's FIBER orange-disc/ring mark.
// No external renderer, image service, live assets or private files are involved.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
function chunk(type, data) {
  const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
function png(size) {
  const stride = size * 3 + 1, pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const channels = [0, 0, 0];
    for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
      const px = (x + dx) * 256 / size, py = (y + dy) * 256 / size;
      let color = [255, 255, 255];
      if ((px - 128) ** 2 + (py - 128) ** 2 <= 118 ** 2) {
        color = [255, 98, 0];
        if ([72, 112, 152].some(cx => {
          const radius = Math.hypot(px - cx, py - 128);
          return radius >= 80 && radius <= 96;
        })) color = [255, 255, 255];
      }
      color.forEach((value, index) => channels[index] += value / 4);
    }
    const offset = y * stride + 1 + x * 3;
    channels.forEach((value, index) => pixels[offset + index] = Math.round(value));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // RGB, deliberately opaque for iOS App Store icons.
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
const cache = new Map();
function write(relative, size) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw Error('Icon path must stay in app.');
  if (!Number.isInteger(size) || size < 16 || size > 1024) throw Error('Invalid icon size.');
  if (!cache.has(size)) cache.set(size, png(size));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, cache.get(size));
}
for (const [density, size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) write(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size);
const ios = 'ios/Runner/Assets.xcassets/AppIcon.appiconset';
for (const item of JSON.parse(fs.readFileSync(path.join(root, ios, 'Contents.json'))).images) write(`${ios}/${item.filename}`, Math.round(Number(item.size.split('x')[0]) * Number(item.scale.replace('x', ''))));
for (const size of [192,512]) for (const name of ['Icon','Icon-maskable']) write(`web/icons/${name}-${size}.png`, size);
write('web/favicon.png', 32);
console.log('Android, iOS and browser brand icons generated with exact dimensions and opaque RGB.');
