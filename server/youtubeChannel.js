// YouTube channel data fetcher — uses YouTube Data API v3 (fetch) and optional youtube-transcript
const YOUTUBE_API_KEY = process.env.REACT_APP_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

function parseChannelInput(urlOrInput) {
  const s = (urlOrInput || '').trim();
  // Channel ID: UC... (11 chars after UC)
  const channelIdMatch = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i) || s.match(/^UC[\w-]{22}$/i);
  if (channelIdMatch) return { type: 'id', value: channelIdMatch[1] };
  // @handle
  const handleMatch = s.match(/youtube\.com\/@([\w-]+)/i) || s.match(/^@?([\w-]+)$/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1].replace(/^@/, '') };
  return null;
}

async function getChannelId(input) {
  const parsed = parseChannelInput(input);
  if (!parsed) return null;
  if (parsed.type === 'id') return parsed.value;
  const q = parsed.value.startsWith('@') ? parsed.value : `@${parsed.value}`;
  const res = await fetch(
    `${BASE}/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}&maxResults=1`
  );
  const data = await res.json();
  const channelId = data?.items?.[0]?.id?.channelId;
  return channelId || null;
}

async function getUploadsPlaylistId(channelId) {
  const res = await fetch(
    `${BASE}/channels?part=contentDetails,snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
  );
  const data = await res.json();
  return data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
}

async function getPlaylistVideoIds(playlistId, maxResults) {
  const ids = [];
  let nextPageToken = '';
  while (ids.length < maxResults) {
    const res = await fetch(
      `${BASE}/playlistItems?part=snippet&playlistId=${playlistId}&key=${YOUTUBE_API_KEY}&maxResults=50&pageToken=${nextPageToken}`
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    const items = data.items || [];
    for (const it of items) {
      const vid = it.snippet?.resourceId?.videoId;
      if (vid) ids.push(vid);
      if (ids.length >= maxResults) break;
    }
    nextPageToken = data.nextPageToken || '';
    if (!nextPageToken) break;
  }
  return ids.slice(0, maxResults);
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || 0, 10);
  const m = parseInt(match[2] || 0, 10);
  const s = parseInt(match[3] || 0, 10);
  return h * 3600 + m * 60 + s;
}

async function getTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const chunks = await YoutubeTranscript.fetchTranscript(videoId);
    return Array.isArray(chunks) ? chunks.map((c) => c.text).join(' ') : null;
  } catch {
    return null;
  }
}

async function fetchChannelData(urlOrHandle, maxVideos, onProgress) {
  if (!YOUTUBE_API_KEY) throw new Error('YouTube API key not configured. Set YOUTUBE_API_KEY or REACT_APP_YOUTUBE_API_KEY.');
  const channelId = await getChannelId(urlOrHandle);
  if (!channelId) throw new Error('Could not resolve channel. Use a channel URL (e.g. https://www.youtube.com/@veritasium) or channel ID.');
  const playlistId = await getUploadsPlaylistId(channelId);
  if (!playlistId) throw new Error('Could not get uploads playlist for channel.');
  const videoIds = await getPlaylistVideoIds(playlistId, maxVideos);
  const channelTitle =
    (await fetch(`${BASE}/channels?part=snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`)
      .then((r) => r.json())
      .then((d) => d?.items?.[0]?.snippet?.title)) || 'Unknown';

  const videos = [];
  for (let i = 0; i < videoIds.length; i++) {
    if (onProgress) onProgress(i + 1, videoIds.length);
    const id = videoIds[i];
    const res = await fetch(
      `${BASE}/videos?part=snippet,contentDetails,statistics&id=${id}&key=${YOUTUBE_API_KEY}`
    );
    const data = await res.json();
    const item = data?.items?.[0];
    if (!item) continue;
    const sn = item.snippet || {};
    const stat = item.statistics || {};
    const content = item.contentDetails || {};
    const durationSec = parseDuration(content.duration);
    let transcript = null;
    try {
      transcript = await getTranscript(id);
    } catch (_) {}
    videos.push({
      title: sn.title || '',
      description: sn.description || '',
      transcript,
      duration: durationSec,
      release_date: sn.publishedAt || null,
      view_count: parseInt(stat.viewCount || 0, 10),
      like_count: parseInt(stat.likeCount || 0, 10),
      comment_count: parseInt(stat.commentCount || 0, 10),
      video_url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || sn.thumbnails?.default?.url || null,
    });
  }
  return { channelTitle, videos };
}

module.exports = { fetchChannelData, parseChannelInput, getChannelId };
