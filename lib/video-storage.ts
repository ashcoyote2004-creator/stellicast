import { createSupabaseAdminClient } from '@/../lib/supabase-server';

/**
 * Video storage abstraction.
 *
 * Two providers are supported and selected at runtime:
 *
 *  1. `supabase` (default) – uses Supabase Storage. No extra credentials needed.
 *  2. `custom`              – your own storage API. Enabled automatically when
 *                             STORAGE_API_URL is set (or STORAGE_PROVIDER=custom).
 *
 * The custom provider contract is documented in README.md and
 * .env.local.example. Nothing here throws at import time, so the app builds and
 * runs even when no storage provider is configured.
 */

export type StorageProvider = 'supabase' | 'custom';

export type UploadTarget = {
  provider: StorageProvider;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  /** Public URL the uploaded file will be served from. */
  publicUrl: string;
};

const DEFAULT_BUCKET = 'videos';

export function getStorageProvider(): StorageProvider {
  const configured = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  if (configured === 'custom') return 'custom';
  if (configured === 'supabase') return 'supabase';
  // No explicit choice: use the custom API only if it is actually configured.
  return process.env.STORAGE_API_URL ? 'custom' : 'supabase';
}

export function getStorageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
}

function customApiBase(): string {
  const base = (process.env.STORAGE_API_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      'Custom storage is selected but STORAGE_API_URL is not set. Add it in Settings → Environment variables.',
    );
  }
  return base;
}

function customApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const key = process.env.STORAGE_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function fileExtension(filename?: string, fallback = 'mp4'): string {
  const match = (filename || '').match(/\.([a-z0-9]{1,8})$/i);
  return (match?.[1] || fallback).toLowerCase();
}

export function videoObjectPath(videoId: string, filename?: string): string {
  return `videos/${videoId}/source.${fileExtension(filename)}`;
}

export function thumbnailObjectPath(videoId: string, extension = 'jpg'): string {
  return `thumbnails/${videoId}.${extension}`;
}

function supabaseStorageUrl(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. Add your Supabase project URL in Settings → Environment variables.',
    );
  }
  return url;
}

/** Absolute public URL for an object in the configured Supabase Storage bucket. */
export function supabasePublicUrl(objectPath: string): string {
  const encoded = objectPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `${supabaseStorageUrl()}/storage/v1/object/public/${getStorageBucket()}/${encoded}`;
}

/**
 * Create a direct-from-browser upload target for a video file.
 * `videoUrl` is the URL that will be stored on the video row.
 */
export async function createVideoUploadTarget(params: {
  videoId: string;
  filename?: string;
  contentType?: string;
  size?: number;
}): Promise<{ target: UploadTarget; videoUrl: string }> {
  const { videoId, filename, contentType, size } = params;

  if (getStorageProvider() === 'custom') {
    const res = await fetch(`${customApiBase()}/uploads`, {
      method: 'POST',
      headers: customApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        videoId,
        filename: filename || `source.mp4`,
        contentType: contentType || 'video/mp4',
        size: size ?? null,
        kind: 'video',
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Storage API rejected the upload request (${res.status}): ${detail.slice(0, 200)}`);
    }

    const json = await res.json();
    const uploadUrl: string | undefined = json.uploadUrl || json.upload_url || json.url;
    const publicUrl: string | undefined = json.publicUrl || json.public_url || json.playbackUrl;

    if (!uploadUrl || !publicUrl) {
      throw new Error('Storage API response must include uploadUrl and publicUrl');
    }

    return {
      target: {
        provider: 'custom',
        uploadUrl,
        method: (json.method || 'PUT').toUpperCase() === 'POST' ? 'POST' : 'PUT',
        headers: json.headers || {},
        publicUrl,
      },
      videoUrl: publicUrl,
    };
  }

  // -------- Supabase Storage --------
  const admin = createSupabaseAdminClient();
  const objectPath = videoObjectPath(videoId, filename);
  const bucket = getStorageBucket();

  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(objectPath);
  if (error || !data) {
    throw new Error(
      `Could not create a Supabase Storage upload URL for bucket "${bucket}": ${error?.message || 'unknown error'}. ` +
        'Make sure the bucket exists and the service role key is set.',
    );
  }

  const signedUrl = data.signedUrl.startsWith('http')
    ? data.signedUrl
    : `${supabaseStorageUrl()}/storage/v1${data.signedUrl.startsWith('/') ? '' : '/'}${data.signedUrl}`;

  return {
    target: {
      provider: 'supabase',
      uploadUrl: signedUrl,
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'video/mp4', 'x-upsert': 'true' },
      publicUrl: supabasePublicUrl(objectPath),
    },
    videoUrl: supabasePublicUrl(objectPath),
  };
}

/** Store a thumbnail image and return its public URL. */
export async function uploadVideoThumbnail(params: {
  videoId: string;
  bytes: ArrayBuffer;
  contentType: string;
  extension: string;
}): Promise<string> {
  const { videoId, bytes, contentType, extension } = params;

  if (getStorageProvider() === 'custom') {
    const form = new FormData();
    form.append('videoId', videoId);
    form.append('thumbnail', new Blob([bytes], { type: contentType }), `thumbnail.${extension}`);

    const res = await fetch(`${customApiBase()}/thumbnails`, {
      method: 'POST',
      headers: customApiHeaders(),
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Storage API rejected the thumbnail (${res.status}): ${detail.slice(0, 200)}`);
    }

    const json = await res.json();
    const publicUrl: string | undefined = json.publicUrl || json.public_url || json.url;
    if (!publicUrl) throw new Error('Storage API thumbnail response must include publicUrl');
    return publicUrl;
  }

  const admin = createSupabaseAdminClient();
  const bucket = getStorageBucket();
  const objectPath = thumbnailObjectPath(videoId, extension);

  const { error } = await admin.storage
    .from(bucket)
    .upload(objectPath, bytes, { contentType, upsert: true, cacheControl: '3600' });

  if (error) throw new Error(`Supabase Storage thumbnail upload failed: ${error.message}`);

  return supabasePublicUrl(objectPath);
}

/** Remove every stored file belonging to a video. Missing files are ignored. */
export async function deleteVideoAssets(videoId: string): Promise<void> {
  if (getStorageProvider() === 'custom') {
    const res = await fetch(`${customApiBase()}/uploads/${encodeURIComponent(videoId)}`, {
      method: 'DELETE',
      headers: customApiHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Storage API could not delete the video (${res.status}): ${detail.slice(0, 200)}`);
    }
    return;
  }

  const admin = createSupabaseAdminClient();
  const bucket = getStorageBucket();
  const paths: string[] = [];

  for (const folder of [`videos/${videoId}`, 'thumbnails']) {
    const { data } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    for (const entry of data || []) {
      const full = folder === 'thumbnails' ? `thumbnails/${entry.name}` : `${folder}/${entry.name}`;
      if (folder === 'thumbnails' && !entry.name.startsWith(`${videoId}.`)) continue;
      paths.push(full);
    }
  }

  if (paths.length > 0) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Supabase Storage cleanup failed: ${error.message}`);
  }
}

/** Human readable storage status, used by the health endpoint. */
export function describeStorage(): { provider: StorageProvider; bucket?: string; configured: boolean } {
  const provider = getStorageProvider();
  if (provider === 'custom') {
    return { provider, configured: Boolean(process.env.STORAGE_API_URL) };
  }
  return {
    provider,
    bucket: getStorageBucket(),
    configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_API_KEY),
  };
}
