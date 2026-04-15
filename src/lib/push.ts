import { supabase, supabaseConfigError } from './supabase';

const PUSH_SESSION_KEY_PREFIX = 'push-subscription-ready:';
const PUSH_DEBUG_PREFIX = '[push]';
const PUSH_DEBUG_STORAGE_KEY = 'push-debug';

export type PushSyncStatus =
  | 'disabled'
  | 'enabled'
  | 'needs-permission'
  | 'unsupported'
  | 'denied';

export interface PushSyncResult {
  status: PushSyncStatus;
  permission: NotificationPermission | 'unsupported';
}

interface SendPushFunctionResponse {
  sent?: boolean;
  reason?: string;
  error?: string;
}

interface FunctionsHttpErrorLike {
  context?: Response;
  message?: string;
  name?: string;
}

function readPushDebugPreference() {
  if (typeof window === 'undefined') {
    return import.meta.env.DEV;
  }

  try {
    const currentUrl = new URL(window.location.href);
    const queryValue = currentUrl.searchParams.get(PUSH_DEBUG_STORAGE_KEY);

    if (queryValue === '1' || queryValue === 'true') {
      window.localStorage.setItem(PUSH_DEBUG_STORAGE_KEY, '1');
      return true;
    }

    if (queryValue === '0' || queryValue === 'false') {
      window.localStorage.removeItem(PUSH_DEBUG_STORAGE_KEY);
      return false;
    }

    return import.meta.env.DEV || window.localStorage.getItem(PUSH_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return import.meta.env.DEV;
  }
}

export function isPushDebugEnabled() {
  return readPushDebugPreference();
}

export function debugPush(message: string, details?: unknown) {
  if (!isPushDebugEnabled()) {
    return;
  }

  if (details === undefined) {
    console.info(PUSH_DEBUG_PREFIX, message);
    return;
  }

  console.info(PUSH_DEBUG_PREFIX, message, details);
}

export function debugPushError(message: string, details?: unknown) {
  if (!isPushDebugEnabled()) {
    return;
  }

  if (details === undefined) {
    console.error(PUSH_DEBUG_PREFIX, message);
    return;
  }

  console.error(PUSH_DEBUG_PREFIX, message, details);
}

async function getFunctionsErrorDetails(error: unknown) {
  const response =
    typeof error === 'object' &&
    error !== null &&
    'context' in error &&
    error.context instanceof Response
      ? error.context
      : null;

  if (!response) {
    return null;
  }

  try {
    const clonedResponse = response.clone();
    const contentType = clonedResponse.headers.get('Content-Type') || '';
    const body = contentType.includes('application/json')
      ? await clonedResponse.json()
      : await clonedResponse.text();

    return {
      body,
      headers: Object.fromEntries(clonedResponse.headers.entries()),
      status: clonedResponse.status,
      statusText: clonedResponse.statusText,
    };
  } catch {
    return {
      body: null,
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
      statusText: response.statusText,
    };
  }
}

function getFunctionsErrorMessage(
  error: FunctionsHttpErrorLike,
  errorDetails: Awaited<ReturnType<typeof getFunctionsErrorDetails>>,
) {
  if (errorDetails?.body && typeof errorDetails.body === 'object' && 'error' in errorDetails.body) {
    const bodyError = errorDetails.body.error;
    if (typeof bodyError === 'string' && bodyError.trim()) {
      return bodyError;
    }
  }

  if (
    errorDetails?.body &&
    typeof errorDetails.body === 'object' &&
    'reason' in errorDetails.body &&
    typeof errorDetails.body.reason === 'string' &&
    errorDetails.body.reason.trim()
  ) {
    return `The push notification was not sent (${errorDetails.body.reason}).`;
  }

  if (errorDetails?.status) {
    return `Edge Function returned ${errorDetails.status} ${errorDetails.statusText}`.trim();
  }

  return error.message || 'Unable to send the clip notification.';
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}

function getSessionStorageKey(userId: string) {
  return `${PUSH_SESSION_KEY_PREFIX}${userId}`;
}

function isBrowserPushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window &&
    'PushManager' in window &&
    'serviceWorker' in navigator
  );
}

function hasPushTransportSupport() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'PushManager' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

function getSupportSnapshot() {
  return {
    hasNotificationApi:
      typeof window !== 'undefined' && 'Notification' in window,
    hasPushManager:
      typeof window !== 'undefined' && 'PushManager' in window,
    hasServiceWorker:
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    isSecureContext:
      typeof window !== 'undefined' ? window.isSecureContext : false,
    permission:
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported',
    vapidConfigured: Boolean(getVapidPublicKey()),
    serviceWorkerUrl:
      typeof window !== 'undefined' ? getServiceWorkerUrl() : 'sw.js',
    serviceWorkerScope: getServiceWorkerScope(),
  };
}

function getServiceWorkerScope() {
  return import.meta.env.BASE_URL || '/';
}

function getServiceWorkerUrl() {
  if (typeof window === 'undefined') {
    return 'sw.js';
  }

  return new URL(`${getServiceWorkerScope()}sw.js`, window.location.origin).toString();
}

function getVapidPublicKey() {
  return import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY?.trim() || '';
}

function getSubscriptionEndpointHost(subscription: PushSubscription) {
  try {
    return new URL(subscription.endpoint).host;
  } catch {
    return null;
  }
}

function isInvalidSubscriptionEndpoint(subscription: PushSubscription) {
  const host = getSubscriptionEndpointHost(subscription);
  return host === 'permanently-removed.invalid';
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function markSessionReady(userId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(getSessionStorageKey(userId), '1');
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function hasSessionReadyFlag(userId: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.sessionStorage.getItem(getSessionStorageKey(userId)) === '1';
  } catch {
    return false;
  }
}

async function savePushSubscription(userId: string, subscription: PushSubscription) {
  const client = requireSupabase();
  debugPush('Saving push subscription to Supabase.', {
    endpoint: subscription.endpoint,
    userId,
  });
  const { error } = await client.from('push_subscriptions').upsert(
    {
      user_id: userId,
      subscription: subscription.toJSON(),
    },
    {
      onConflict: 'user_id',
    },
  );

  if (error) {
    throw new Error(`Unable to save the push subscription: ${error.message}`);
  }
}

export async function registerAppServiceWorker() {
  if (!isBrowserPushSupported()) {
    debugPush('Skipping service worker registration because push is unsupported.', getSupportSnapshot());
    return null;
  }

  debugPush('Registering push service worker.', getSupportSnapshot());

  return navigator.serviceWorker.register(getServiceWorkerUrl(), {
    scope: getServiceWorkerScope(),
  });
}

async function subscribeUserToPush(userId: string, registration: ServiceWorkerRegistration) {
  const existingSubscription = await registration.pushManager.getSubscription();
  debugPush('Existing push subscription lookup completed.', {
    hasExistingSubscription: Boolean(existingSubscription),
    userId,
  });
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()),
    }));

  if (isInvalidSubscriptionEndpoint(subscription)) {
    debugPush('Browser returned an invalid push subscription endpoint; skipping push setup.', {
      endpoint: subscription.endpoint,
      userId,
    });

    try {
      await subscription.unsubscribe();
    } catch {
      // Ignore unsubscribe failures and surface the root cause instead.
    }

    return false;
  }

  await savePushSubscription(userId, subscription);
  markSessionReady(userId);
  return true;
}

export async function syncPushNotifications(
  userId: string,
  options?: { requestPermission?: boolean },
): Promise<PushSyncResult> {
  debugPush('Starting push sync.', {
    requestPermission: Boolean(options?.requestPermission),
    userId,
    ...getSupportSnapshot(),
  });

  const hasNotificationApi =
    typeof window !== 'undefined' && 'Notification' in window;
  if (!hasNotificationApi) {
    debugPush('Push sync result: unsupported because Notification API is unavailable.');
    return {
      status: 'unsupported',
      permission: 'unsupported',
    };
  }

  if (!hasPushTransportSupport()) {
    debugPush(
      'Push sync result: unsupported because the current origin or browser cannot use service workers and PushManager.',
      getSupportSnapshot(),
    );
    return {
      status: 'unsupported',
      permission: Notification.permission,
    };
  }

  if (!getVapidPublicKey()) {
    debugPush('Push sync result: disabled because VAPID public key is missing.');
    return {
      status: 'disabled',
      permission: Notification.permission,
    };
  }

  let permission = Notification.permission;
  if (permission === 'default' && options?.requestPermission) {
    debugPush(
      'Requesting notification permission from the browser before any async registration work.',
    );
    permission = await Notification.requestPermission();
    debugPush('Notification permission request completed.', {
      permission,
    });
  }

  if (permission === 'denied') {
    debugPush('Push sync result: permission denied by the browser.');
    return {
      status: 'denied',
      permission,
    };
  }

  if (permission !== 'granted') {
    debugPush('Push sync result: waiting for a user-triggered permission request.', {
      permission,
    });
    return {
      status: 'needs-permission',
      permission,
    };
  }

  if (hasSessionReadyFlag(userId)) {
    debugPush('Push sync result: already enabled for this session.', {
      userId,
    });
    return {
      status: 'enabled',
      permission,
    };
  }

  const registration = await registerAppServiceWorker();
  if (!registration) {
    debugPush('Push sync result: unsupported because service worker registration returned null.');
    return {
      status: 'unsupported',
      permission,
    };
  }

  const didSubscribe = await subscribeUserToPush(userId, registration);
  if (!didSubscribe) {
    return {
      status: 'unsupported',
      permission,
    };
  }

  debugPush('Push sync result: enabled.', {
    userId,
  });

  return {
    status: 'enabled',
    permission,
  };
}

export async function sendClipSentPushNotification(targetUserId: string) {
  const client = requireSupabase();
  const {
    data: { session },
  } = await client.auth.getSession();
  const accessToken = session?.access_token ?? null;

  debugPush('Preparing push edge function auth context.', {
    hasAccessToken: Boolean(accessToken),
    sessionUserId: session?.user?.id ?? null,
    targetUserId,
  });

  if (!accessToken) {
    throw new Error('Unable to send the clip notification: no active Supabase session.');
  }

  debugPush('Invoking send-push-notification edge function.', {
    targetUserId,
  });
  const { data, error } = await client.functions.invoke<SendPushFunctionResponse>(
    'send-push-notification',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        targetUserId,
      },
    },
  );

  if (error) {
    const errorDetails = await getFunctionsErrorDetails(error);
    debugPushError('send-push-notification edge function failed.', {
      error,
      errorDetails,
      targetUserId,
    });
    throw new Error(getFunctionsErrorMessage(error, errorDetails));
  }

  debugPush('send-push-notification edge function completed.', {
    data,
    targetUserId,
  });

  if (!data?.sent) {
    const reason = data?.reason ? ` (${data.reason})` : '';
    const message = data?.error || `The push notification was not sent${reason}.`;
    debugPushError('send-push-notification edge function reported an unsent notification.', {
      data,
      targetUserId,
    });
    throw new Error(message);
  }

  debugPush('Push notification sent successfully.', {
    targetUserId,
  });
}
