import {
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  env,
} from '@huggingface/transformers';

const MODEL_ID = 'Xenova/whisper-tiny';

type WhisperProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type WhisperTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type WhisperModel = Awaited<ReturnType<typeof WhisperForConditionalGeneration.from_pretrained>>;

export interface LoadedWhisperModel {
  model: WhisperModel;
  processor: WhisperProcessor;
  tokenizer: WhisperTokenizer;
}

let loadPromise: Promise<LoadedWhisperModel> | null = null;

function supportsWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadModel() {
  if (!supportsWebGPU()) {
    return WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }

  try {
    return await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      device: 'webgpu',
      dtype: 'fp32',
    });
  } catch {
    return WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }
}

export async function loadWhisperModel(): Promise<LoadedWhisperModel> {
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
