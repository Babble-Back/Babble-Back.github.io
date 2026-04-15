import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { backfillCampaignLmPriorsForChallenges } from './campaignLm';

interface BackfillCliOptions {
  activeOnly?: boolean;
  campaignId?: string;
  challengeId?: string;
  name?: string;
  theme?: string;
}

interface CampaignChallengeLookupRow {
  campaign_id: string;
  campaigns?:
    | {
        is_active: boolean | null;
        name: string | null;
        theme: string | null;
      }
    | Array<{
        is_active: boolean | null;
        name: string | null;
        theme: string | null;
      }>
    | null;
  id: string;
  phrase: string;
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

function parseCliArgs(argv: string[]): BackfillCliOptions {
  const options: BackfillCliOptions = {
    activeOnly: true,
    theme: 'easter',
  };

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
    const [flag, inlineValue] = arg.split('=', 2);

    switch (flag) {
      case '--campaign-id':
        options.campaignId = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--theme':
        options.theme = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--challenge-id':
        options.challengeId = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--name':
        options.name = readFlagValue(flag, inlineValue, index);
        if (inlineValue === undefined) index += 1;
        break;
      case '--all':
        options.activeOnly = false;
        break;
      case '--active-only':
        options.activeOnly = inlineValue === undefined ? true : inlineValue !== 'false';
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return options;
}

async function loadChallengesForBackfill(
  client: ReturnType<typeof createSupabaseClient>,
  options: BackfillCliOptions,
) {
  let query = client
    .from('campaign_challenges')
    .select('id, phrase, campaign_id, campaigns!inner(name, theme, is_active)')
    .order('campaign_id', { ascending: true })
    .order('challenge_index', { ascending: true });

  if (options.challengeId?.trim()) {
    query = query.eq('id', options.challengeId.trim());
  }

  if (options.campaignId?.trim()) {
    query = query.eq('campaign_id', options.campaignId.trim());
  } else {
    if (options.theme?.trim()) {
      query = query.eq('campaigns.theme', options.theme.trim());
    }

    if (options.name?.trim()) {
      query = query.eq('campaigns.name', options.name.trim());
    }

    if (options.activeOnly) {
      query = query.eq('campaigns.is_active', true);
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load campaign challenges for LM backfill: ${error.message}`);
  }

  return ((data as unknown as CampaignChallengeLookupRow[] | null) ?? []).map((row) => ({
    ...row,
    campaigns: Array.isArray(row.campaigns) ? row.campaigns[0] ?? null : row.campaigns ?? null,
  }));
}

export async function backfillCampaignLmPriors(options: BackfillCliOptions = {}) {
  await hydrateEnvironment();

  const client = createSupabaseClient();
  const resolvedOptions: BackfillCliOptions = {
    activeOnly: true,
    theme: 'easter',
    ...options,
  };
  const challengeRows = await loadChallengesForBackfill(client, resolvedOptions);

  if (!challengeRows.length) {
    return {
      challengeCount: 0,
      failureCount: 0,
      failures: [],
      successCount: 0,
    };
  }

  const result = await backfillCampaignLmPriorsForChallenges(client, challengeRows);

  return {
    challengeCount: challengeRows.length,
    ...result,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await backfillCampaignLmPriors(options);

  if (!result.challengeCount) {
    console.log('No campaign challenges matched the requested LM backfill scope.');
    return;
  }

  console.log(
    `Backfilled LM priors for ${result.successCount}/${result.challengeCount} campaign challenges.`,
  );

  if (result.failureCount > 0) {
    console.error(`Failed to backfill ${result.failureCount} challenge(s):`);

    for (const failure of result.failures) {
      console.error(`- ${failure.challengeId} :: ${failure.phrase} :: ${failure.message}`);
    }

    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
