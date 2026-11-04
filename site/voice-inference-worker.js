import { env, pipeline } from '@huggingface/transformers';

let cancelled = false;

self.onmessage = async event => {
  if (event.data?.type === 'cancel') { cancelled = true; return; }
  if (event.data?.type !== 'transcribe') return;
  cancelled = false;
  try {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.backends.onnx.wasm.wasmPaths = '/ort-wasm-simd-threaded.wasm';
    env.backends.onnx.wasm.numThreads = 1;
    const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      dtype: 'q8', device: 'wasm', progress_callback: state => {
        if (!cancelled) self.postMessage({ type: 'progress', state });
      }
    });
    if (cancelled) return;
    const result = await asr(event.data.samples, {
      sampling_rate: 16000, return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5
    });
    if (cancelled) return;
    const words = (result.chunks || []).map(chunk => ({
      text: String(chunk.text || '').trim(), start: Number(chunk.timestamp?.[0]), end: Number(chunk.timestamp?.[1])
    })).filter(word => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
    self.postMessage({ type: 'result', words });
  } catch (error) {
    if (!cancelled) self.postMessage({ type: 'error', message: error?.message || 'Local transcription failed.' });
  }
};
