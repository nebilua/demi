// Build-time preparation only. The installed APK never downloads OCR data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EXPECTED = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';
const URL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata';
const destination = path.resolve(__dirname, '../modules/screen-access/android/src/main/assets/ocr/eng.traineddata');
const checksum = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  if (fs.existsSync(destination) && checksum(fs.readFileSync(destination)) === EXPECTED) return;
  const response = await fetch(URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Pinned OCR model download failed. Retry the Android build with network access.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000 || checksum(bytes) !== EXPECTED) throw new Error('Bundled OCR model integrity check failed.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination + '.tmp', bytes);
  fs.renameSync(destination + '.tmp', destination);
  console.log('Verified bundled English Tesseract OCR model (Apache-2.0).');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
