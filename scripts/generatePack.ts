import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cleanPackTexts, computeDifficulty } from '../src/utils/difficulty';

interface GeneratePackOptions {
  description?: string;
  isFree?: boolean;
}

interface PackRow {
  id: string;
  name: string;
  description: string | null;
  is_free: boolean;
  created_at: string;
}

interface WordRow {
  pack_id: string;
  text: string;
  syllables: number;
  char_length: number;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface CliOptions extends GeneratePackOptions {
  name?: string;
  wordsJson?: string;
  wordsFile?: string;
}

function getEnvValue(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseEnvFile(raw: string) {
  const env: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmedLine.indexOf('=');

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, equalsIndex).trim();
    let value = trimmedLine.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      env[key] = value;
    }
  }

  return env;
}

async function hydrateEnvironment() {
  for (const candidate of ['.env.local', '.env']) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = parseEnvFile(raw);

      for (const [key, value] of Object.entries(parsed)) {
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      const maybeError = error as { code?: string };

      if (maybeError.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function createPackClient() {
  const supabaseUrl = getEnvValue('SUPABASE_URL');
  const supabaseServiceKey = getEnvValue('SUPABASE_SERVICE_KEY');

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function parseWordsInput(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);

    if (!Array.isArray(parsed)) {
      throw new Error('Words JSON must be an array of strings.');
    }

    return parsed.map((word) => String(word));
  }

  return trimmed.split(/\r?\n/);
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  const readFlagValue = (flag: string, inlineValue: string | undefined, index: number) => {
    if (inlineValue !== undefined) {
      return inlineValue;
    }

    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }

    return nextValue;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const [flag, inlineValue] = arg.split('=', 2);

    switch (flag) {
      case '--name':
        options.name = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--description':
        options.description = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--words-json':
        options.wordsJson = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--words-file':
        options.wordsFile = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--is-free':
        options.isFree =
          inlineValue === undefined ? readFlagValue(flag, inlineValue, index) !== 'false' : inlineValue !== 'false';
        if (inlineValue === undefined) index += 1;
        break;
      case '--paid':
        options.isFree = false;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return options;
}

async function readWords(options: CliOptions) {
  if (options.wordsJson) {
    return parseWordsInput(options.wordsJson);
  }

  if (options.wordsFile) {
    const raw = await readFile(options.wordsFile, 'utf8');
    return parseWordsInput(raw);
  }

  if (!process.stdin.isTTY) {
    const raw = await readFile(0, 'utf8');
    return parseWordsInput(raw);
  }

  return [];
}

export async function generatePack(
  name: string,
  words: string[],
  options: GeneratePackOptions = {},
) {
  const cleanedWords = cleanPackTexts(words);

  if (!cleanedWords.length) {
    throw new Error('At least one non-empty word or phrase is required.');
  }

  const client = createPackClient();
  const normalizedName = name.trim();
  const normalizedDescription = options.description ? options.description.trim() : '';

  const { data: pack, error: packError } = await client
    .from('word_packs')
    .insert({
      name: normalizedName,
      description: normalizedDescription || null,
      is_free: options.isFree ?? true,
    })
    .select('id, name, description, is_free, created_at')
    .single();

  if (packError || !pack) {
    throw new Error(`Unable to create the pack: ${packError?.message || 'Unknown error.'}`);
  }

  const processedWords: WordRow[] = cleanedWords.map((text) => {
    const difficulty = computeDifficulty(text);

    return {
      pack_id: pack.id,
      text,
      syllables: difficulty.syllables,
      char_length: difficulty.charLength,
      difficulty: difficulty.difficulty,
    };
  });

  const { error: wordsError } = await client.from('words').insert(processedWords);

  if (wordsError) {
    throw new Error(`Unable to insert the pack words: ${wordsError.message}`);
  }

  return {
    pack: pack as PackRow,
    words: processedWords,
  };
}

async function main() {
  await hydrateEnvironment();

  const options = parseCliArgs(process.argv.slice(2));

  if (!options.name) {
    throw new Error('Missing required flag: --name');
  }

  const words = await readWords(options);

  if (!words.length) {
    throw new Error(
      'Provide words with --words-json, --words-file, or piped stdin containing a JSON array or newline-separated list.',
    );
  }

  const result = await generatePack(options.name, words, {
    description: options.description,
    isFree: options.isFree,
  });

  console.log(
    `Created pack "${result.pack.name}" with ${result.words.length} words (${result.pack.id}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
