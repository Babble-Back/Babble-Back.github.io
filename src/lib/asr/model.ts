import { AutoModelForCTC, AutoProcessor, AutoTokenizer, env } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/wav2vec2-base-960h';

type ASRProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type ASRModel = Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>;
type ASRTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;

interface LoadedASR {
  processor: ASRProcessor;
  tokenizer: ASRTokenizer;
  model: ASRModel;
}

let loadPromise: Promise<LoadedASR> | null = null;

function supportsWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadModel() {
  if (!supportsWebGPU()) {
    return AutoModelForCTC.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }

  try {
    return await AutoModelForCTC.from_pretrained(MODEL_ID, {
      device: 'webgpu',
      dtype: 'fp32',
    });
  } catch {
    return AutoModelForCTC.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }
}

export async function loadASR(): Promise<LoadedASR> {
  if (!loadPromise) {
    loadPromise = (async () => {
      env.allowLocalModels = false;

      const [processor, tokenizer, model] = await Promise.all([
        AutoProcessor.from_pretrained(MODEL_ID),
        AutoTokenizer.from_pretrained(MODEL_ID),
        loadModel(),
      ]);

      return { processor, tokenizer, model };
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}
