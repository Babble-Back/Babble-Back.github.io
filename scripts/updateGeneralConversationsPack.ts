import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  cleanPackTexts,
  computeDifficulty,
  normalizePackText,
  type WordDifficulty,
} from '../src/utils/difficulty';

interface PackRow {
  id: string;
  name: string;
}

interface ExistingWordRow {
  id: string;
  text: string;
  difficulty: WordDifficulty;
}

interface InsertWordRow {
  pack_id: string;
  text: string;
  syllables: number;
  char_length: number;
  difficulty: WordDifficulty;
}

const PACK_NAME = 'General Conversations';
const WORDS_FILE = 'scripts/packs/general-conversations.txt';
const EXPECTED_COUNTS: Record<WordDifficulty, number> = {
  easy: 100,
  medium: 100,
  hard: 100,
};

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

function getDuplicateTexts(texts: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const text of texts) {
    const normalizedText = normalizePackText(text);

    if (!normalizedText) {
      continue;
    }

    if (seen.has(normalizedText)) {
      duplicates.add(normalizedText);
    } else {
      seen.add(normalizedText);
    }
  }

  return [...duplicates].sort();
}

function countByDifficulty(rows: readonly { difficulty: WordDifficulty }[]) {
  return rows.reduce<Record<WordDifficulty, number>>(
    (counts, row) => {
      counts[row.difficulty] += 1;
      return counts;
    },
    { easy: 0, medium: 0, hard: 0 },
  );
}

function assertExpectedCounts(label: string, counts: Record<WordDifficulty, number>) {
  for (const difficulty of Object.keys(EXPECTED_COUNTS) as WordDifficulty[]) {
    if (counts[difficulty] !== EXPECTED_COUNTS[difficulty]) {
      throw new Error(
        `${label} must contain ${EXPECTED_COUNTS[difficulty]} ${difficulty} phrases, found ${counts[difficulty]}.`,
      );
    }
  }
}

async function readSourceWords() {
  const raw = await readFile(WORDS_FILE, 'utf8');
  const rawTexts = raw.split(/\r?\n/);
  const duplicateTexts = getDuplicateTexts(rawTexts);

  if (duplicateTexts.length > 0) {
    throw new Error(`Duplicate local phrases found: ${duplicateTexts.join(', ')}`);
  }

  const words = cleanPackTexts(rawTexts);
  const rows = words.map((text) => {
    const computed = computeDifficulty(text);

    return {
      text,
      syllables: computed.syllables,
      char_length: computed.charLength,
      difficulty: computed.difficulty,
    };
  });

  assertExpectedCounts('Local source file', countByDifficulty(rows));

  return rows;
}

function findExistingDuplicates(rows: readonly ExistingWordRow[]) {
  return getDuplicateTexts(rows.map((row) => row.text));
}

async function updateGeneralConversationsPack() {
  await hydrateEnvironment();

  const isDryRun = process.argv.includes('--dry-run');
  const sourceRows = await readSourceWords();
  const client = createPackClient();

  const { data: pack, error: packError } = await client
    .from('word_packs')
    .select('id, name')
    .eq('name', PACK_NAME)
    .single();

  if (packError || !pack) {
    throw new Error(`Unable to find "${PACK_NAME}" pack: ${packError?.message || 'Unknown error.'}`);
  }

  const typedPack = pack as PackRow;
  const { data: existingWords, error: existingWordsError } = await client
    .from('words')
    .select('id, text, difficulty')
    .eq('pack_id', typedPack.id);

  if (existingWordsError) {
    throw new Error(`Unable to load existing words: ${existingWordsError.message}`);
  }

  const typedExistingWords = (existingWords ?? []) as ExistingWordRow[];
  const existingDuplicates = findExistingDuplicates(typedExistingWords);

  if (existingDuplicates.length > 0) {
    throw new Error(`Existing DB phrases already contain duplicates: ${existingDuplicates.join(', ')}`);
  }

  const existingTexts = new Set(typedExistingWords.map((row) => normalizePackText(row.text)));
  const rowsToInsert: InsertWordRow[] = sourceRows
    .filter((row) => !existingTexts.has(row.text))
    .map((row) => ({
      pack_id: typedPack.id,
      ...row,
    }));

  console.log(`Pack: ${typedPack.name} (${typedPack.id})`);
  console.log(`Local target counts: ${JSON.stringify(countByDifficulty(sourceRows))}`);
  console.log(`Existing DB counts: ${JSON.stringify(countByDifficulty(typedExistingWords))}`);
  console.log(`Rows to insert: ${rowsToInsert.length}`);
  console.log(`Insert counts: ${JSON.stringify(countByDifficulty(rowsToInsert))}`);

  if (isDryRun) {
    console.log('Dry run complete. No DB rows were inserted.');
    return;
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await client.from('words').insert(rowsToInsert);

    if (insertError) {
      throw new Error(`Unable to insert new words: ${insertError.message}`);
    }
  }

  const { data: finalWords, error: finalWordsError } = await client
    .from('words')
    .select('id, text, difficulty')
    .eq('pack_id', typedPack.id);

  if (finalWordsError) {
    throw new Error(`Unable to verify final words: ${finalWordsError.message}`);
  }

  const typedFinalWords = (finalWords ?? []) as ExistingWordRow[];
  const finalDuplicates = findExistingDuplicates(typedFinalWords);

  if (finalDuplicates.length > 0) {
    throw new Error(`Final DB phrases contain duplicates: ${finalDuplicates.join(', ')}`);
  }

  const finalCounts = countByDifficulty(typedFinalWords);
  assertExpectedCounts('Final DB pack', finalCounts);

  console.log(`Final DB counts: ${JSON.stringify(finalCounts)}`);
  console.log(`Updated "${PACK_NAME}" with ${rowsToInsert.length} new phrases.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void updateGeneralConversationsPack().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
