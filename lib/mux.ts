/**
 * Mux video processing client.
 *
 * Everything is read from Settings → Environment variables:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET
 *
 * Nothing throws at import time, so the app still builds and serves when Mux
 * is not configured yet.
 */

const MUX_API_BASE = 'https://api.mux.com';

/** Marker stored in videos.video_url while a Mux upload is still processing. */
export const MUX_PENDING_PREFIX = 'mux-upload://';

export function isMuxConfigured(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

function muxAuthHeader(): string {
  const id = process.env.MUX_TOKEN_ID || '';
  const secret = process.env.MUX_TOKEN_SECRET || '';
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

async function muxRequest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${MUX_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: muxAuthHeader(),
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string> | undefined) || {}),
    },
    cache: 'no-store',
  });

  const text = await res.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message =
      json?.error?.messages?.join(', ') ||
      json?.error?.message ||
      text.slice(0, 200) ||
      res.statusText;
    throw new Error(`Mux API ${res.status}: ${message}`);
  }

  return json;
}

/**
 * Creates a Mux direct upload. The browser PUTs the file straight to
 * `uploadUrl`; Mux then builds the asset and returns a playback ID.
 */
export async function createMuxDirectUpload(): Promise<{ uploadId: string; uploadUrl: string }> {
  const json = await muxRequest('/video/v1/uploads', {
    method: 'POST',
    body: JSON.stringify({
      cors_origin: '*',
      new_asset_settings: {
        playback_policy: ['public'],
        // 'basic' keeps Mux processing/encoding costs low.
        video_quality: 'basic',
      },
    }),
  });

  const data = json?.data;
  if (!data?.url || !data?.id) {
    throw new Error('Mux did not return a direct upload URL.');
  }

  return { uploadId: data.id as string, uploadUrl: data.url as string };
}

export type MuxUpload = {
  id: string;
  status?: string;
  asset_id?: string;
  error?: { message?: string };
};

export async function getMuxUpload(uploadId: string): Promise<MuxUpload | null> {
  const json = await muxRequest(`/video/v1/uploads/${encodeURIComponent(uploadId)}`);
  return (json?.data as MuxUpload) ?? null;
}

export type MuxAsset = {
  id: string;
  status?: string;
  playbackId?: string;
  duration?: number;
  errors?: { messages?: string[] };
};

export async function getMuxAsset(assetId: string): Promise<MuxAsset> {
  const json = await muxRequest(`/video/v1/assets/${encodeURIComponent(assetId)}`);
  const data = json?.data ?? {};
  const playbackId: string | undefined =
    data?.playback_ids?.find((p: any) => p?.policy === 'public')?.id ?? data?.playback_ids?.[0]?.id;

  return {
    id: data?.id as string,
    status: data?.status as string | undefined,
    playbackId,
    duration: typeof data?.duration === 'number' ? data.duration : undefined,
    errors: data?.errors,
  };
}

/** Resolves the Mux asset behind an upload, polling briefly for asset creation. */
export async function resolveMuxUploadAsset(
  uploadId: string,
  attempts = 6,
  delayMs = 1200,
): Promise<{ assetId?: string; asset?: MuxAsset; uploadError?: string }> {
  let upload: MuxUpload | null = null;

  for (let i = 0; i < attempts; i++) {
    upload = await getMuxUpload(uploadId);
    if (upload?.error?.message) return { uploadError: upload.error.message };
    if (upload?.asset_id) break;
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (!upload?.asset_id) return {};

  const asset = await getMuxAsset(upload.asset_id);
  return { assetId: upload.asset_id, asset };
}

export function muxHlsUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

export function muxThumbnailUrl(playbackId: string, width = 1280): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}`;
}

/** Extracts a Mux playback ID from a stored playback or thumbnail URL. */
export function playbackIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const stream = url.match(/stream\.mux\.com\/([A-Za-z0-9_-]+)\.m3u8/);
  if (stream) return stream[1];
  const image = url.match(/image\.mux\.com\/([A-Za-z0-9_-]+)\//);
  if (image) return image[1];
  return null;
}

/** Deletes the Mux asset that owns a playback ID (no DB schema change needed). */
export async function deleteMuxAssetForPlaybackId(playbackId: string): Promise<void> {
  const json = await muxRequest(`/video/v1/playback-ids/${encodeURIComponent(playbackId)}`);
  const assetId: string | undefined = json?.data?.object?.id;
  if (!assetId) return;
  await muxRequest(`/video/v1/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
}
