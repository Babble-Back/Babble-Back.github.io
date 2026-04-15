import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  cleanPackTexts,
  computeDifficulty,
  normalizePackText,
} from '../src/utils/difficulty';

type Difficulty = 'easy' | 'medium' | 'hard';
type CampaignMode = 'normal' | 'reverse_only';

interface WordRow {
  pack_id: string;
  text: string;
  syllables: number;
  char_length: number;
  difficulty: Difficulty;
}

interface CampaignChallengeRow {
  campaign_id: string;
  challenge_index: number;
  phrase: string;
  difficulty: Difficulty;
  mode: CampaignMode;
}

interface CampaignAssetRow {
  campaign_id: string;
  key: string;
  value: string;
}

interface ExistingPackRow {
  id: string;
}

interface ExistingCampaignRow {
  id: string;
}

const PACK_NAME = 'Easter Pack';
const PACK_DESCRIPTION =
  'An Easter-themed pack with 100 easy, 100 medium, and 100 hard phrases. Clear 33 campaign challenges to unlock easy words, 66 for medium access, and all 100 for the full pack.';
const CAMPAIGN_NAME = 'Easter Campaign March-April 2026';
const CAMPAIGN_DISPLAY_TITLE = 'Easter Campaign';
const CAMPAIGN_THEME = 'easter';
const CAMPAIGN_SUBTITLE =
  '100 Easter challenges. Earn 3 stars to open the next egg, with one free try per challenge each day.';
const START_DATE = '2026-03-31T06:00:00.000Z';
const END_DATE = '2026-05-01T05:59:59.000Z';
const EASY_PACK_UNLOCK_COUNT = 33;
const MEDIUM_PACK_UNLOCK_COUNT = 66;
const HARD_PACK_UNLOCK_COUNT = 100;
const CAMPAIGN_CURRENCY_RESOURCE_TYPE = 'easter_egg';
const CAMPAIGN_CURRENCY_SINGULAR_NAME = 'egg';
const CAMPAIGN_CURRENCY_PLURAL_NAME = 'eggs';
const CAMPAIGN_PACK_UNLOCK_COSTS = {
  easy: 25,
  medium: 50,
  hard: 150,
} as const;
const CAMPAIGN_SELECTION_COUNTS = {
  easy: 33,
  medium: 33,
  hard: 34,
} as const;

const EASTER_WORDS: Record<Difficulty, string[]> = {
  easy: [
    'egg',
    'eggs',
    'nest',
    'nests',
    'lamb',
    'lambs',
    'chick',
    'chicks',
    'bloom',
    'blooms',
    'bud',
    'buds',
    'lily',
    'lilies',
    'tulip',
    'tulips',
    'robin',
    'robins',
    'peeps',
    'bonnet',
    'bunny',
    'rabbit',
    'ribbon',
    'pastels',
    'sunrise',
    'spring',
    'meadow',
    'red egg',
    'red eggs',
    'red nest',
    'red nests',
    'red bud',
    'red buds',
    'red bloom',
    'red lamb',
    'red lambs',
    'red chick',
    'red hop',
    'red hops',
    'red glow',
    'blue egg',
    'blue eggs',
    'blue nest',
    'blue nests',
    'blue bud',
    'blue buds',
    'blue bloom',
    'blue lamb',
    'blue lambs',
    'blue chick',
    'blue hop',
    'blue hops',
    'blue glow',
    'pink egg',
    'pink eggs',
    'pink nest',
    'pink nests',
    'pink bud',
    'pink buds',
    'pink bloom',
    'pink lamb',
    'pink lambs',
    'pink chick',
    'pink hop',
    'pink hops',
    'pink glow',
    'gold egg',
    'gold eggs',
    'gold nest',
    'gold nests',
    'gold bud',
    'gold buds',
    'gold bloom',
    'gold lamb',
    'gold lambs',
    'gold chick',
    'gold hop',
    'gold hops',
    'gold glow',
    'mint egg',
    'mint eggs',
    'mint nest',
    'mint nests',
    'mint bud',
    'mint buds',
    'mint bloom',
    'mint lamb',
    'mint lambs',
    'mint chick',
    'mint hop',
    'mint hops',
    'mint glow',
    'soft egg',
    'soft eggs',
    'soft nest',
    'soft nests',
    'soft bud',
    'soft buds',
    'soft bloom',
    'soft lamb',
  ],
  medium: [
    'empty tomb',
    'easter bunny',
    'easter egg',
    'bunny ears',
    'spring flowers',
    'jelly beans',
    'easter basket',
    'painted eggs',
    'egg dye',
    'baby chicks',
    'spring rain',
    'carrot cake',
    'marshmallow chicks',
    'egg rolling',
    'pastel colors',
    'flower crown',
    'garden tulips',
    'bunny hop',
    'candy eggs',
    'egg carton',
    'basket grass',
    'sunny spring',
    'blooming lilies',
    'easter parade',
    'picnic blanket',
    'fresh blossoms',
    'toy bunny',
    'striped eggs',
    'polka dot egg',
    'golden egg',
    'plastic eggs',
    'egg surprise',
    'chick parade',
    'spring breeze',
    'flower bouquet',
    'easter candy',
    'bunny trail',
    'egg stickers',
    'spring meadow',
    'candy basket',
    'bunny nose',
    'fluffy tail',
    'spring picnic',
    'egg painting',
    'tulip patch',
    'candy hunt',
    'bunny paws',
    'easter brunch',
    'sunrise service',
    'flower basket',
    'spring chicks',
    'carrot patch',
    'easter ribbon',
    'pastel ribbon',
    'bunny whiskers',
    'egg hunt map',
    'basket handle',
    'spring robin',
    'easter card',
    'bunny slippers',
    'egg garland',
    'speckled egg',
    'sugar eggs',
    'spring wreath',
    'rabbit tracks',
    'easter bonnet',
    'bunny burrow',
    'garden party',
    'egg hunt clues',
    'spring sunshine',
    'cocoa bunny',
    'chirping chick',
    'carrot treats',
    'blooming branch',
    'egg confetti',
    'basket bow',
    'hopping rabbit',
    'spring cookies',
    'egg display',
    'easter table',
    'flower garland',
    'easter grass',
    'spring path',
    'egg painter',
    'basket goodies',
    'bunny basket',
    'yellow chick',
    'blooming garden',
    'spring morning',
    'egg pattern',
    'bunny treat',
    'festive eggs',
    'spring sprout',
    'easter joy',
    'rolled away stone',
    'garden sunrise',
    'easter vigil',
    'paschal candle',
    'sunrise hymn',
    'lenten season',
  ],
  hard: [
    'resurrection morning',
    'triumphal entry',
    'alleluia chorus',
    'scavenger basket',
    'bunny centerpiece',
    'rainbow jelly beans',
    'lily arrangement',
    'sunrise gathering',
    'victory over death',
    'festival bonnet',
    'egg decorating',
    'hidden candy trail',
    'paint-splattered eggs',
    'pastel tablecloth',
    'flowering dogwood',
    'quiet reflection',
    'morning alleluias',
    'spring awakening',
    'colorful bonnets',
    'family egg relay',
    'peanut butter egg',
    'hollow chocolate egg',
    'daisy centerpiece',
    'bunny cookie tin',
    'paschal mystery',
    'harrowing of hades',
    'stone-hewn sepulcher',
    'garden sepulcher',
    'octave of easter',
    'alleluia banner',
    'processional palms',
    'tenebrae service',
    'sanctuary lilies',
    'spice-bearing women',
    'sunrise liturgy',
    'empty sepulcher',
    'aloes and spices',
    'resurrection joy',
    'firstfruits of spring',
    'morning procession',
    'easter proclamation',
    'resurrection garden',
    'choral alleluia',
    'baptismal renewal',
    'lily procession',
    'pysanka patterns',
    'cascarones confetti',
    'painted pysanky',
    'sunrise canticle',
    'garden anointing',
    'alleluia return',
    'lily-scented chapel',
    'resurrection hope',
    'sanctuary floral arch',
    'joyful procession',
    'resurrection tapestry',
    'paschal troparion',
    'painted egg garland',
    'pastel ribbon garland',
    'golden basket parade',
    'spring blossom canopy',
    'festival candy bouquet',
    'sunrise chapel chorus',
    'flower market parade',
    'chocolate rabbit parade',
    'confetti egg cascade',
    'painted garden pathway',
    'lily chapel candles',
    'carrot cupcake tower',
    'marshmallow candy nest',
    'bunny lantern parade',
    'tulip meadow picnic',
    'resurrection candlelight',
    'morning garden vigil',
    'paschal candlelight vigil',
    'flowering chapel arch',
    'springtime basket display',
    'painted bonnet parade',
    'gold foil egg display',
    'sunrise hymn rehearsal',
    'garden party centerpiece',
    'easter morning fanfare',
    'jelly bean centerpiece',
    'blossom pathway lanterns',
    'sunlit ribbon canopies',
    'festival lily garland',
    'candy basket showcase',
    'cathedral garden chorus',
    'spring processional banner',
    'painted egg centerpiece',
    'chapel flower procession',
    'ribbon-wrapped chocolate eggs',
    'celebration picnic hamper',
    'blooming orchard pathway',
    'springtime candy exchange',
    'garden sunrise procession',
    'festival sunrise chorus',
    'painted egg ceremony',
    'flower crown workshop',
    'eastertide candlelight',
  ],
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

function createSupabaseClient() {
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

function buildEasyWords() {
  return [...EASTER_WORDS.easy];
}

function buildMediumWords() {
  return [...EASTER_WORDS.medium];
}

function buildHardWords() {
  return [...EASTER_WORDS.hard];
}

function assertExactUniqueCount(words: string[], expectedCount: number, label: string) {
  const cleanedWords = cleanPackTexts(words);

  if (cleanedWords.length !== expectedCount || words.length !== expectedCount) {
    throw new Error(`${label} words must contain exactly ${expectedCount} unique entries.`);
  }

  return cleanedWords;
}

function assertDifficultyBucket(words: string[], expectedDifficulty: Difficulty, label: string) {
  const mismatches = words
    .map((word) => ({
      word,
      computed: computeDifficulty(word),
    }))
    .filter((entry) => entry.computed.difficulty !== expectedDifficulty);

  if (mismatches.length > 0) {
    const summary = mismatches
      .slice(0, 5)
      .map(
        (entry) =>
          `"${entry.word}" => ${entry.computed.difficulty} (${entry.computed.score.toFixed(2)})`,
      )
      .join(', ');

    throw new Error(
      `${label} words must all score as ${expectedDifficulty}. Found ${mismatches.length} mismatches: ${summary}`,
    );
  }

  return words;
}

function assertNoCrossBucketDuplicates(wordsByDifficulty: Record<Difficulty, string[]>) {
  const seen = new Map<string, Difficulty>();

  for (const difficulty of Object.keys(wordsByDifficulty) as Difficulty[]) {
    for (const word of wordsByDifficulty[difficulty]) {
      const normalizedWord = normalizePackText(word);
      const existingDifficulty = seen.get(normalizedWord);

      if (existingDifficulty) {
        throw new Error(
          `Duplicate Easter phrase "${normalizedWord}" found in both ${existingDifficulty} and ${difficulty}.`,
        );
      }

      seen.set(normalizedWord, difficulty);
    }
  }
}

function toWordRows(packId: string, words: string[], difficulty: Difficulty): WordRow[] {
  return words.map((text) => {
    const computed = computeDifficulty(text);

    if (computed.difficulty !== difficulty) {
      throw new Error(
        `Expected "${text}" to score as ${difficulty}, but it scored as ${computed.difficulty}.`,
      );
    }

    return {
      pack_id: packId,
      text,
      syllables: computed.syllables,
      char_length: computed.charLength,
      difficulty: computed.difficulty,
    };
  });
}

function spreadSelect(words: string[], count: number) {
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.floor((index * words.length) / count);
    return words[sourceIndex] ?? words[words.length - 1];
  });
}

function buildChallengePlan(
  campaignId: string,
  easyWords: string[],
  mediumWords: string[],
  hardWords: string[],
) {
  const easySelection = spreadSelect(easyWords, CAMPAIGN_SELECTION_COUNTS.easy);
  const mediumSelection = spreadSelect(mediumWords, CAMPAIGN_SELECTION_COUNTS.medium);
  const hardSelection = spreadSelect(hardWords, CAMPAIGN_SELECTION_COUNTS.hard);

  const challenges: CampaignChallengeRow[] = [];
  let mediumCounter = 0;
  let hardCounter = 0;

  for (let index = 0; index < easySelection.length; index += 1) {
    const challengeIndex = index + 1;

    challenges.push({
      campaign_id: campaignId,
      challenge_index: challengeIndex,
      phrase: easySelection[index],
      difficulty: 'easy',
      mode: challengeIndex === 33 ? 'reverse_only' : 'normal',
    });
  }

  for (let index = 0; index < mediumSelection.length; index += 1) {
    mediumCounter += 1;
    challenges.push({
      campaign_id: campaignId,
      challenge_index: challenges.length + 1,
      phrase: mediumSelection[index],
      difficulty: 'medium',
      mode: mediumCounter % 10 === 0 ? 'reverse_only' : 'normal',
    });
  }

  for (let index = 0; index < hardSelection.length; index += 1) {
    hardCounter += 1;
    const challengeIndex = challenges.length + 1;
    const isFinalChallenge = challengeIndex === 100;

    challenges.push({
      campaign_id: campaignId,
      challenge_index: challengeIndex,
      phrase: hardSelection[index],
      difficulty: 'hard',
      mode: isFinalChallenge || hardCounter % 5 === 0 ? 'reverse_only' : 'normal',
    });
  }

  if (challenges.length !== 100) {
    throw new Error(`Expected 100 campaign challenges, received ${challenges.length}.`);
  }

  const mismatchedChallenges = challenges.filter(
    (challenge) => computeDifficulty(challenge.phrase).difficulty !== challenge.difficulty,
  );

  if (mismatchedChallenges.length > 0) {
    const summary = mismatchedChallenges
      .slice(0, 5)
      .map((challenge) => `${challenge.challenge_index}:${challenge.phrase}`)
      .join(', ');

    throw new Error(
      `Campaign challenges must match their stored difficulty. Found ${mismatchedChallenges.length} mismatches: ${summary}`,
    );
  }

  return challenges;
}

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildBannerAsset() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="${escapeSvgText(CAMPAIGN_NAME)}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff7e3"/>
          <stop offset="48%" stop-color="#ffd7e7"/>
          <stop offset="100%" stop-color="#c6ecff"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bg)"/>
      <circle cx="1310" cy="180" r="200" fill="#ffffff" fill-opacity="0.36"/>
      <circle cx="1180" cy="720" r="150" fill="#fff4ae" fill-opacity="0.4"/>
      <circle cx="300" cy="720" r="250" fill="#ffffff" fill-opacity="0.24"/>
      <g transform="translate(116, 126)">
        <rect width="840" height="290" rx="44" fill="#fffaf3" fill-opacity="0.86"/>
        <text x="52" y="102" fill="#6c4020" font-family="Arial, sans-serif" font-size="60" font-weight="700">${escapeSvgText(
          CAMPAIGN_DISPLAY_TITLE,
        )}</text>
        <text x="52" y="168" fill="#7e5635" font-family="Arial, sans-serif" font-size="34" font-weight="500">Starts March 31, 2026 and runs through April 30, 2026.</text>
        <text x="52" y="220" fill="#7e5635" font-family="Arial, sans-serif" font-size="30" font-weight="400">100 challenges, 3 stars to advance, and Easter egg rewards all month long.</text>
        <text x="52" y="266" fill="#7e5635" font-family="Arial, sans-serif" font-size="28" font-weight="400">Unlock easy at 33 clears, medium at 66, and the full pack at 100.</text>
      </g>
      <g transform="translate(1060 360)">
        <ellipse cx="170" cy="240" rx="180" ry="224" fill="#fff9f2"/>
        <path d="M170 28 C246 28, 310 136, 310 236 C310 360, 240 430, 170 430 C100 430, 30 360, 30 236 C30 136, 94 28, 170 28Z" fill="#ffefb0"/>
        <path d="M105 132 C146 102, 198 100, 242 134" fill="none" stroke="#ff93c7" stroke-width="18" stroke-linecap="round"/>
        <path d="M96 214 C148 178, 202 178, 248 212" fill="none" stroke="#88d4ff" stroke-width="18" stroke-linecap="round"/>
        <path d="M92 300 C140 264, 206 262, 252 296" fill="none" stroke="#a5db82" stroke-width="18" stroke-linecap="round"/>
        <path d="M116 344 C148 330, 194 328, 226 342" fill="none" stroke="#ffbe66" stroke-width="18" stroke-linecap="round"/>
      </g>
    </svg>
  `;

  return svgDataUri(svg.trim());
}

function buildIconAsset() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Simple decorated Easter egg">
      <defs>
        <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffe9a8"/>
          <stop offset="100%" stop-color="#ffc5dd"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#frame)"/>
      <path d="M256 92 C326 92, 384 200, 384 286 C384 381, 323 420, 256 420 C189 420, 128 381, 128 286 C128 200, 186 92, 256 92Z" fill="#fff9f2"/>
      <path d="M188 170 C214 148, 236 140, 256 140 C286 140, 311 152, 334 174" fill="none" stroke="#ff98ca" stroke-width="20" stroke-linecap="round"/>
      <path d="M178 236 C214 212, 242 204, 256 204 C282 204, 308 214, 336 236" fill="none" stroke="#7fd0ff" stroke-width="20" stroke-linecap="round"/>
      <path d="M174 302 C214 274, 244 268, 256 268 C286 268, 314 278, 340 302" fill="none" stroke="#a5dc7d" stroke-width="20" stroke-linecap="round"/>
      <path d="M186 356 C212 338, 236 330, 256 330 C284 330, 310 340, 332 358" fill="none" stroke="#ffcc6a" stroke-width="20" stroke-linecap="round"/>
      <circle cx="214" cy="134" r="12" fill="#ff98ca"/>
      <circle cx="298" cy="152" r="10" fill="#7fd0ff"/>
      <circle cx="232" cy="388" r="10" fill="#a5dc7d"/>
      <circle cx="302" cy="372" r="12" fill="#ffcc6a"/>
    </svg>
  `;

  return svgDataUri(svg.trim());
}

async function upsertPack(client: ReturnType<typeof createSupabaseClient>) {
  const { data: existingPacks, error: lookupError } = await client
    .from('word_packs')
    .select('id')
    .eq('name', PACK_NAME)
    .order('created_at', { ascending: false })
    .limit(1);

  if (lookupError) {
    throw new Error(`Unable to look up the Easter pack: ${lookupError.message}`);
  }

  const existingPack = ((existingPacks as ExistingPackRow[] | null) ?? [])[0] ?? null;

  if (existingPack) {
    const { error: updateError } = await client
      .from('word_packs')
      .update({
        description: PACK_DESCRIPTION,
        is_free: false,
        unlock_tier: null,
      })
      .eq('id', existingPack.id);

    if (updateError) {
      throw new Error(`Unable to update the Easter pack: ${updateError.message}`);
    }

    const { error: deleteWordsError } = await client
      .from('words')
      .delete()
      .eq('pack_id', existingPack.id);

    if (deleteWordsError) {
      throw new Error(`Unable to clear existing Easter pack words: ${deleteWordsError.message}`);
    }

    return existingPack.id;
  }

  const { data: insertedPack, error: insertError } = await client
    .from('word_packs')
    .insert({
      name: PACK_NAME,
      description: PACK_DESCRIPTION,
      is_free: false,
      unlock_tier: null,
    })
    .select('id')
    .single();

  if (insertError || !insertedPack) {
    throw new Error(`Unable to create the Easter pack: ${insertError?.message || 'Unknown error.'}`);
  }

  return (insertedPack as ExistingPackRow).id;
}

async function upsertCampaign(
  client: ReturnType<typeof createSupabaseClient>,
  packId: string,
) {
  const { data: existingCampaigns, error: lookupError } = await client
    .from('campaigns')
    .select('id')
    .eq('theme', CAMPAIGN_THEME)
    .eq('start_date', START_DATE)
    .order('start_date', { ascending: false })
    .limit(1);

  if (lookupError) {
    throw new Error(`Unable to look up the Easter campaign: ${lookupError.message}`);
  }

  const existingCampaign = ((existingCampaigns as ExistingCampaignRow[] | null) ?? [])[0] ?? null;

  if (existingCampaign) {
    const { error: updateError } = await client
      .from('campaigns')
      .update({
        name: CAMPAIGN_NAME,
        theme: CAMPAIGN_THEME,
        start_date: START_DATE,
        end_date: END_DATE,
        is_active: true,
        reward_pack_id: packId,
        easy_unlock_completed_count: EASY_PACK_UNLOCK_COUNT,
        medium_unlock_completed_count: MEDIUM_PACK_UNLOCK_COUNT,
        hard_unlock_completed_count: HARD_PACK_UNLOCK_COUNT,
        config: {
          source_pack_name: PACK_NAME,
          source_pack_unlock_thresholds: {
            easy: EASY_PACK_UNLOCK_COUNT,
            medium: MEDIUM_PACK_UNLOCK_COUNT,
            hard: HARD_PACK_UNLOCK_COUNT,
          },
          currency: {
            resource_type: CAMPAIGN_CURRENCY_RESOURCE_TYPE,
            singular_name: CAMPAIGN_CURRENCY_SINGULAR_NAME,
            plural_name: CAMPAIGN_CURRENCY_PLURAL_NAME,
            pack_costs: CAMPAIGN_PACK_UNLOCK_COSTS,
          },
          easy_word_count: 100,
          medium_word_count: 100,
          hard_word_count: 100,
          selected_challenges: CAMPAIGN_SELECTION_COUNTS,
        },
      })
      .eq('id', existingCampaign.id);

    if (updateError) {
      throw new Error(`Unable to update the Easter campaign: ${updateError.message}`);
    }

    const { error: deleteChallengesError } = await client
      .from('campaign_challenges')
      .delete()
      .eq('campaign_id', existingCampaign.id);

    if (deleteChallengesError) {
      throw new Error(`Unable to clear existing Easter campaign challenges: ${deleteChallengesError.message}`);
    }

    const { error: deleteAssetsError } = await client
      .from('campaign_assets')
      .delete()
      .eq('campaign_id', existingCampaign.id);

    if (deleteAssetsError) {
      throw new Error(`Unable to clear existing Easter campaign assets: ${deleteAssetsError.message}`);
    }

    return existingCampaign.id;
  }

  const { data: insertedCampaign, error: insertError } = await client
    .from('campaigns')
    .insert({
      name: CAMPAIGN_NAME,
      theme: CAMPAIGN_THEME,
      start_date: START_DATE,
      end_date: END_DATE,
      is_active: true,
      reward_pack_id: packId,
      easy_unlock_completed_count: EASY_PACK_UNLOCK_COUNT,
      medium_unlock_completed_count: MEDIUM_PACK_UNLOCK_COUNT,
      hard_unlock_completed_count: HARD_PACK_UNLOCK_COUNT,
      config: {
        source_pack_name: PACK_NAME,
        source_pack_unlock_thresholds: {
          easy: EASY_PACK_UNLOCK_COUNT,
          medium: MEDIUM_PACK_UNLOCK_COUNT,
          hard: HARD_PACK_UNLOCK_COUNT,
        },
        currency: {
          resource_type: CAMPAIGN_CURRENCY_RESOURCE_TYPE,
          singular_name: CAMPAIGN_CURRENCY_SINGULAR_NAME,
          plural_name: CAMPAIGN_CURRENCY_PLURAL_NAME,
          pack_costs: CAMPAIGN_PACK_UNLOCK_COSTS,
        },
        easy_word_count: 100,
        medium_word_count: 100,
        hard_word_count: 100,
        selected_challenges: CAMPAIGN_SELECTION_COUNTS,
      },
    })
    .select('id')
    .single();

  if (insertError || !insertedCampaign) {
    throw new Error(`Unable to create the Easter campaign: ${insertError?.message || 'Unknown error.'}`);
  }

  return (insertedCampaign as ExistingCampaignRow).id;
}

async function seedEasterCampaign() {
  await hydrateEnvironment();

  const client = createSupabaseClient();
  const easyWords = assertDifficultyBucket(
    assertExactUniqueCount(buildEasyWords(), 100, 'Easy'),
    'easy',
    'Easy',
  );
  const mediumWords = assertDifficultyBucket(
    assertExactUniqueCount(buildMediumWords(), 100, 'Medium'),
    'medium',
    'Medium',
  );
  const hardWords = assertDifficultyBucket(
    assertExactUniqueCount(buildHardWords(), 100, 'Hard'),
    'hard',
    'Hard',
  );

  assertNoCrossBucketDuplicates({
    easy: easyWords,
    medium: mediumWords,
    hard: hardWords,
  });

  const packId = await upsertPack(client);
  const wordRows: WordRow[] = [
    ...toWordRows(packId, easyWords, 'easy'),
    ...toWordRows(packId, mediumWords, 'medium'),
    ...toWordRows(packId, hardWords, 'hard'),
  ];

  const { error: insertWordsError } = await client.from('words').insert(wordRows);

  if (insertWordsError) {
    throw new Error(`Unable to insert Easter pack words: ${insertWordsError.message}`);
  }

  const campaignId = await upsertCampaign(client, packId);
  const challengeRows = buildChallengePlan(campaignId, easyWords, mediumWords, hardWords);
  const assetRows: CampaignAssetRow[] = [
    { campaign_id: campaignId, key: 'title', value: CAMPAIGN_DISPLAY_TITLE },
    { campaign_id: campaignId, key: 'subtitle', value: CAMPAIGN_SUBTITLE },
    { campaign_id: campaignId, key: 'banner_image', value: buildBannerAsset() },
    { campaign_id: campaignId, key: 'challenge_icon', value: buildIconAsset() },
  ];

  const { error: insertChallengesError } = await client.from('campaign_challenges').insert(challengeRows);

  if (insertChallengesError) {
    throw new Error(`Unable to insert Easter campaign challenges: ${insertChallengesError.message}`);
  }

  const { error: insertAssetsError } = await client.from('campaign_assets').insert(assetRows);

  if (insertAssetsError) {
    throw new Error(`Unable to insert Easter campaign assets: ${insertAssetsError.message}`);
  }

  const { error: deactivateError } = await client
    .from('campaigns')
    .update({ is_active: false })
    .neq('id', campaignId)
    .eq('is_active', true);

  if (deactivateError) {
    throw new Error(`Unable to deactivate older active campaigns: ${deactivateError.message}`);
  }

  return {
    campaignId,
    packId,
    wordCounts: {
      easy: easyWords.length,
      medium: mediumWords.length,
      hard: hardWords.length,
    },
    selectedChallengeCounts: {
      easy: CAMPAIGN_SELECTION_COUNTS.easy,
      medium: CAMPAIGN_SELECTION_COUNTS.medium,
      hard: CAMPAIGN_SELECTION_COUNTS.hard,
    },
  };
}

async function main() {
  const result = await seedEasterCampaign();

  console.log(
    `Seeded ${CAMPAIGN_NAME} (${result.campaignId}) and ${PACK_NAME} (${result.packId}) with 100 easy, 100 medium, and 100 hard phrases.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { seedEasterCampaign };
