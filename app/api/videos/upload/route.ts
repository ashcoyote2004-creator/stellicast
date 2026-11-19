import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/../lib/supabase-server';
import { hasPermission } from '@/../lib/sector-utils';
import { createVideoUploadTarget } from '@/../lib/video-storage';
import type { SectorRole } from '@/../types';

// -------- Slug generation --------

// Generate random 8-character slug using a-z, A-Z, 0-9 (x2), _, -
function generateSlug(): string {
  // 0-9 appears twice to make it x2 more likely to show up in a slug due to there being 52 a-z characters
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let slug = '';
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

// Generate unique slug by checking against existing videos
async function generateUniqueSlug(supabase: any): Promise<string> {
  let slug = generateSlug();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const { data, error } = await supabase
      .from('videos')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();

    if (error)
      throw error;

    // If no video with this slug exists, we're good
    if (!data)
      return slug;

    // Conflict detected, generate a new slug
    slug = generateSlug();
    attempts++;
  }

  throw new Error('Failed to generate unique slug after multiple attempts');
}

// -------- Route handler --------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, channel_id, sector_ids } = body;

    if (!channel_id) {
      return NextResponse.json(
        { error: 'Channel ID is required. Please select a channel.' },
        { status: 400 }
      );
    }

    // Verify user owns this channel and it is active
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('id, status')
      .eq('id', channel_id)
      .eq('owner_id', user.id)
      .single();

    if (channelError || !channel) {
      return NextResponse.json(
        { error: 'Channel not found or you do not have permission.' },
        { status: 403 }
      );
    }

    if (channel.status !== 'active') {
      return NextResponse.json(
        { error: 'This channel is not active. Apply for early access to start uploading.' },
        { status: 403 }
      );
    }

    // Generate unique slug for the video
    const slug = await generateUniqueSlug(supabase);

    // Store video metadata first so we have an ID for the storage path.
    // processing_status stays 'processing' until the file is uploaded and finalized.
    const { data: newVideo, error: dbError } = await supabase
      .from('videos')
      .insert({
        title: title || 'Untitled Video',
        description: body.description || '',
        thumbnail_url: '',
        video_url: '',
        channel_id: channel_id,
        view_count: 0,
        duration: body.duration || 0,
        visibility: body.visibility,
        is_ai: body.is_ai || false,
        is_promotional: body.is_promotional || false,
        tags: body.tags || [],
        slug: slug,
        processing_status: 'processing',
      })
      .select()
      .single();

    if (dbError) throw dbError;

    // Ask the configured storage provider (Supabase Storage by default) for a
    // direct-from-browser upload target.
    let upload: Awaited<ReturnType<typeof createVideoUploadTarget>>;
    try {
      upload = await createVideoUploadTarget({
        videoId: newVideo.id,
        filename: body.filename,
        contentType: body.contentType || body.mime_type,
        size: body.filesize,
      });
    } catch (storageError: any) {
      // Roll back the placeholder row so failed uploads don't leave ghosts behind.
      await supabase.from('videos').delete().eq('id', newVideo.id);
      console.error('Storage initialization failed:', storageError);
      return NextResponse.json(
        { error: storageError?.message || 'Video storage is not configured yet.' },
        { status: 503 }
      );
    }

    // Persist the playback URL that the uploaded file will be served from.
    const { error: urlError } = await supabase
      .from('videos')
      .update({ video_url: upload.videoUrl, updated_at: new Date().toISOString() })
      .eq('id', newVideo.id);

    if (urlError) throw urlError;

    // -------- Sector linking with approval status --------

    const pendingSectorSlugs: string[] = [];

    if (Array.isArray(sector_ids) && sector_ids.length > 0) {
      // Fetch sector settings for all selected sectors
      const { data: sectors, error: sectorsError } = await supabase
        .from('sectors')
        .select('id, slug, approval_for_posting, open_posting')
        .in('id', sector_ids);

      if (sectorsError) throw sectorsError;

      // Fetch user's membership in these sectors (to check bypass permissions)
      const { data: memberships } = await supabase
        .from('sector_members')
        .select('sector_id, roles')
        .eq('user_id', user.id)
        .in('sector_id', sector_ids);

      const membershipMap: Record<string, SectorRole[]> = {};
      for (const m of memberships ?? []) {
        membershipMap[m.sector_id] = m.roles as SectorRole[];
      }

      const sectorInserts = (sectors ?? []).map(sector => {
        const userRoles = membershipMap[sector.id] ?? [];
        const canBypassApproval = hasPermission(userRoles, 'post_without_approval');
        const needsApproval = sector.approval_for_posting && !canBypassApproval;

        if (needsApproval) {
          pendingSectorSlugs.push(sector.slug);
        }

        return {
          sector_id: sector.id,
          video_id: newVideo.id,
          approval_status: needsApproval ? 'pending' : 'approved',
        };
      });

      if (sectorInserts.length > 0) {
        const { error: svError } = await supabase
          .from('sector_videos')
          .insert(sectorInserts);

        if (svError) throw svError;
      }
    }

    return NextResponse.json({
      success: true,
      videoId: newVideo.id,
      slug: newVideo.slug,
      uploadUrl: upload.target.uploadUrl,
      uploadMethod: upload.target.method,
      uploadHeaders: upload.target.headers,
      storageProvider: upload.target.provider,
      pendingSectorSlugs,
    });
  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// todo: limit file size based on channel type and if user has premium
