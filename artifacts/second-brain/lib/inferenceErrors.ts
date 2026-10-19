export class NativeInferenceError extends Error {
  readonly category: 'memory' | 'bridge' | 'runtime';
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const category = /out.of.memory|allocation|bad_alloc|cannot allocate/i.test(message)
      ? 'memory' : /hostfunction|jsi/i.test(message) ? 'bridge' : 'runtime';
    super(category === 'memory'
      ? 'The on-device model ran out of memory. Close other apps and reload it in Settings; a smaller model is optional.'
      : 'The native offline engine stopped. Reload the model in Settings and retry. Your text and partial reply have been kept.');
    this.name = 'NativeInferenceError';
    this.category = category;
  }
}
