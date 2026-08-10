import type { AgencySettings } from "../database/schema";

/**
 * Google Drive backup destination.
 *
 * Drive is a *mirror*: every artifact is always written to object storage first
 * (that is what restore reads), and additionally pushed to Drive when the agency
 * has connected an account. Credentials come from the backup settings form, with
 * environment variables as an override for shared/service deployments.
 *
 * Auth uses a standard OAuth refresh-token grant, so the agency connects once
 * and the server mints short-lived access tokens on every run.
 */

export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
}

export function driveCredentials(settings: AgencySettings): DriveCredentials | null {
  const clientId = process.env.GDRIVE_CLIENT_ID || settings.gdriveClientId;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET || settings.gdriveClientSecret;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN || settings.gdriveRefreshToken;
  const folderId = process.env.GDRIVE_FOLDER_ID || settings.gdriveFolderId;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, folderId };
}

export function driveConfigured(settings: AgencySettings): boolean {
  return driveCredentials(settings) !== null;
}

async function accessToken(creds: DriveCredentials): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google returned no access token");
  return json.access_token;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string | null;
}

/** Multipart upload of one encrypted backup artifact. */
export async function uploadToDrive(
  settings: AgencySettings,
  fileName: string,
  body: Buffer,
): Promise<DriveUploadResult> {
  const creds = driveCredentials(settings);
  if (!creds) throw new Error("Google Drive is not connected");

  const token = await accessToken(creds);
  const boundary = `matchhire${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: "application/octet-stream",
    ...(creds.folderId ? { parents: [creds.folderId] } : {}),
  });

  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(payload),
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return { fileId: json.id, webViewLink: json.webViewLink ?? null };
}

/** Verify the connection without uploading a real backup. */
export async function testDrive(settings: AgencySettings) {
  const creds = driveCredentials(settings);
  if (!creds) return { ok: false as const, error: "No Google Drive credentials saved" };
  try {
    const token = await accessToken(creds);
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user,storageQuota", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false as const, error: `Drive rejected the token (${res.status})` };
    const json = (await res.json()) as {
      user?: { emailAddress?: string };
      storageQuota?: { usage?: string; limit?: string };
    };
    return {
      ok: true as const,
      account: json.user?.emailAddress ?? null,
      usedBytes: Number(json.storageQuota?.usage ?? 0),
      limitBytes: Number(json.storageQuota?.limit ?? 0),
      folderId: creds.folderId || null,
    };
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
}
