import { RESOURCE_TYPES, type ResourceType } from './resourceTypes';
import { supabase, supabaseConfigError } from './supabase';

interface ResourceRow {
  amount: number;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

export async function getResourceAmount(userId: string, resourceType: ResourceType) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('user_resources')
    .select('amount')
    .eq('user_id', userId)
    .eq('resource_type', resourceType)
    .maybeSingle<ResourceRow>();

  if (error) {
    throw new Error(`Unable to load resource balance: ${error.message}`);
  }

  return data?.amount ?? 0;
}

export async function getCoins(userId: string) {
  return getResourceAmount(userId, RESOURCE_TYPES.BB_COIN);
}
