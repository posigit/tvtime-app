/**
 * Web-push sender (VAPID). No-ops cleanly when keys are not configured.
 */

import webpush from "web-push";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "mailto:admin@example.com",
    pub,
    priv
  );
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** URL to open on tap */
  url?: string;
  tag?: string;
};

/** Returns true when the push was accepted; false on config/delivery failure. */
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<boolean> {
  if (!ensureConfigured()) return false;
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 }
    );
    return true;
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : 0;
    // Gone / unsubscribed — caller should delete the subscription row
    if (status === 404 || status === 410) throw err;
    console.error(
      "Push send failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export function isPushGone(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("statusCode" in err)) return false;
  const status = Number((err as { statusCode: unknown }).statusCode);
  return status === 404 || status === 410;
}
