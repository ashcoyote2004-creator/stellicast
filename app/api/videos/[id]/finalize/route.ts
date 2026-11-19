import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/../lib/supabase-server';

/**
 * Marks a video as ready once the browser finished uploading its file to the
 * configured storage provider. Called by the upload UI after the file transfer.
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
    processing_status: 'ready',
    updated_at: new Date().toISOString(),
  };
  if (typeof body.duration === 'number' && body.duration > 0) {
    updates.duration = Math.floor(body.duration);
  }

  const { error: updateError } = await supabase
    .from('videos')
    .update(updates)
    .eq('id', id);

  if (updateError) {
    console.error('[finalize] DB update error:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, videoId: id });
}
