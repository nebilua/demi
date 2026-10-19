# Bundled screen OCR

OCR uses Tesseract4Android 4.9.0 (Apache-2.0), with its Tesseract and Leptonica
native dependencies and their upstream license notices. It does not use
Android, Google Play Services, or cloud OCR.

- Tesseract4Android: https://github.com/adaptech-cz/Tesseract4Android
- Tesseract: https://github.com/tesseract-ocr/tesseract (Apache-2.0)
- Leptonica: https://github.com/DanBloomberg/leptonica (BSD-2-Clause)
- Bundled English data: https://github.com/tesseract-ocr/tessdata_fast
  (Apache-2.0), revision `87416418657359cb625c412a48b6e1d6d41c29bd`.
- English data SHA-256:
  `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.

The language data is downloaded and integrity-checked at APK build time only.
The installed app copies it from assets into app-private no-backup storage.
The OCR language is English. No runtime model download is performed.
