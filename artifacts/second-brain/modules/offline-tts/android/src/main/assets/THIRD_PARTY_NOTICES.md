# Bundled offline speech components

Speech input and spoken replies are executed locally by the app. The feature
does not use Android's speech-recognition service, Android Text-to-Speech,
Google speech packages, or a network speech API.

| Component | Bundled material | License and source |
| --- | --- | --- |
| sherpa-onnx 1.13.8 | Android AAR and Kotlin API | Apache-2.0. Source: <https://github.com/k2-fsa/sherpa-onnx> |
| Moonshine Tiny English, int8 | Recognition model | MIT. Model source: <https://huggingface.co/csukuangfj/sherpa-onnx-moonshine-tiny-en-int8>. Upstream project: <https://github.com/usefulsensors/moonshine> |
| Piper voices, US English LJSpeech medium | Speech-synthesis model | The voice repository declares MIT: <https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/ljspeech/medium>. Its model card identifies the LJ Speech training recordings as public domain: <https://keithito.com/LJ-Speech-Dataset/> |
| eSpeak NG voice data | Phoneme and pronunciation data included with the Piper model archive | GPL-3.0-or-later. Project: <https://github.com/espeak-ng/espeak-ng>. The full license is in `licenses/espeak-ng-GPL-3.0.txt`. |
| ONNX Runtime | Native inference runtime included in the sherpa-onnx AAR | MIT. Project: <https://github.com/microsoft/onnxruntime>. The license is in `licenses/onnxruntime-MIT.txt`. |

The corresponding sherpa-onnx, Moonshine, Piper, ONNX Runtime, and eSpeak NG
license texts are included in `licenses/`. Model cards are preserved in the
bundled archives.

## Bundled artifact checksums

SHA-256 checksums for the exact binary files used by this Android build:

- sherpa-onnx 1.13.8 AAR:
  `633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96`
- Moonshine Tiny English int8 archive:
  `d5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2`
- Piper US English LJSpeech medium archive:
  `3dfb4b759d8be032a4903a9538d128b0fda2a06ab1de6cbc2d93a97e2dd83dba`

The app extracts the model archives into its private local storage on first
launch. They are not downloaded at runtime.