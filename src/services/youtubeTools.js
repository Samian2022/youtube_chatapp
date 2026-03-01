// YouTube channel JSON tools: generateImage, plot_metric_vs_time, play_video, compute_stats_json

export const YOUTUBE_TOOL_DECLARATIONS = [
  {
    name: 'generateImage',
    description:
      'Generates an image from a text prompt. Optionally accepts an anchor/reference image that was dragged into the chat. Use this tool when the user asks to create, generate, or design an image, thumbnail, or visual. The generated image will be displayed inline in the chat with options to enlarge and download. If the tool returns an error, inform the user that image generation is currently unavailable.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'A descriptive text prompt for the image to generate.' },
        anchor_image: { type: 'STRING', description: 'Base64-encoded reference image provided by the user.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plots a numeric metric from the loaded YouTube channel JSON data versus time (release_date). Use this tool when the user asks to plot, chart, graph, or visualize any numeric field (views, likes, comments, duration, etc.) over time. The result is an interactive chart displayed in the chat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        metric: {
          type: 'STRING',
          description:
            'The numeric field name to plot on the Y-axis (e.g. "view_count", "like_count", "comment_count", "duration").',
        },
        title: { type: 'STRING', description: 'Custom chart title. Defaults to "{metric} vs Time".' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description:
      'Displays a clickable video card in the chat for a video from the loaded YouTube channel data. The card shows the video title and thumbnail; clicking it opens the video on YouTube in a new tab. Use when the user asks to play, open, watch, or show a specific video. The user may specify by title keyword, ordinal (e.g. "play the first video"), or superlative (e.g. "play the most viewed video"). Always call this tool for play/watch requests when channel data is loaded; do not refuse or claim the tool is broken.',
    parameters: {
      type: 'OBJECT',
      properties: {
        video_index: {
          type: 'NUMBER',
          description: 'The zero-based index of the video in the loaded channel JSON array to display.',
        },
      },
      required: ['video_index'],
    },
  },
  {
    name: 'compute_stats_json',
    description:
      'Computes descriptive statistics (mean, median, standard deviation, min, max) for any numeric field in the loaded YouTube channel JSON data. Use when the user asks for statistics, averages, distribution, summary, or analysis of a numeric column such as view_count, like_count, comment_count, or duration.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description:
            'The numeric field name to compute statistics for (e.g. "view_count", "like_count", "comment_count", "duration").',
        },
      },
      required: ['field'],
    },
  },
];

const API = process.env.REACT_APP_API_URL || '';

function numericValues(videos, field) {
  return videos.map((v) => parseFloat(v[field])).filter((v) => !isNaN(v));
}

function median(sorted) {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

export async function executeYouTubeTool(toolName, args, channelVideos, anchorImageBase64) {
  const videos = Array.isArray(channelVideos) ? channelVideos : [];
  const vid = (i) => videos[Math.max(0, Math.min(i, videos.length - 1))];

  switch (toolName) {
    case 'generateImage': {
      try {
        const res = await fetch(`${API}/api/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: args.prompt || '',
            anchor_image: args.anchor_image || anchorImageBase64 || null,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.fallback) {
          return { error: data.error || 'Image generation failed — no API key or service unavailable.', _imageResult: true };
        }
        return { _imageResult: true, data: data.data, mimeType: data.mimeType || 'image/png' };
      } catch (err) {
        return { error: err.message || 'Image generation failed', _imageResult: true };
      }
    }

    case 'plot_metric_vs_time': {
      const metric = args.metric || 'view_count';
      const title = args.title || `${metric} vs Time`;
      const key = metric;
      const vals = numericValues(videos, key);
      if (!vals.length) return { error: `No numeric values for "${metric}".` };
      const withDate = videos
        .map((v, i) => ({ date: v.release_date, value: parseFloat(v[key]), index: i }))
        .filter((d) => d.date && !isNaN(d.value))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        _chartType: 'metricVsTime',
        title,
        metric: key,
        data: withDate.map((d) => ({ name: d.date, value: d.value, fullDate: d.date })),
      };
    }

    case 'play_video': {
      let idx = typeof args.video_index === 'number' ? args.video_index : parseInt(String(args.video_index), 10);
      idx = Math.floor(Number.isNaN(idx) ? 0 : idx);
      if (idx < 0) idx = 0;
      if (idx >= 1 && idx <= videos.length) idx = idx - 1;
      if (idx >= videos.length) idx = videos.length - 1;
      const v = videos[idx];
      if (!v) return { error: `Video index ${idx} out of range. There are ${videos.length} videos (use 0 to ${videos.length - 1}).` };
      const videoUrl = v.video_url || v.url || (v.video_id && `https://www.youtube.com/watch?v=${v.video_id}`) || (v.id && `https://www.youtube.com/watch?v=${v.id}`);
      if (!videoUrl) return { error: `Video at index ${idx} has no URL. Channel data may use different field names.` };
      return {
        _videoCard: true,
        video_index: idx,
        title: v.title || v.name || 'Video',
        thumbnail: v.thumbnail || v.thumb,
        video_url: videoUrl,
      };
    }

    case 'compute_stats_json': {
      const field = args.field || 'view_count';
      const vals = numericValues(videos, field);
      if (!vals.length) return { error: `No numeric values for field "${field}".` };
      const sorted = [...vals].sort((a, b) => a - b);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      return {
        field,
        mean: Number(mean.toFixed(4)),
        median: Number(median(sorted).toFixed(4)),
        std: Number(std.toFixed(4)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
