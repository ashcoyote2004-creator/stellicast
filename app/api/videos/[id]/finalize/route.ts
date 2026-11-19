import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/../lib/supabase-server';
import {
  MUX_PENDING_PREFIX,
  isMuxConfigured,
  muxHlsUrl,
  muxThumbnailUrl,
  resolveMuxUploadAsset,
} from '@/../lib/mux';

/**
 * Marks a video as ready once the browser finished uploading its file to the
 * configured storage provider. Called by the upload UI after the file transfer.
 *
 * With Mux, the stored value is still a pending marker at this point; this
 * handler resolves the Mux asset and swaps in the HLS playback URL plus the
 * auto-generated thumbnail.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: video, error: videoError } = await supabase
    .from('videos')
    .select('id, video_url, channels(owner_id)')
    .eq('id', id)
    .single();

  if (videoError || !video)
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const channel = video.channels as unknown as { owner_id: string } | null;
  if (channel?.owner_id !== user.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.duration === 'number' && body.duration > 0) {
    updates.duration = Math.floor(body.duration);
  }

  const storedUrl = typeof (video as any).video_url === 'string' ? (video as any).video_url : '';

  if (storedUrl.startsWith(MUX_PENDING_PREFIX)) {
    // -------- Mux: resolve the processed asset --------
    const uploadId = storedUrl.slice(MUX_PENDING_PREFIX.length);

    if (!isMuxConfigured()) {
      return NextResponse.json(
        {
          error:
            'Mux is not configured. Add MUX_TOKEN_ID and MUX_TOKEN_SECRET in Settings → Environment variables.',
        },
        { status: 503 },
      );
    }

    try {
      const { asset, uploadError } = await resolveMuxUploadAsset(uploadId);

      if (uploadError) {
        console.error('[finalize] Mux upload error:', uploadError);
        return NextResponse.json({ error: `Mux upload failed: ${uploadError}` }, { status: 502 });
      }

      if (asset?.status === 'errored') {
        return NextResponse.json(
          {
            error: `Mux could not process this video: ${
              asset.errors?.messages?.join(', ') || 'processing error'
            }`,
          },
          { status: 502 },
        );
      }

      if (asset?.playbackId) {
        updates.video_url = muxHlsUrl(asset.playbackId);
        updates.thumbnail_url = muxThumbnailUrl(asset.playbackId);
        if (asset.duration) updates.duration = Math.floor(asset.duration);
        updates.processing_status = 'ready';
      } else {
        // Mux is still preparing the asset. Keep the marker so a later finalize
        // call can finish the switch to the playback URL.
        updates.processing_status = 'processing';
      }
    } catch (error: any) {
      console.error('[finalize] Mux error:', error);
      return NextResponse.json(
        { error: error?.message || 'Mux processing failed' },
        { status: 502 },
      );
    }
  } else {
    updates.processing_status = 'ready';
  }

  const { error: updateError } = await supabase
    .from('videos')
    .update(updates)
    .eq('id', id);

  if (updateError) {
    console.error('[finalize] DB update error:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    videoId: id,
    processing: updates.processing_status === 'processing',
    video_url: (updates.video_url as string | undefined) ?? storedUrl,
  });
}
