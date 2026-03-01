require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    if (firstName == null || lastName == null || !String(firstName).trim() || !String(lastName).trim())
      return res.status(400).json({ error: 'First name and last name required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const doc = {
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      createdAt: new Date().toISOString(),
    };
    doc.firstName = String(firstName).trim();
    doc.lastName = String(lastName).trim();
    await db.collection('users').insertOne(doc);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate image (Gemini first, then DALL-E if key set, else placeholder) ─
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-exp-image-generation';
const GEMINI_IMAGE_TIMEOUT_MS = 45000; // 45s — image gen can be slow

function getImagePartFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data;
    if (inline?.data) return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' };
  }
  return null;
}

app.post('/api/generate-image', async (req, res) => {
  let fallbackReason = '';
  try {
    const { prompt, anchor_image } = req.body;
    const textPrompt = String(prompt || '').slice(0, 1000);
    const geminiKey = process.env.REACT_APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const openaiKey = process.env.REACT_APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    console.log('[generate-image] geminiKey present:', !!geminiKey, 'length:', geminiKey?.length);

    if (!geminiKey) {
      fallbackReason = 'No Gemini API key on server. Set GEMINI_API_KEY or REACT_APP_GEMINI_API_KEY in .env and restart the server.';
    } else if (!textPrompt) {
      fallbackReason = 'No prompt provided.';
    }

    // 1. Try Gemini image generation
    if (geminiKey && textPrompt) {
      const parts = [{ text: `Generate an image: ${textPrompt}` }];
      if (anchor_image && typeof anchor_image === 'string') {
        parts.unshift({
          inlineData: {
            mimeType: 'image/png',
            data: anchor_image.replace(/^data:image\/\w+;base64,/, ''),
          },
        });
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_IMAGE_TIMEOUT_MS);
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
              },
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
        const data = await geminiRes.json().catch(() => ({}));
        if (geminiRes.ok) {
          const imagePart = getImagePartFromGeminiResponse(data);
          if (imagePart) {
            return res.json({ data: imagePart.data, mimeType: imagePart.mimeType });
          }
          fallbackReason = 'Gemini returned no image (model may not support image generation for this key).';
          console.warn('[generate-image] Gemini 200 but no image. Keys:', data ? Object.keys(data) : [], 'parts length:', data?.candidates?.[0]?.content?.parts?.length);
        } else {
          const errMsg = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200);
          fallbackReason = `Gemini API error (${geminiRes.status}): ${errMsg}`;
          console.warn('[generate-image] Gemini error', geminiRes.status, errMsg);
        }
      } catch (geminiErr) {
        clearTimeout(timeoutId);
        if (geminiErr.name === 'AbortError') {
          fallbackReason = `Gemini timed out after ${GEMINI_IMAGE_TIMEOUT_MS / 1000}s.`;
          console.warn('[generate-image] Gemini timed out');
        } else {
          fallbackReason = `Gemini request failed: ${geminiErr.message}`;
          console.warn('[generate-image] Gemini request failed:', geminiErr.message);
        }
      }
    }

    // 2. Fallback: OpenAI DALL-E if key is set
    if (openaiKey && textPrompt) {
      const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-2',
          prompt: textPrompt,
          n: 1,
          size: '256x256',
          response_format: 'b64_json',
        }),
      });
      if (openaiRes.ok) {
        const data = await openaiRes.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) return res.json({ data: b64, mimeType: 'image/png' });
      }
      fallbackReason = fallbackReason || 'DALL-E request failed or returned no image.';
    }

    // 3. No image from any provider
    const placeholder = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    res.json({
      data: placeholder,
      mimeType: 'image/png',
      fallback: true,
      error: fallbackReason || 'No image generation API available or all attempts failed.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube channel download ─────────────────────────────────────────────────
const { fetchChannelData } = require('./youtubeChannel');

app.post('/api/youtube/channel', async (req, res) => {
  try {
    const { url, maxVideos } = req.body;
    const max = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
    if (!url || !String(url).trim())
      return res.status(400).json({ error: 'Channel URL required' });
    let headersSent = false;
    const sendProgress = (current, total) => {
      if (!headersSent) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        headersSent = true;
      }
      res.write(JSON.stringify({ type: 'progress', current, total }) + '\n');
    };
    const { channelTitle, videos } = await fetchChannelData(url, max, sendProgress);
    if (!headersSent) res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ type: 'done', channelTitle, videos }) + '\n');
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
