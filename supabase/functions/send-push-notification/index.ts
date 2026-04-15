import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendPushRequest {
  targetUserId?: string;
  target_user_id?: string;
  user_id?: string;
}

interface PushSubscriptionRow {
  id: string;
  subscription: webpush.PushSubscription;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isStatusError(error: unknown): error is { statusCode?: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

function getTargetUserId(body: SendPushRequest) {
  return body.targetUserId ?? body.target_user_id ?? body.user_id ?? null;
}

function getSubscriptionEndpointHost(subscription: webpush.PushSubscription) {
  try {
    return new URL(subscription.endpoint).host;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ sent: false, error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseAnonKey = getRequiredEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublicKey = getRequiredEnv('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = getRequiredEnv('VAPID_PRIVATE_KEY');
    const vapidSubject =
      Deno.env.get('VAPID_SUBJECT')?.trim() || 'mailto:notifications@example.com';
    console.info('send-push-notification: loaded environment.', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseAnonKey: Boolean(supabaseAnonKey),
      hasSupabaseServiceRoleKey: Boolean(supabaseServiceRoleKey),
      hasVapidPublicKey: Boolean(vapidPublicKey),
      hasVapidPrivateKey: Boolean(vapidPrivateKey),
      vapidSubject,
    });

    const authorization = request.headers.get('Authorization');
    if (!authorization) {
      return jsonResponse({ sent: false, error: 'Missing Authorization header.' }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse(
        {
          sent: false,
          error: authError?.message || 'Unable to validate the Supabase user session.',
        },
        401,
      );
    }
    console.info('send-push-notification: authenticated caller.', {
      userId: user.id,
    });

    const targetUserId = getTargetUserId((await request.json()) as SendPushRequest);
    if (!targetUserId || typeof targetUserId !== 'string') {
      return jsonResponse({ sent: false, error: 'targetUserId is required.' }, 400);
    }
    console.info('send-push-notification: parsed target user.', {
      targetUserId,
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data, error } = await adminClient
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', targetUserId)
      .maybeSingle<PushSubscriptionRow>();

    if (error) {
      throw new Error(`Unable to load the push subscription: ${error.message}`);
    }

    if (!data?.subscription) {
      console.info('send-push-notification: no subscription found.', {
        targetUserId,
      });
      return jsonResponse({ sent: false, reason: 'subscription_not_found' });
    }
    const endpointHost = getSubscriptionEndpointHost(data.subscription);
    if (endpointHost === 'permanently-removed.invalid') {
      await adminClient.from('push_subscriptions').delete().eq('id', data.id);
      console.info('send-push-notification: removed invalid subscription endpoint.', {
        endpointHost,
        targetUserId,
      });
      return jsonResponse({
        sent: false,
        reason: 'invalid_subscription_endpoint',
        error: 'The recipient browser returned an invalid push subscription endpoint.',
      });
    }
    console.info('send-push-notification: loaded subscription.', {
      endpointHost: endpointHost || 'invalid-endpoint',
      targetUserId,
    });

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    console.info('send-push-notification: configured VAPID details.', {
      targetUserId,
    });

    try {
      await webpush.sendNotification(
        data.subscription,
        JSON.stringify({
          title: 'Your turn!',
          body: 'Your friend sent you a clip \uD83C\uDFA4',
        }),
      );
    } catch (error) {
      if (isStatusError(error) && (error.statusCode === 404 || error.statusCode === 410)) {
        await adminClient.from('push_subscriptions').delete().eq('id', data.id);

        return jsonResponse({
          sent: false,
          reason: 'subscription_expired',
        });
      }

      throw error;
    }
    console.info('send-push-notification: notification sent.', {
      targetUserId,
    });

    return jsonResponse({ sent: true });
  } catch (error) {
    console.error('send-push-notification: unhandled error.', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    return jsonResponse(
      {
        sent: false,
        error: error instanceof Error ? error.message : 'Unknown error.',
      },
      500,
    );
  }
});
