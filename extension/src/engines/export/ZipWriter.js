/**
 * Minimal dependency-free ZIP writer (STORE method, no compression) —
 * enough for the assets package where most payloads (webp/jpg/woff2) are
 * already compressed. Produces a spec-compliant central directory with
 * CRC-32 checksums and UTF-8 filenames.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export class ZipWriter {
  #entries = [];

  /**
   * @param {string} path forward-slash relative path inside the archive
   * @param {Uint8Array|ArrayBuffer|string} data
   */
  addFile(path, data) {
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = data;
    this.#entries.push({ path: path.replace(/\\/g, '/'), bytes });
  }

  get fileCount() {
    return this.#entries.length;
  }

  /** @returns {Blob} application/zip blob */
  build() {
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = dosDateTime(new Date());

    for (const { path, bytes } of this.#entries) {
      const nameBytes = new TextEncoder().encode(path);
      const crc = crc32(bytes);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);   // local file header signature
      local.setUint16(4, 20, true);            // version needed
      local.setUint16(6, 0x0800, true);        // flags: UTF-8 names
      local.setUint16(8, 0, true);             // method: STORE
      local.setUint16(10, now.time, true);
      local.setUint16(12, now.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true); // compressed size
      local.setUint32(22, bytes.length, true); // uncompressed size
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);            // extra length

      chunks.push(new Uint8Array(local.buffer), nameBytes, bytes);
      central.push({ path: nameBytes, crc, size: bytes.length, offset, time: now.time, date: now.date });
      offset += 30 + nameBytes.length + bytes.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const e of central) {
      const hdr = new DataView(new ArrayBuffer(46));
      hdr.setUint32(0, 0x02014b50, true);  // central directory signature
      hdr.setUint16(4, 20, true);           // version made by
      hdr.setUint16(6, 20, true);           // version needed
      hdr.setUint16(8, 0x0800, true);       // flags: UTF-8
      hdr.setUint16(10, 0, true);           // method
      hdr.setUint16(12, e.time, true);
      hdr.setUint16(14, e.date, true);
      hdr.setUint32(16, e.crc, true);
      hdr.setUint32(20, e.size, true);
      hdr.setUint32(24, e.size, true);
      hdr.setUint16(28, e.path.length, true);
      hdr.setUint32(42, e.offset, true);
      chunks.push(new Uint8Array(hdr.buffer), e.path);
      centralSize += 46 + e.path.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);     // end of central directory
    end.setUint16(8, central.length, true);  // entries on this disk
    end.setUint16(10, central.length, true); // total entries
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    chunks.push(new Uint8Array(end.buffer));

    return new Blob(chunks, { type: 'application/zip' });
  }
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
