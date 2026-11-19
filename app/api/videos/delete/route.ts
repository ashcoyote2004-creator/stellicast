import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/../lib/supabase-server';
import { deleteVideoAssets } from '@/../lib/video-storage';

/**
 * Deletes the stored files (video + thumbnail) for a video the caller owns.
 * The database row is removed by the client after this succeeds.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const videoId: string | undefined = body.videoId || body.video_id || body.id;

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    // Verify the user owns the video before deleting
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, channel_id, channels!inner(owner_id)')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if ((video.channels as any).owner_id !== user.id) {
      return NextResponse.json(
        { error: 'You do not have permission to delete this video' },
        { status: 403 }
      );
    }

    try {
      await deleteVideoAssets(videoId);
    } catch (storageError: any) {
      console.error('[delete] Storage cleanup failed:', storageError);
      return NextResponse.json(
        { error: storageError?.message || 'Failed to delete stored files' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, videoId });
  } catch (error: any) {
    console.error('Delete video API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
