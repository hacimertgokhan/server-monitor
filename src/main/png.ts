import { deflateSync } from 'zlib'

// Tiny procedural PNG (hub ring + centre dot) so the app needs no binary assets.
function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function png(size: number, rgb: [number, number, number] = [0xc9, 0xc7, 0xc7]): Buffer {
  const rows: Buffer[] = []
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2)
      const ring = Math.max(0, 1 - Math.abs(d - 0.78) / 0.12)
      const dot = Math.max(0, 1 - Math.max(0, d - 0.28) / 0.1)
      const a = Math.min(1, Math.max(ring, d < 0.4 ? dot : 0))
      const o = 1 + x * 4
      row[o] = rgb[0]
      row[o + 1] = rgb[1]
      row[o + 2] = rgb[2]
      row[o + 3] = Math.round(a * 255)
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}
