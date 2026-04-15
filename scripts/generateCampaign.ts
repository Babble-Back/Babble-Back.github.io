import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type Difficulty = 'easy' | 'medium' | 'hard';
type CampaignMode = 'normal' | 'reverse_only';

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

interface CampaignRow {
  id: string;
  name: string | null;
  theme: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean | null;
  config: Record<string, unknown> | null;
}

interface GenerateCampaignOptions {
  name?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  uploadBucket?: string;
}

interface GenerateCampaignCliOptions extends GenerateCampaignOptions {
  theme?: string;
}

interface GeneratedAsset {
  key: string;
  value: string;
}

interface PhraseBank {
  easy: string[];
  medium: string[];
  hard: string[];
}

const DEFAULT_UPLOAD_BUCKET = process.env.CAMPAIGN_ASSET_BUCKET?.trim() || '';

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

function parseCliArgs(argv: string[]): GenerateCampaignCliOptions {
  const options: GenerateCampaignCliOptions = {};

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
      if (!options.theme) {
        options.theme = arg;
      }
      continue;
    }

    const [flag, inlineValue] = arg.split('=', 2);

    switch (flag) {
      case '--theme':
        options.theme = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--name':
        options.name = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--start-date':
        options.startDate = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--end-date':
        options.endDate = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--upload-bucket':
        options.uploadBucket = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--active':
        options.active =
          inlineValue === undefined ? readFlagValue(flag, inlineValue, index) !== 'false' : inlineValue !== 'false';
        if (inlineValue === undefined) index += 1;
        break;
      case '--inactive':
        options.active = false;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return options;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function toTitleCase(value: string) {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function slugify(value: string) {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'campaign';
}

function buildMonthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

function formatCampaignName(theme: string, startDate: string) {
  const themeLabel = toTitleCase(theme);
  const monthLabel = new Date(startDate).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `${themeLabel} Campaign ${monthLabel}`;
}

function createPhraseBank(themeLabel: string): PhraseBank {
  const easyPrefixes = ['soft', 'bright', 'gentle', 'pastel'];
  const easyNouns = [
    'egg basket',
    'garden path',
    'spring ribbon',
    'bunny hop',
    'flower field',
    'sunny trail',
    'color swirl',
    'kind breeze',
    'warm sparkle',
    'tiny parade',
  ];

  const mediumPrefixes = ['glowing', 'spiral', 'playful'];
  const mediumNouns = [
    'lantern trail',
    'chocolate garden',
    'hidden nest',
    'crystal meadow',
    'floating basket',
    'shimmer bridge',
    'marble bloom',
    'sunrise chorus',
    'velvet garden',
    'storybook hop',
  ];

  const hardPrefixes = ['electric', 'midnight', 'radiant'];
  const hardNouns = [
    'egg labyrinth',
    'moonlit carousel',
    'glimmer circuit',
    'twisted ribbon',
    'horizon orchard',
    'prism tunnel',
    'echo festival',
    'lantern skyline',
    'vivid cipher',
    'festival comet',
  ];

  const buildSeries = (prefixes: string[], nouns: string[]) =>
    prefixes.flatMap((prefix) => nouns.map((noun) => `${themeLabel} ${prefix} ${noun}`));

  return {
    easy: buildSeries(easyPrefixes, easyNouns),
    medium: buildSeries(mediumPrefixes, mediumNouns),
    hard: buildSeries(hardPrefixes, hardNouns),
  };
}

function buildChallengePlan(theme: string) {
  const themeLabel = toTitleCase(theme);
  const bank = createPhraseBank(themeLabel);
  const difficultySequence: Difficulty[] = [
    ...Array.from({ length: 40 }, () => 'easy' as const),
    ...Array.from({ length: 30 }, () => 'medium' as const),
    ...Array.from({ length: 30 }, () => 'hard' as const),
  ];

  let easyIndex = 0;
  let mediumIndex = 0;
  let hardIndex = 0;

  return difficultySequence.map((difficulty, index) => {
    let phrase = '';

    if (difficulty === 'easy') {
      phrase = bank.easy[easyIndex] ?? bank.easy[easyIndex % bank.easy.length] ?? `${themeLabel} easy challenge`;
      easyIndex += 1;
    } else if (difficulty === 'medium') {
      phrase =
        bank.medium[mediumIndex] ?? bank.medium[mediumIndex % bank.medium.length] ?? `${themeLabel} medium challenge`;
      mediumIndex += 1;
    } else {
      phrase = bank.hard[hardIndex] ?? bank.hard[hardIndex % bank.hard.length] ?? `${themeLabel} hard challenge`;
      hardIndex += 1;
    }

    const challengeNumber = index + 1;
    const reverseOnly =
      challengeNumber === 33 ||
      challengeNumber === 100 ||
      (difficulty === 'medium' && mediumIndex % 10 === 0) ||
      (difficulty === 'hard' && hardIndex % 5 === 0);

    return {
      challenge_index: challengeNumber,
      phrase,
      difficulty,
      mode: reverseOnly ? 'reverse_only' : 'normal',
    } satisfies Omit<CampaignChallengeRow, 'campaign_id'>;
  });
}

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createFallbackBannerAsset(theme: string, campaignName: string) {
  const themeLabel = toTitleCase(theme);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" role="img" aria-label="${campaignName}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fef7e7"/>
          <stop offset="52%" stop-color="#f6d9a8"/>
          <stop offset="100%" stop-color="#f9b7c8"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bg)"/>
      <circle cx="1260" cy="160" r="210" fill="url(#glow)"/>
      <circle cx="250" cy="680" r="280" fill="#ffffff" fill-opacity="0.2"/>
      <circle cx="1320" cy="700" r="180" fill="#ffffff" fill-opacity="0.16"/>
      <g fill="none" stroke="#fff8ea" stroke-width="28" stroke-linecap="round">
        <path d="M260 650 C420 520, 610 520, 760 670"/>
        <path d="M980 170 C1080 120, 1220 120, 1320 190"/>
      </g>
      <g transform="translate(110, 130)">
        <rect x="0" y="0" width="780" height="240" rx="40" fill="#fff7ef" fill-opacity="0.82"/>
        <text x="52" y="92" fill="#5f3a1a" font-family="Arial, sans-serif" font-size="56" font-weight="700">${escapeSvgText(
          campaignName,
        )}</text>
        <text x="52" y="155" fill="#7d5531" font-family="Arial, sans-serif" font-size="30" font-weight="500">${escapeSvgText(
          themeLabel,
        )}</text>
        <text x="52" y="205" fill="#7d5531" font-family="Arial, sans-serif" font-size="26" font-weight="400">100 ordered challenges, unlocked one step at a time.</text>
      </g>
      <g transform="translate(1090 430)">
        <ellipse cx="150" cy="210" rx="170" ry="215" fill="#ffffff" fill-opacity="0.9"/>
        <path d="M150 30 C220 30, 280 130, 280 220 C280 340, 220 390, 150 390 C80 390, 20 340, 20 220 C20 130, 80 30, 150 30Z" fill="#ffdc8a"/>
        <path d="M90 120 C125 92, 180 92, 210 120" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>
        <path d="M88 200 C135 165, 172 165, 215 198" fill="none" stroke="#f67ea8" stroke-width="16" stroke-linecap="round"/>
        <path d="M84 286 C130 250, 178 252, 218 282" fill="none" stroke="#7cc6ff" stroke-width="16" stroke-linecap="round"/>
      </g>
    </svg>
  `;

  return svgDataUri(svg.trim());
}

function createFallbackIconAsset(theme: string) {
  const themeLabel = toTitleCase(theme);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${themeLabel} challenge icon">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffe7a7"/>
          <stop offset="100%" stop-color="#f8a6d9"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#bg)"/>
      <path d="M256 92 C326 92, 384 200, 384 286 C384 381, 323 420, 256 420 C189 420, 128 381, 128 286 C128 200, 186 92, 256 92Z" fill="#fff7ef"/>
      <path d="M195 210 C216 193, 238 188, 256 188 C283 188, 306 198, 328 218" fill="none" stroke="#ff9ac8" stroke-width="22" stroke-linecap="round"/>
      <path d="M186 286 C216 266, 240 260, 256 260 C282 260, 304 268, 327 287" fill="none" stroke="#7cc6ff" stroke-width="22" stroke-linecap="round"/>
      <path d="M182 354 C215 333, 240 326, 256 326 C281 326, 305 334, 330 352" fill="none" stroke="#ffcd65" stroke-width="22" stroke-linecap="round"/>
      <text x="256" y="482" fill="#5f3a1a" font-family="Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle">${escapeSvgText(
        themeLabel,
      )}</text>
    </svg>
  `;

  return svgDataUri(svg.trim());
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseDataUri(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;base64)?,(.*)$/s);

  if (!match) {
    return null;
  }

  const mimeType = match[1] || 'text/plain';
  const payload = match[2] || '';
  const isBase64 = value.includes(';base64,');

  return {
    mimeType,
    bytes: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
  };
}

function guessExtension(source: string, mimeType: string | null) {
  if (source.startsWith('data:image/svg+xml')) {
    return 'svg';
  }

  if (mimeType?.includes('svg')) {
    return 'svg';
  }

  if (mimeType?.includes('png')) {
    return 'png';
  }

  return 'png';
}

async function openAiImageToAsset(prompt: string, fallback: string, size: '1536x1024' | '1024x1024') {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return fallback;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1.5',
        prompt,
        size,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI image request failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const firstImage = payload.data?.[0];

    if (firstImage?.b64_json) {
      return `data:image/png;base64,${firstImage.b64_json}`;
    }

    if (firstImage?.url) {
      return firstImage.url;
    }
  } catch (error) {
    console.warn('OpenAI image generation failed. Falling back to the local asset.', error);
  }

  return fallback;
}

async function uploadAssetIfRequested(
  client: ReturnType<typeof createSupabaseClient>,
  bucket: string,
  path: string,
  value: string,
) {
  try {
    let bytes: Buffer | ArrayBuffer | Uint8Array | null = null;
    let contentType = 'image/png';

    const parsedDataUri = parseDataUri(value);

    if (parsedDataUri) {
      bytes = parsedDataUri.bytes;
      contentType = parsedDataUri.mimeType;
    } else if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value);

      if (!response.ok) {
        throw new Error(`Asset download failed with ${response.status}`);
      }

      contentType = response.headers.get('content-type')?.trim() || contentType;
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      return value;
    }

    const { error } = await client.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: true,
    });

    if (error) {
      throw error;
    }

    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl || value;
  } catch (error) {
    console.warn(`Unable to upload campaign asset to bucket "${bucket}". Using the local value.`, error);
    return value;
  }
}

function buildAssetPrompt(theme: string, kind: 'banner' | 'icon') {
  const themeLabel = toTitleCase(theme);

  if (kind === 'banner') {
    return `Mobile game banner, ${themeLabel} theme, pastel eggs, glowing UI, premium Easter event art, wide composition, generous empty space for title text, no watermark`;
  }

  return `Minimal colorful Easter egg icon, clean game UI asset, centered composition, polished and readable at small sizes, no text, no watermark`;
}

async function buildCampaignAssets(
  client: ReturnType<typeof createSupabaseClient>,
  campaignId: string,
  campaignName: string,
  theme: string,
  uploadBucket: string,
): Promise<GeneratedAsset[]> {
  const campaignSlug = slugify(campaignName);
  const bannerFallback = createFallbackBannerAsset(theme, campaignName);
  const iconFallback = createFallbackIconAsset(theme);

  const bannerSource = await openAiImageToAsset(buildAssetPrompt(theme, 'banner'), bannerFallback, '1536x1024');
  const iconSource = await openAiImageToAsset(buildAssetPrompt(theme, 'icon'), iconFallback, '1024x1024');

  const assets: GeneratedAsset[] = [
    { key: 'title', value: campaignName },
    {
      key: 'subtitle',
      value: '100 ordered challenges. Complete them sequentially to unlock the campaign road.',
    },
    { key: 'banner_image', value: bannerSource },
    { key: 'challenge_icon', value: iconSource },
  ];

  if (!uploadBucket) {
    return assets;
  }

  const uploadedAssets: GeneratedAsset[] = [];

  for (const asset of assets) {
    if (asset.key === 'title' || asset.key === 'subtitle') {
      uploadedAssets.push(asset);
      continue;
    }

    const uploadedValue = await uploadAssetIfRequested(
      client,
      uploadBucket,
      `campaigns/${campaignSlug}/${campaignId}/${asset.key}.${guessExtension(
        asset.value,
        parseDataUri(asset.value)?.mimeType ?? null,
      )}`,
      asset.value,
    );

    uploadedAssets.push({ ...asset, value: uploadedValue });
  }

  return uploadedAssets;
}

async function insertCampaignWithChildren(
  client: ReturnType<typeof createSupabaseClient>,
  theme: string,
  options: GenerateCampaignOptions,
) {
  const normalizedTheme = normalizeWhitespace(theme);

  if (!normalizedTheme) {
    throw new Error('A non-empty theme is required.');
  }

  const startAndEnd = buildMonthRange();
  const startDate = options.startDate?.trim() || startAndEnd.startDate;
  const endDate = options.endDate?.trim() || startAndEnd.endDate;
  const campaignName = options.name?.trim() || formatCampaignName(normalizedTheme, startDate);
  const campaignConfig = {
    generated_at: new Date().toISOString(),
    generated_by: 'scripts/generateCampaign.ts',
    theme: normalizedTheme,
    challenge_count: 100,
    mode_distribution: {
      normal: 'all remaining challenges',
      reverse_only: ['challenge 33', 'every 10th medium', 'every 5th hard', 'final challenge'],
    },
  };

  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .insert({
      name: campaignName,
      theme: normalizedTheme,
      start_date: startDate,
      end_date: endDate,
      is_active: options.active ?? true,
      config: campaignConfig,
    })
    .select('id, name, theme, start_date, end_date, is_active, config')
    .single();

  if (campaignError || !campaign) {
    throw new Error(`Unable to create the campaign: ${campaignError?.message || 'Unknown error.'}`);
  }

  const generatedCampaign = campaign as CampaignRow;
  const challengePlan = buildChallengePlan(normalizedTheme).map((challenge) => ({
    ...challenge,
    campaign_id: generatedCampaign.id,
  }));

  const { error: challengeError } = await client.from('campaign_challenges').insert(challengePlan);

  if (challengeError) {
    await client.from('campaigns').delete().eq('id', generatedCampaign.id);
    throw new Error(`Unable to insert campaign challenges: ${challengeError.message}`);
  }

  const assets = await buildCampaignAssets(
    client,
    generatedCampaign.id,
    generatedCampaign.name || campaignName,
    normalizedTheme,
    options.uploadBucket?.trim() || DEFAULT_UPLOAD_BUCKET,
  );

  const assetRows: CampaignAssetRow[] = assets.map((asset) => ({
    campaign_id: generatedCampaign.id,
    key: asset.key,
    value: asset.value,
  }));

  const { error: assetError } = await client.from('campaign_assets').insert(assetRows);

  if (assetError) {
    await client.from('campaign_challenges').delete().eq('campaign_id', generatedCampaign.id);
    await client.from('campaigns').delete().eq('id', generatedCampaign.id);
    throw new Error(`Unable to insert campaign assets: ${assetError.message}`);
  }

  return {
    campaign: generatedCampaign,
    challenges: challengePlan,
    assets,
  };
}

export async function generateCampaign(theme: string, options: GenerateCampaignOptions = {}) {
  await hydrateEnvironment();

  const client = createSupabaseClient();
  const result = await insertCampaignWithChildren(client, theme, options);

  return result;
}

async function main() {
  await hydrateEnvironment();

  const options = parseCliArgs(process.argv.slice(2));

  if (!options.theme) {
    throw new Error('Missing required theme. Pass it as the first argument or with --theme.');
  }

  const result = await generateCampaign(options.theme, options);

  console.log(
    `Created campaign "${result.campaign.name ?? 'Unnamed campaign'}" (${result.campaign.id}) with ${result.challenges.length} challenges and ${result.assets.length} assets.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
