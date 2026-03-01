require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { fetchChannelData } = require('../server/youtubeChannel');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_FILE = path.join(PUBLIC_DIR, 'veritasium_channel_data.json');

async function main() {
  console.log('Fetching 10 videos from https://www.youtube.com/@veritasium ...');
  const { channelTitle, videos } = await fetchChannelData(
    'https://www.youtube.com/@veritasium',
    10,
    (current, total) => console.log(`Fetching video ${current} of ${total}…`)
  );
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(videos, null, 2), 'utf8');
  console.log(`Wrote ${videos.length} videos to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
