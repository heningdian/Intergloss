/**
 * Minimal, dependency-free ZIP (store-only, no compression) writer.
 * Sufficient for producing valid .docx (OOXML) packages entirely client-side,
 * without pulling in a third-party archiving library.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function strToBytes(str) {
  return new TextEncoder().encode(str);
}

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  pushBytes(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  pushUint16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.pushBytes(b);
  }
  pushUint32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.pushBytes(b);
  }
  toBlob(mimeType) {
    return new Blob(this.chunks, { type: mimeType });
  }
}

/**
 * Build a store-only ZIP archive.
 * @param {Array<{name: string, content: string}>} files
 * @returns {Blob}
 */
function createZip(files, mimeType) {
  const writer = new ByteWriter();
  const centralEntries = [];
  const DOS_TIME = 0;
  const DOS_DATE = 0x21; // 1980-01-01, arbitrary fixed date

  files.forEach((file) => {
    const nameBytes = strToBytes(file.name);
    const dataBytes = strToBytes(file.content);
    const crc = crc32(dataBytes);
    const localOffset = writer.length;

    writer.pushUint32(0x04034b50);
    writer.pushUint16(20);
    writer.pushUint16(0);
    writer.pushUint16(0); // method: store
    writer.pushUint16(DOS_TIME);
    writer.pushUint16(DOS_DATE);
    writer.pushUint32(crc);
    writer.pushUint32(dataBytes.length);
    writer.pushUint32(dataBytes.length);
    writer.pushUint16(nameBytes.length);
    writer.pushUint16(0);
    writer.pushBytes(nameBytes);
    writer.pushBytes(dataBytes);

    centralEntries.push({ nameBytes, crc, size: dataBytes.length, localOffset });
  });

  const centralDirStart = writer.length;
  centralEntries.forEach((entry) => {
    writer.pushUint32(0x02014b50);
    writer.pushUint16(20);
    writer.pushUint16(20);
    writer.pushUint16(0);
    writer.pushUint16(0); // method: store
    writer.pushUint16(DOS_TIME);
    writer.pushUint16(DOS_DATE);
    writer.pushUint32(entry.crc);
    writer.pushUint32(entry.size);
    writer.pushUint32(entry.size);
    writer.pushUint16(entry.nameBytes.length);
    writer.pushUint16(0);
    writer.pushUint16(0);
    writer.pushUint16(0);
    writer.pushUint16(0);
    writer.pushUint32(0);
    writer.pushUint32(entry.localOffset);
    writer.pushBytes(entry.nameBytes);
  });
  const centralDirSize = writer.length - centralDirStart;

  writer.pushUint32(0x06054b50);
  writer.pushUint16(0);
  writer.pushUint16(0);
  writer.pushUint16(centralEntries.length);
  writer.pushUint16(centralEntries.length);
  writer.pushUint32(centralDirSize);
  writer.pushUint32(centralDirStart);
  writer.pushUint16(0);

  return writer.toBlob(mimeType);
}
