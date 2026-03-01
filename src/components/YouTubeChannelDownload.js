import { useState, useCallback } from 'react';

const API = process.env.REACT_APP_API_URL || '';

export default function YouTubeChannelDownload() {
  const [url, setUrl] = useState('https://www.youtube.com/@veritasium');
  const [maxVideos, setMaxVideos] = useState(10);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleDownload = useCallback(async () => {
    setError('');
    setResult(null);
    const max = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
    setProgress({ current: 0, total: max });

    try {
      const res = await fetch(`${API}/api/youtube/channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), maxVideos: max }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let doneData = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'progress') {
              setProgress({ current: obj.current, total: obj.total });
            } else if (obj.type === 'done') {
              doneData = { channelTitle: obj.channelTitle, videos: obj.videos };
            }
          } catch (_) {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer);
          if (obj.type === 'done') doneData = { channelTitle: obj.channelTitle, videos: obj.videos };
        } catch (_) {}
      }
      setProgress(null);
      if (doneData) setResult(doneData);
      else throw new Error('No data received');
    } catch (err) {
      setProgress(null);
      setError(err.message || 'Download failed');
    }
  }, [url, maxVideos]);

  const handleDownloadJson = useCallback(() => {
    if (!result?.videos) return;
    const blob = new Blob([JSON.stringify(result.videos, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `channel_data_${(result.channelTitle || 'channel').replace(/\W+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [result]);

  return (
    <div className="yt-download-page">
      <h2 className="yt-download-title">YouTube Channel Download</h2>
      <div className="yt-download-form">
        <input
          type="text"
          placeholder="Channel URL (e.g. https://www.youtube.com/@veritasium)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="yt-download-input"
        />
        <div className="yt-download-row">
          <label>
            Max videos:{' '}
            <input
              type="number"
              min={1}
              max={100}
              value={maxVideos}
              onChange={(e) => setMaxVideos(Number(e.target.value) || 10)}
              className="yt-download-num"
            />
          </label>
          <button type="button" onClick={handleDownload} disabled={!!progress} className="yt-download-btn">
            Download Channel Data
          </button>
        </div>
      </div>
      {progress && (
        <div className="yt-download-progress-wrap">
          <div className="yt-download-progress-bar">
            <div
              className="yt-download-progress-fill"
              style={{ width: `${(100 * progress.current) / progress.total}%` }}
            />
          </div>
          <p className="yt-download-progress-text">
            Fetching video {progress.current} of {progress.total}…
          </p>
        </div>
      )}
      {error && <p className="yt-download-error">{error}</p>}
      {result && !progress && (
        <div className="yt-download-summary">
          <p className="yt-download-summary-text">
            Downloaded {result.videos.length} videos from {result.channelTitle}.
          </p>
          <button type="button" onClick={handleDownloadJson} className="yt-download-json-btn">
            Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
