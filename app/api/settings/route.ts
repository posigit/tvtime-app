import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import {
  DEFAULT_VIX_SETTINGS,
  isBannedSubLang,
  type VixSettings,
} from "@/lib/vix-settings";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Server-side player settings (source of truth across devices).
 *
 * GET  → { settings: VixSettings | null }   (null = never synced)
 * POST → upsert the settings blob
 *
 * Normalization mirrors lib/vix-settings.ts: defaults merge + banned-language
 * clamp (Italian must never persist). Values are validated loosely on purpose —
 * the schema is a JSONB blob and the client is the only writer.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, session.user.id),
  });
  return NextResponse.json({ settings: row?.settings ?? null });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("settings" in body)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const incoming = (body as { settings: Partial<VixSettings> }).settings ?? {};
  if (typeof incoming !== "object" || incoming === null) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }

  // Normalize exactly like the client: merge defaults, clamp banned langs.
  // muted is session-only — never persist true (autoplay/PWA re-poison).
  const merged: VixSettings = {
    ...DEFAULT_VIX_SETTINGS,
    ...incoming,
    muted: false,
    v: DEFAULT_VIX_SETTINGS.v,
  };
  if (typeof merged.subs !== "string") merged.subs = DEFAULT_VIX_SETTINGS.subs;
  if (typeof merged.audio !== "string") merged.audio = DEFAULT_VIX_SETTINGS.audio;
  if (isBannedSubLang(merged.subs)) merged.subs = "en";
  if (isBannedSubLang(merged.audio)) merged.audio = "en";

  await db
    .insert(userSettings)
    .values({
      userId: session.user.id,
      settings: merged as unknown as object,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        settings: merged as unknown as object,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true, settings: merged });
}