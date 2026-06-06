import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CAMPAIGN_SCORING_CONFIG } from '../src/features/campaign/lmPrior';
import {
  cleanPackTexts,
  computeDifficulty,
  normalizePackText,
} from '../src/utils/difficulty';
import { withCampaignChallengeLmPriors } from './campaignLm';

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

interface CandidateWord {
  text: string;
  score: number;
}

const PACK_NAME = 'Summer Fun Pack';
const PACK_DESCRIPTION =
  'A summer-themed pack with 100 easy, 100 medium, and 100 hard phrases. Clear 33 campaign challenges to unlock easy words, 66 for medium access, and all 100 for the full pack.';
const CAMPAIGN_NAME = 'Summer Fun Campaign June-August 2026';
const CAMPAIGN_DISPLAY_TITLE = 'Summer Fun';
const CAMPAIGN_THEME = 'summer_fun';
const CAMPAIGN_SUBTITLE =
  '100 summer challenges. Earn 3 stars to open the next treat, with one free try per challenge each day.';
const START_DATE = '2026-06-06T06:00:00.000Z';
const END_DATE = '2026-09-01T05:59:59.000Z';
const EASY_PACK_UNLOCK_COUNT = 33;
const MEDIUM_PACK_UNLOCK_COUNT = 66;
const HARD_PACK_UNLOCK_COUNT = 100;
const CAMPAIGN_CURRENCY_RESOURCE_TYPE = 'summer_ice_cream_cone';
const CAMPAIGN_CURRENCY_SINGULAR_NAME = 'ice cream cone';
const CAMPAIGN_CURRENCY_PLURAL_NAME = 'ice cream cones';
const CAMPAIGN_PACK_UNLOCK_COSTS = {
  easy: 25,
  medium: 50,
  hard: 150,
} as const;
const CAMPAIGN_SCORING_CONFIG = {
  first_token_add_amount: DEFAULT_CAMPAIGN_SCORING_CONFIG.firstTokenAddAmount,
  lm_weight: DEFAULT_CAMPAIGN_SCORING_CONFIG.lmWeight,
  probability_epsilon: DEFAULT_CAMPAIGN_SCORING_CONFIG.probabilityEpsilon,
} as const;
const CAMPAIGN_SELECTION_COUNTS = {
  easy: 33,
  medium: 33,
  hard: 34,
} as const;
const DIFFICULTY_SCORE_TARGETS: Record<Difficulty, number> = {
  easy: 3.04,
  medium: 5.13,
  hard: 8.69,
};
const DIFFICULTY_AVERAGE_RANGES: Record<Difficulty, { min: number; max: number }> = {
  easy: { min: 2.9, max: 3.2 },
  medium: { min: 4.9, max: 5.4 },
  hard: { min: 8.4, max: 9.1 },
};
const BANNER_ASSET_PATH = 'scripts/assets/summer-fun-banner.png';
const ICON_ASSET_PATH = 'scripts/assets/summer-ice-cream-cone.png';

function buildSeries(prefixes: string[], nouns: string[]) {
  return prefixes.flatMap((prefix) => nouns.map((noun) => `${prefix} ${noun}`));
}

const SUMMER_WORD_CANDIDATES: Record<Difficulty, string[]> = {
  easy: [
    ...buildSeries(
      [
        'red',
        'blue',
        'gold',
        'mint',
        'lime',
        'pink',
        'soft',
        'warm',
        'cool',
        'fresh',
        'sweet',
        'bright',
        'light',
        'sunny',
        'sandy',
      ],
      [
        'cap',
        'fan',
        'hat',
        'mat',
        'sea',
        'sun',
        'boat',
        'camp',
        'cone',
        'dock',
        'kite',
        'lake',
        'pool',
        'sand',
        'surf',
        'tent',
        'wave',
        'shade',
      ],
    ),
    ...[
      'sun',
      'sand',
      'sea',
      'pool',
      'beach',
      'surf',
      'wave',
      'waves',
      'shell',
      'shells',
      'kite',
      'kites',
      'cone',
      'cones',
      'dock',
      'docks',
      'lake',
      'lakes',
      'camp',
      'camps',
      'grill',
      'shade',
      'shades',
      'breeze',
      'melon',
      'lemon',
      'mango',
      'berry',
      'coral',
      'gold',
      'mint',
      'lime',
      'pink',
      'blue',
      'warm',
      'cool',
      'fresh',
      'sweet',
      'bright',
      'soft',
      'happy',
      'lazy',
      'sunny',
      'sandy',
      'salty',
      'tasty',
      'sun hat',
      'sun hats',
      'beach bag',
      'beach bags',
      'beach day',
      'beach mat',
      'beach mats',
      'beach ball',
      'beach cap',
      'beach fan',
      'pool day',
      'pool mat',
      'pool mats',
      'pool cap',
      'pool fan',
      'pool float',
      'pool chair',
      'lake day',
      'lake swim',
      'lake swims',
      'lake dock',
      'lake docks',
      'surf wax',
      'surf shop',
      'sand pail',
      'sand pails',
      'shell bag',
      'shell bags',
      'ice pop',
      'ice pops',
      'snow cone',
      'snow cones',
      'cold drink',
      'hot dog',
      'hot dogs',
      'grill bun',
      'grill buns',
      'yard game',
      'yard games',
      'dock light',
      'boat ride',
      'boat rides',
      'camp mug',
      'camp mugs',
      'tent peg',
      'tent pegs',
      'fan spray',
      'fair day',
      'park day',
      'tide pool',
      'tide pools',
      'shade tent',
      'sweet corn',
      'sweet tea',
      'limeade',
      'sunscreen',
      'flip flop',
      'flip flops',
      'swim cap',
      'swim caps',
      'road map',
      'road maps',
    ],
  ],
  medium: [
    'beach towel',
    'ice cream',
    'lemonade stand',
    'water slide',
    'picnic table',
    'summer camp',
    'sand castle',
    'fresh fruit',
    'melon slices',
    'berry bowl',
    'mango smoothie',
    'ferris wheel',
    'county fair',
    'porch swing',
    'warm breeze',
    'golden sunset',
    'ocean spray',
    'salty air',
    'sandy feet',
    'swim trunks',
    'pool party',
    'patio lights',
    'starry night',
    'camping trip',
    'fishing dock',
    'canoe ride',
    'kayak paddle',
    'river float',
    'garden hose',
    'sprinkler run',
    'water balloon',
    'summer playlist',
    'travel cooler',
    'beach umbrella',
    'lifeguard chair',
    'cabin porch',
    'tent zipper',
    'picnic basket',
    'burger buns',
    'garden party',
    'lemon slices',
    'ice cubes',
    'sun tea',
    'fruit salad',
    'popsicle stick',
    'shaved ice',
    'banana split',
    'sundae bar',
    'waffle cone',
    'pool noodles',
    'summer rain',
    'thunder clouds',
    'rain puddles',
    'fresh towels',
    'wet swimsuit',
    'dry sandals',
    'vacation photos',
    'souvenir shop',
    'arcade tokens',
    'mini golf',
    'splash pad',
    'water park',
    'lazy river',
    'summer movie',
    'porch music',
    'backyard lights',
    'evening swim',
    'firefly jar',
    'night market',
    'street tacos',
    'food truck',
    'music festival',
    'baseball game',
    'ticket booth',
    'cotton candy',
    'fair prizes',
    'roller coaster',
    'beach picnic',
    'pool picnic',
    'lake picnic',
    'camp picnic',
    'sunset picnic',
    'boardwalk snack',
    'boardwalk photo',
    'boardwalk music',
    'boardwalk lights',
    'summer postcard',
    'summer market',
    'summer sundae',
    'summer smoothie',
    'summer bonfire',
    'beach morning',
    'beach sunset',
    'pool morning',
    'pool sunset',
    'lake morning',
    'lake sunset',
    'camp morning',
    'camp lantern',
    'campfire song',
    'campfire smoke',
    'harbor breeze',
    'harbor lights',
    'harbor morning',
    'boat picnic',
    'boat cooler',
    'sailboat ride',
    'sailboat lesson',
    'sprinkler party',
    'backyard movie',
    'backyard dinner',
    'patio dinner',
    'patio games',
    'garden picnic',
    'garden lights',
    'fairground music',
    'carnival ticket',
    'carnival lights',
    'vacation morning',
    'vacation dinner',
    'roadside diner',
    'cooler refill',
    'postcard rack',
    'shell collection',
    'summer bracelet',
    'lemonade pitcher',
    'ice cream scoop',
    'snow cone cup',
    'water park ticket',
    'beach umbrella row',
    'pool noodle race',
    'sunset boat ride',
    'picnic blanket',
    'campground coffee',
  ],
  hard: [
    'summer vacation',
    'beach umbrella row',
    'lemonade porch stand',
    'sunset boardwalk stroll',
    'saltwater taffy shop',
    'watermelon picnic basket',
    'backyard barbecue smoke',
    'fireworks over the lake',
    'lazy river afternoon',
    'ice cream truck melody',
    'sandcastle building contest',
    'colorful beach cabanas',
    'poolside birthday party',
    'campfire marshmallow roast',
    'canoe trip at sunrise',
    'family road trip playlist',
    'postcard from the coast',
    'neighborhood block party',
    'evening porch string lights',
    'county fair ferris wheel',
    'boardwalk arcade tickets',
    'fresh squeezed lemonade',
    'sprinkler race across grass',
    'sun soaked patio lunch',
    'beach towel treasure map',
    'picnic blanket parade',
    'lake house morning coffee',
    'sailboat harbor sunset',
    'summer camp talent show',
    'grilled corn festival',
    'shaved ice rainbow cup',
    'waffle cone celebration',
    'banana split sundae bar',
    'seaside shell collection',
    'tide pool discovery walk',
    'lifeguard chair lookout',
    'kayak paddle adventure',
    'river float reunion',
    'tent zipper wakeup call',
    'cabin porch storytelling',
    'starlit camping lanterns',
    'firefly jar surprise',
    'drive in movie night',
    'water balloon countdown',
    'garden hose rainbow',
    'splash pad celebration',
    'pool noodle relay',
    'travel cooler treasure',
    'souvenir shop postcard',
    'music festival lawn',
    'food truck dinner line',
    'street taco night market',
    'baseball seventh inning',
    'roller coaster photo booth',
    'cotton candy moustache',
    'sun tea glass pitcher',
    'fruit salad centerpiece',
    'popsicle freezer stash',
    'wet swimsuit laundry',
    'vacation photo album',
    'summer rain window',
    'thunderstorm porch watch',
    'ocean spray morning walk',
    'salty air sunrise',
    'sandy feet car ride',
    'golden sunset applause',
    'boat ride singalong',
    'dock lights reflection',
    'fishing dock patience',
    'summer playlist debate',
    'campground pancake breakfast',
    'boardwalk souvenir bracelet',
    'lemon slice ice water',
    'mango smoothie blender',
    'berry bowl breakfast',
    'melon slice contest',
    'hot dog grill station',
    'patio light dance',
    'ferris wheel sunset kiss',
    'barbecue picnic table',
    'water slide countdown',
    'snow cone brain freeze',
    'ice cream cone cheers',
    'porch swing conversation',
    'fair prize collection',
    'arcade token jackpot',
    'summer celebration',
    'summer memory book',
    'summer photo album',
    'sunset celebration',
    'sunset memory book',
    'sunset photo album',
    'tropical adventure',
    'tropical afternoon',
    'tropical gathering',
    'tropical tradition',
    'vacation adventure',
    'vacation afternoon',
    'vacation gathering',
    'vacation tradition',
    'harbor celebration',
    'harbor memory book',
    'harbor photo album',
    'picnic celebration',
    'picnic memory book',
    'picnic photo album',
    'seaside celebration',
    'seaside memory book',
    'seaside photo album',
    'campfire celebration',
    'campfire memory book',
    'campfire photo album',
    'backyard adventure',
    'backyard afternoon',
    'backyard gathering',
    'backyard tradition',
    'carnival adventure',
    'carnival afternoon',
    'carnival gathering',
    'carnival tradition',
    'firework adventure',
    'firework afternoon',
    'firework gathering',
    'firework tradition',
    'lemonade adventure',
    'lemonade afternoon',
    'lemonade gathering',
    'lemonade tradition',
    'boardwalk treasure hunt',
    'campground treasure hunt',
    'ice cream treasure hunt',
    'road trip treasure hunt',
    'sprinkler treasure hunt',
    'boardwalk sunset stroll',
    'campground sunset stroll',
    'ice cream sunset stroll',
    'road trip sunset stroll',
    'sprinkler sunset stroll',
    'boardwalk snack station',
    'campground snack station',
    'ice cream snack station',
    'road trip snack station',
    'sprinkler snack station',
    'boardwalk postcard shop',
    'campground postcard shop',
    'ice cream postcard shop',
    'road trip postcard shop',
    'sprinkler postcard shop',
    'boardwalk lantern walk',
    'campground lantern walk',
    'fairground lantern walk',
    'boardwalk ticket booth',
    'campground ticket booth',
    'fairground ticket booth',
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

function selectWordsForDifficulty(difficulty: Difficulty) {
  const seen = new Set<string>();
  const candidates: CandidateWord[] = [];

  for (const word of SUMMER_WORD_CANDIDATES[difficulty]) {
    const normalizedWord = normalizePackText(word);

    if (!normalizedWord || seen.has(normalizedWord)) {
      continue;
    }

    seen.add(normalizedWord);

    const computed = computeDifficulty(normalizedWord);

    if (computed.difficulty !== difficulty) {
      continue;
    }

    candidates.push({
      text: normalizedWord,
      score: computed.score,
    });
  }

  const targetScore = DIFFICULTY_SCORE_TARGETS[difficulty];

  return candidates
    .sort(
      (left, right) =>
        Math.abs(left.score - targetScore) - Math.abs(right.score - targetScore) ||
        left.text.localeCompare(right.text),
    )
    .slice(0, 100)
    .map((candidate) => candidate.text);
}

function buildEasyWords() {
  return selectWordsForDifficulty('easy');
}

function buildMediumWords() {
  return selectWordsForDifficulty('medium');
}

function buildHardWords() {
  return selectWordsForDifficulty('hard');
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

function assertAverageScore(words: string[], difficulty: Difficulty, label: string) {
  const range = DIFFICULTY_AVERAGE_RANGES[difficulty];
  const averageScore =
    words.reduce((total, word) => total + computeDifficulty(word).score, 0) / words.length;

  if (averageScore < range.min || averageScore > range.max) {
    throw new Error(
      `${label} average difficulty score must be between ${range.min.toFixed(2)} and ${range.max.toFixed(
        2,
      )}. Received ${averageScore.toFixed(2)}.`,
    );
  }

  return averageScore;
}

function assertNoCrossBucketDuplicates(wordsByDifficulty: Record<Difficulty, string[]>) {
  const seen = new Map<string, Difficulty>();

  for (const difficulty of Object.keys(wordsByDifficulty) as Difficulty[]) {
    for (const word of wordsByDifficulty[difficulty]) {
      const normalizedWord = normalizePackText(word);
      const existingDifficulty = seen.get(normalizedWord);

      if (existingDifficulty) {
        throw new Error(
          `Duplicate Summer Fun phrase "${normalizedWord}" found in both ${existingDifficulty} and ${difficulty}.`,
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

async function imageDataUri(path: string) {
  const image = await readFile(path);
  return `data:image/png;base64,${image.toString('base64')}`;
}

async function buildBannerAsset() {
  return imageDataUri(BANNER_ASSET_PATH);
}

async function buildIconAsset() {
  return imageDataUri(ICON_ASSET_PATH);
}

async function upsertPack(client: ReturnType<typeof createSupabaseClient>) {
  const { data: existingPacks, error: lookupError } = await client
    .from('word_packs')
    .select('id')
    .eq('name', PACK_NAME)
    .order('created_at', { ascending: false })
    .limit(1);

  if (lookupError) {
    throw new Error(`Unable to look up the Summer Fun pack: ${lookupError.message}`);
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
      throw new Error(`Unable to update the Summer Fun pack: ${updateError.message}`);
    }

    const { error: deleteWordsError } = await client
      .from('words')
      .delete()
      .eq('pack_id', existingPack.id);

    if (deleteWordsError) {
      throw new Error(`Unable to clear existing Summer Fun pack words: ${deleteWordsError.message}`);
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
    throw new Error(`Unable to create the Summer Fun pack: ${insertError?.message || 'Unknown error.'}`);
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
    throw new Error(`Unable to look up the Summer Fun campaign: ${lookupError.message}`);
  }

  const existingCampaign = ((existingCampaigns as ExistingCampaignRow[] | null) ?? [])[0] ?? null;
  const campaignValues = {
    name: CAMPAIGN_NAME,
    theme: CAMPAIGN_THEME,
    start_date: START_DATE,
    end_date: END_DATE,
    is_active: false,
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
      scoring: CAMPAIGN_SCORING_CONFIG,
      easy_word_count: 100,
      medium_word_count: 100,
      hard_word_count: 100,
      selected_challenges: CAMPAIGN_SELECTION_COUNTS,
      difficulty_score_targets: DIFFICULTY_SCORE_TARGETS,
      difficulty_average_ranges: DIFFICULTY_AVERAGE_RANGES,
    },
  };

  if (existingCampaign) {
    const { error: updateError } = await client
      .from('campaigns')
      .update(campaignValues)
      .eq('id', existingCampaign.id);

    if (updateError) {
      throw new Error(`Unable to update the Summer Fun campaign: ${updateError.message}`);
    }

    const { error: deleteChallengesError } = await client
      .from('campaign_challenges')
      .delete()
      .eq('campaign_id', existingCampaign.id);

    if (deleteChallengesError) {
      throw new Error(`Unable to clear existing Summer Fun campaign challenges: ${deleteChallengesError.message}`);
    }

    const { error: deleteAssetsError } = await client
      .from('campaign_assets')
      .delete()
      .eq('campaign_id', existingCampaign.id);

    if (deleteAssetsError) {
      throw new Error(`Unable to clear existing Summer Fun campaign assets: ${deleteAssetsError.message}`);
    }

    return existingCampaign.id;
  }

  const { data: insertedCampaign, error: insertError } = await client
    .from('campaigns')
    .insert(campaignValues)
    .select('id')
    .single();

  if (insertError || !insertedCampaign) {
    throw new Error(`Unable to create the Summer Fun campaign: ${insertError?.message || 'Unknown error.'}`);
  }

  return (insertedCampaign as ExistingCampaignRow).id;
}

async function seedSummerFunCampaign() {
  await hydrateEnvironment();

  const validatedSource = await validateSummerFunCampaignSource();
  const client = createSupabaseClient();
  const { easyWords, mediumWords, hardWords, averageScores } = validatedSource;

  const packId = await upsertPack(client);
  const wordRows: WordRow[] = [
    ...toWordRows(packId, easyWords, 'easy'),
    ...toWordRows(packId, mediumWords, 'medium'),
    ...toWordRows(packId, hardWords, 'hard'),
  ];

  const { error: insertWordsError } = await client.from('words').insert(wordRows);

  if (insertWordsError) {
    throw new Error(`Unable to insert Summer Fun pack words: ${insertWordsError.message}`);
  }

  const campaignId = await upsertCampaign(client, packId);
  const challengeRows = await withCampaignChallengeLmPriors(
    buildChallengePlan(campaignId, easyWords, mediumWords, hardWords),
  );
  const assetRows: CampaignAssetRow[] = [
    { campaign_id: campaignId, key: 'title', value: CAMPAIGN_DISPLAY_TITLE },
    { campaign_id: campaignId, key: 'subtitle', value: CAMPAIGN_SUBTITLE },
    { campaign_id: campaignId, key: 'banner_image', value: await buildBannerAsset() },
    { campaign_id: campaignId, key: 'challenge_icon', value: await buildIconAsset() },
  ];

  const { error: insertChallengesError } = await client.from('campaign_challenges').insert(challengeRows);

  if (insertChallengesError) {
    throw new Error(`Unable to insert Summer Fun campaign challenges: ${insertChallengesError.message}`);
  }

  const { error: insertAssetsError } = await client.from('campaign_assets').insert(assetRows);

  if (insertAssetsError) {
    throw new Error(`Unable to insert Summer Fun campaign assets: ${insertAssetsError.message}`);
  }

  const { error: activateCampaignError } = await client
    .from('campaigns')
    .update({ is_active: true })
    .eq('id', campaignId);

  if (activateCampaignError) {
    throw new Error(`Unable to activate the Summer Fun campaign: ${activateCampaignError.message}`);
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
    averageScores,
    selectedChallengeCounts: {
      easy: CAMPAIGN_SELECTION_COUNTS.easy,
      medium: CAMPAIGN_SELECTION_COUNTS.medium,
      hard: CAMPAIGN_SELECTION_COUNTS.hard,
    },
  };
}

async function validateSummerFunCampaignSource() {
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

  const averageScores = {
    easy: assertAverageScore(easyWords, 'easy', 'Easy'),
    medium: assertAverageScore(mediumWords, 'medium', 'Medium'),
    hard: assertAverageScore(hardWords, 'hard', 'Hard'),
  };

  return {
    easyWords,
    mediumWords,
    hardWords,
    averageScores,
  };
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    const result = await validateSummerFunCampaignSource();
    await Promise.all([buildBannerAsset(), buildIconAsset()]);
    const challenges = buildChallengePlan(
      '00000000-0000-0000-0000-000000000000',
      result.easyWords,
      result.mediumWords,
      result.hardWords,
    );

    console.log(
      `Dry run passed for ${CAMPAIGN_NAME}: ${result.easyWords.length} easy, ${result.mediumWords.length} medium, ${result.hardWords.length} hard phrases.`,
    );
    console.log(
      `Average difficulty scores: easy ${result.averageScores.easy.toFixed(2)}, medium ${result.averageScores.medium.toFixed(
        2,
      )}, hard ${result.averageScores.hard.toFixed(2)}.`,
    );
    console.log(`Campaign challenge count: ${challenges.length}. No DB rows were changed.`);
    return;
  }

  const result = await seedSummerFunCampaign();

  console.log(
    `Seeded ${CAMPAIGN_NAME} (${result.campaignId}) and ${PACK_NAME} (${result.packId}) with 100 easy, 100 medium, and 100 hard phrases.`,
  );
  console.log(
    `Average difficulty scores: easy ${result.averageScores.easy.toFixed(2)}, medium ${result.averageScores.medium.toFixed(
      2,
    )}, hard ${result.averageScores.hard.toFixed(2)}.`,
  );
  console.log(
    `Campaign challenge mix: ${result.selectedChallengeCounts.easy} easy, ${result.selectedChallengeCounts.medium} medium, ${result.selectedChallengeCounts.hard} hard.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { seedSummerFunCampaign };
