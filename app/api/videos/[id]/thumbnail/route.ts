import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/../lib/supabase-server';
import { uploadVideoThumbnail, providerThumbnailFromUrl } from '@/../lib/video-storage';

const EXTENSION_BY_TYPE: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createSupabaseServerClient();

    // -------- Auth + ownership --------
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: video, error: videoError } = await supabase
        .from('videos')
        .select('id, video_url, channels(owner_id)')
        .eq('id', id)
        .single();

    if (videoError || !video) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const channel = video.channels as unknown as { owner_id: string } | null;
    if (channel?.owner_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // -------- Provider-generated thumbnail (Mux renders one per asset) --------
    // Saves an upload and keeps processing cost at zero.
    const providerThumbnail = providerThumbnailFromUrl((video as any).video_url);
    if (providerThumbnail) {
        await supabase
            .from('videos')
            .update({ thumbnail_url: providerThumbnail, updated_at: new Date().toISOString() })
            .eq('id', id);
        return NextResponse.json({ thumbnail_url: providerThumbnail, source: 'provider' });
    }

    // -------- Parse and validate the uploaded file --------
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const file = formData.get('thumbnail') as File | null;
    if (!file)
        return NextResponse.json({ error: 'No thumbnail file provided' }, { status: 400 });

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
            { error: 'Invalid file type. Use JPEG, PNG, or WebP.' },
            { status: 400 }
        );
    }

    const maxSize = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxSize) {
        return NextResponse.json({ error: 'Thumbnail must be under 5 MB.' }, { status: 400 });
    }

    // -------- Store the image with the configured storage provider --------
    let thumbnailUrl: string;
    try {
        thumbnailUrl = await uploadVideoThumbnail({
            videoId: id,
            bytes: await file.arrayBuffer(),
            contentType: file.type,
            extension: EXTENSION_BY_TYPE[file.type] ?? 'jpg',
        });
    } catch (error: any) {
        console.error('[thumbnail] Storage error:', error);
        return NextResponse.json(
            { error: error?.message || 'Failed to store thumbnail' },
            { status: 502 }
        );
    }

    // -------- Persist to DB --------
    const { error: dbError } = await supabase
        .from('videos')
        .update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (dbError) {
        console.error('[thumbnail] DB update error:', dbError);
        // The image is stored, the DB just didn't save the URL. Return it anyway
        // so the client can show the preview.
        return NextResponse.json(
            { thumbnail_url: thumbnailUrl, warning: 'DB update failed. Thumbnail may not persist' },
            { status: 207 }
        );
    }

    return NextResponse.json({ thumbnail_url: thumbnailUrl });
}
