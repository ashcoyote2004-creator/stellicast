/**
 * Vidara video storage adapter.
 *
 * Configured entirely from Settings → Environment variables:
 *   VIDARA_API_KEY  – bearer token for the Vidara API (required)
 *   VIDARA_API_BASE – base URL of your Vidara endpoint, e.g.
 *                     https://api.vidara.example/v1 (required)
 *
 * Contract implemented here (JSON, bearer auth):
 *   POST   {base}/uploads            { videoId, filename, contentType, size, kind }
 *                                    -> { uploadUrl, publicUrl, method?, headers? }
 *   POST   {base}/thumbnails         multipart: videoId, thumbnail
 *                                    -> { publicUrl }
 *   DELETE {base}/videos/{videoId}   -> 2xx / 404
 *
 * Field aliases (upload_url, public_url, playbackUrl, url) are accepted so a
 * slightly different response shape still works.
 */

export function isVidaraConfigured(): boolean {
  return Boolean(process.env.VIDARA_API_KEY && process.env.VIDARA_API_BASE);
}

function vidaraBase(): string {
  const base = (process.env.VIDARA_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      'Vidara storage is selected but VIDARA_API_BASE is not set. Add it in Settings → Environment variables.',
    );
  }
  return base;
}

function vidaraHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const key = (process.env.VIDARA_API_KEY || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function vidaraError(res: Response, action: string): Promise<Error> {
  const detail = await res.text().catch(() => '');
  return new Error(`Vidara ${action} failed (${res.status}): ${detail.slice(0, 200)}`);
}

export async function vidaraCreateUpload(params: {
  videoId: string;
  filename?: string;
  contentType?: string;
  size?: number;
}): Promise<{ uploadUrl: string; publicUrl: string; method: 'PUT' | 'POST'; headers: Record<string, string> }> {
  const res = await fetch(`${vidaraBase()}/uploads`, {
    method: 'POST',
    headers: vidaraHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      videoId: params.videoId,
      filename: params.filename || 'source.mp4',
      contentType: params.contentType || 'video/mp4',
      size: params.size ?? null,
      kind: 'video',
    }),
    cache: 'no-store',
  });

  if (!res.ok) throw await vidaraError(res, 'upload request');

  const json: any = await res.json().catch(() => ({}));
  const uploadUrl: string | undefined = json.uploadUrl || json.upload_url || json.url;
  const publicUrl: string | undefined =
    json.publicUrl || json.public_url || json.playbackUrl || json.playback_url;

  if (!uploadUrl || !publicUrl) {
    throw new Error('Vidara response must include uploadUrl and publicUrl.');
  }

  return {
    uploadUrl,
    publicUrl,
    method: String(json.method || 'PUT').toUpperCase() === 'POST' ? 'POST' : 'PUT',
    headers: json.headers || {},
  };
}

export async function vidaraUploadThumbnail(params: {
  videoId: string;
  bytes: ArrayBuffer;
  contentType: string;
  extension: string;
}): Promise<string> {
  const form = new FormData();
  form.append('videoId', params.videoId);
  form.append(
    'thumbnail',
    new Blob([params.bytes], { type: params.contentType }),
    `thumbnail.${params.extension}`,
  );

  const res = await fetch(`${vidaraBase()}/thumbnails`, {
    method: 'POST',
    headers: vidaraHeaders(),
    body: form,
    cache: 'no-store',
  });

  if (!res.ok) throw await vidaraError(res, 'thumbnail upload');

  const json: any = await res.json().catch(() => ({}));
  const publicUrl: string | undefined = json.publicUrl || json.public_url || json.url;
  if (!publicUrl) throw new Error('Vidara thumbnail response must include publicUrl.');
  return publicUrl;
}

export async function vidaraDelete(videoId: string): Promise<void> {
  const res = await fetch(`${vidaraBase()}/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers: vidaraHeaders(),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) throw await vidaraError(res, 'delete');
}
