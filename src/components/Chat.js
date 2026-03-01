import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, chatWithYouTubeTools, CODE_KEYWORDS } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import { executeYouTubeTool } from '../services/youtubeTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import MetricVsTimeChart from './MetricVsTimeChart';
import YouTubeChannelDownload from './YouTubeChannelDownload';
import './Chat.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Encode a string to base64 safely (handles unicode/emoji in tweet text etc.)
const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;

  // Short human-readable preview (header + first 5 rows) for context
  const preview = lines.slice(0, 6).join('\n');

  // Full CSV as base64 — avoids ALL string-escaping issues in Python code execution
  // (tweet text with quotes, apostrophes, emojis, etc. all break triple-quoted strings)
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;

  return { headers, rowCount, preview, base64, truncated };
};

// Extract plain text from a message (for history only — never returns base64)
const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ user, onLogout }) {
  const username = user?.username ?? (typeof user === 'string' ? user : '');
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);     // pending attachment chip
  const [sessionCsvRows, setSessionCsvRows] = useState(null);    // parsed rows for JS tools
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null); // headers for tool routing
  const [csvDataSummary, setCsvDataSummary] = useState(null);    // auto-computed column stats summary
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);   // key-columns CSV string sent directly to Gemini
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [activeMainView, setActiveMainView] = useState('chat');
  const [channelJsonData, setChannelJsonData] = useState(null);
  const [channelJsonMeta, setChannelJsonMeta] = useState(null);
  const [enlargeContent, setEnlargeContent] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  // Set to true immediately before setActiveSessionId() is called during a send
  // so the messages useEffect knows to skip the reload (streaming is in progress).
  const justCreatedSessionRef = useRef(false);

  // On login: load sessions from DB; 'new' means an unsaved pending chat
  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new'); // always start with a fresh empty chat on login
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    // If a session was just created during an active send, messages are already
    // in state and streaming is in progress — don't wipe them.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      try {
        const text = await fileToText(jsonFiles[0]);
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.videos ? parsed.videos : [];
        if (arr.length && (arr[0].title !== undefined || arr[0].video_url !== undefined)) {
          setChannelJsonData(arr);
          const channelName = parsed.channelTitle || jsonFiles[0].name.replace(/\.json$/i, '');
          setChannelJsonMeta({ name: jsonFiles[0].name, count: arr.length, channelName });
          setMessages((prev) => [...prev, { id: `json-${Date.now()}`, role: 'model', content: `📄 Loaded channel data: ${arr.length} videos${channelName ? ` from ${channelName}` : ''}.`, timestamp: new Date().toISOString() }]);
        }
      } catch (_) {}
    }

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        // Parse rows, add computed engagement col, build summary + slim CSV
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (jsonFiles.length > 0) {
      try {
        const text = await fileToText(jsonFiles[0]);
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.videos ? parsed.videos : [];
        if (arr.length && (arr[0].title !== undefined || arr[0].video_url !== undefined)) {
          setChannelJsonData(arr);
          const channelName = parsed.channelTitle || jsonFiles[0].name.replace(/\.json$/i, '');
          setChannelJsonMeta({ name: jsonFiles[0].name, count: arr.length, channelName });
          setMessages((prev) => [...prev, { id: `json-${Date.now()}`, role: 'model', content: `📄 Loaded channel data: ${arr.length} videos${channelName ? ` from ${channelName}` : ''}.`, timestamp: new Date().toISOString() }]);
        }
      } catch (_) {}
    }

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext && !channelJsonMeta) || streaming || !activeSessionId) return;

    // Lazily create the session in DB on the very first message
    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'lisa', title);
      sessionId = id;
      justCreatedSessionRef.current = true; // tell useEffect to skip the reload
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Routing intent (computed first so we know whether Python/base64 is needed) ──
    // PYTHON_ONLY = things the client tools genuinely cannot produce
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const wantCode = CODE_KEYWORDS.test(text) && !sessionCsvRows;
    const capturedCsv = csvContext;
    const hasCsvInSession = !!sessionCsvRows || !!capturedCsv;
    // Base64 is only worth sending when Gemini will actually run Python
    const needsBase64 = !!capturedCsv && wantPythonOnly;
    // Mode selection:
    //   useTools        — CSV loaded + no Python needed → client-side JS tools (free, fast)
    //   useCodeExecution — Python explicitly needed (regression, histogram, etc.)
    //   else            — Google Search streaming (also used for "tell me about this file")
    const useTools = !!sessionCsvRows && !wantPythonOnly && !wantCode && !capturedCsv;
    const useYouTubeTools = !!channelJsonData && channelJsonData.length > 0;
    const useCodeExecution = wantPythonOnly || wantCode && !useYouTubeTools;

    // ── Build prompt ─────────────────────────────────────────────────────────
    // sessionSummary: auto-computed column stats, included with every message
    const sessionSummary = csvDataSummary || '';
    // slimCsv: key columns only (text, type, metrics, engagement) as plain readable CSV
    // ~6-10k tokens — Gemini reads it directly so it can answer from context or call tools
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    const csvPrefix = capturedCsv
      ? needsBase64
        // Python path: send base64 so Gemini can load it with pandas
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        // Standard path: plain CSV text — no encoding needed
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    const channelJsonPrefix = channelJsonData?.length
      ? `[YouTube channel JSON loaded: ${channelJsonData.length} videos${channelJsonMeta?.channelName ? ` from ${channelJsonMeta.channelName}` : ''}. Video titles and indices are available. Use the tools to plot, play, or compute statistics.]\n\n---\n\n`
      : '';

    // userContent  — displayed in bubble and stored in MongoDB (never contains base64)
    // promptForGemini — sent to the Gemini API (may contain the full prefix)
    const userContent = text || (images.length ? '(Image)' : csvContext ? '(CSV attached)' : channelJsonMeta ? '(Channel JSON attached)' : '');
    const promptForGemini = csvPrefix + channelJsonPrefix + (text || (images.length ? 'What do you see in this image?' : channelJsonMeta ? 'I have loaded channel data.' : 'Please analyze this CSV data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setStreaming(true);

    // Store display text only — base64 is never persisted
    await saveMessage(sessionId, 'user', userContent, capturedImages.length ? capturedImages : null);

    const imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));

    // History: plain display text only — session summary handles CSV context on every message
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];

    try {
      if (useYouTubeTools) {
        const channelVideosSummary = `[Loaded ${channelJsonData.length} videos. Titles (by index): ${channelJsonData.slice(0, 20).map((v, i) => `${i}: ${(v.title || '').slice(0, 50)}`).join('; ')}${channelJsonData.length > 20 ? '...' : ''}]`;
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithYouTubeTools(
          history,
          promptForGemini,
          channelVideosSummary,
          (toolName, args) => executeYouTubeTool(toolName, args, channelJsonData, capturedImages[0]?.data),
          user
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else if (useTools) {
        // ── Function-calling path: Gemini picks tool + args, JS executes ──────
        console.log('[Chat] useTools=true | rows:', sessionCsvRows.length, '| headers:', sessionCsvHeaders);
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithCsvTools(
          history,
          promptForGemini,
          sessionCsvHeaders,
          (toolName, args) => executeTool(toolName, args, sessionCsvRows),
          user
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        console.log('[Chat] returnedCharts:', JSON.stringify(toolCharts));
        console.log('[Chat] toolCalls:', toolCalls.map((t) => t.name));
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path: code execution or search ─────────────────────────
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution, user)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    // Save plain text + any tool charts to DB
    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(
      sessionId,
      'model',
      savedContent,
      null,
      toolCharts.length ? toolCharts : null,
      toolCalls.length ? toolCalls : null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <nav className="sidebar-nav-tabs">
            <button
              type="button"
              className={`sidebar-tab ${activeMainView === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveMainView('chat')}
            >
              Chat
            </button>
            <button
              type="button"
              className={`sidebar-tab ${activeMainView === 'yt-download' ? 'active' : ''}`}
              onClick={() => setActiveMainView('yt-download')}
            >
              YouTube Channel Download
            </button>
          </nav>
          <button className="new-chat-btn" onClick={handleNewChat} style={{ display: activeMainView === 'chat' ? 'block' : 'none' }}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{username}</span>
          <button onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────── */}
      <div className="chat-main">
        {activeMainView === 'yt-download' ? (
          <YouTubeChannelDownload />
        ) : (
        <>
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
        </header>

        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? username : 'Lisa'}</span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* CSV badge on user messages */}
              {m.csvName && (
                <div className="msg-csv-badge">
                  📄 {m.csvName}
                </div>
              )}

              {/* Image attachments */}
              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              {/* Message body */}
              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Tool calls log */}
              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && !tc.result._imageResult && !tc.result._videoCard && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                        {(tc.result?._chartType || tc.result?._imageResult || tc.result?._videoCard) && (
                          <span className="tool-call-result">→ rendered below</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* YouTube tool results: video cards, generated images, stats */}
              {m.toolCalls?.map((tc, ti) => {
                const r = tc.result;
                if (r?._videoCard && r.video_url) {
                  const videoId = r.video_url.match(/(?:v=|\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
                  return (
                    <div key={ti} className="chat-video-card-wrap">
                      <div className="chat-video-card-header">
                        {r.thumbnail && <img src={r.thumbnail} alt="" className="chat-video-card-thumb" />}
                        <span className="chat-video-card-title">{r.title || 'Video'}</span>
                        <a href={r.video_url} target="_blank" rel="noreferrer" className="chat-video-open-yt">Open on YouTube</a>
                      </div>
                      {videoId && (
                        <div className="chat-video-embed">
                          <iframe
                            title={r.title || 'YouTube video'}
                            src={`https://www.youtube.com/embed/${videoId}`}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      )}
                    </div>
                  );
                }
                if (r?._imageResult && r.data && !r.error) {
                  return (
                    <div key={ti} className="chat-generated-image-wrap">
                      <img
                        src={`data:${r.mimeType || 'image/png'};base64,${r.data}`}
                        alt="Generated"
                        className="chat-generated-image"
                        onClick={() => setEnlargeContent({ type: 'image', data: r.data, mimeType: r.mimeType })}
                      />
                      <button type="button" className="chat-download-img-btn" onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `data:${r.mimeType};base64,${r.data}`; a.download = 'generated.png'; a.click(); }}>Download</button>
                    </div>
                  );
                }
                if (r?.field !== undefined && r.mean !== undefined) {
                  return (
                    <div key={ti} className="chat-stats-block">
                      <p className="chat-stats-title">📊 Statistics for {r.field}:</p>
                      <p className="chat-stats-row">Mean: {Number(r.mean).toLocaleString()}</p>
                      <p className="chat-stats-row">Median: {Number(r.median).toLocaleString()}</p>
                      <p className="chat-stats-row">Std Dev: {Number(r.std).toLocaleString()}</p>
                      <p className="chat-stats-row">Min: {Number(r.min).toLocaleString()}</p>
                      <p className="chat-stats-row">Max: {Number(r.max).toLocaleString()}</p>
                    </div>
                  );
                }
                return null;
              })}
              {/* Engagement charts from tool calls */}
              {m.charts?.map((chart, ci) =>
                chart._chartType === 'engagement' ? (
                  <EngagementChart
                    key={`eng-${ci}`}
                    data={chart.data}
                    metricColumn={chart.metricColumn}
                  />
                ) : chart._chartType === 'metricVsTime' ? (
                  <MetricVsTimeChart
                    key={`metric-${ci}`}
                    data={chart.data}
                    metric={chart.metric}
                    title={chart.title}
                    onEnlarge={() => setEnlargeContent({ type: 'chart', chart })}
                  />
                ) : null
              )}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {/* Channel JSON chip */}
          {channelJsonMeta && (
            <div className="csv-chip channel-json-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{channelJsonMeta.name}</span>
              <span className="csv-chip-meta">
                {channelJsonMeta.count} videos{channelJsonMeta.channelName ? ` · ${channelJsonMeta.channelName}` : ''}
              </span>
              <button className="csv-chip-remove" onClick={() => { setChannelJsonMeta(null); setChannelJsonData(null); }} aria-label="Remove JSON">×</button>
            </div>
          )}
          {/* CSV chip */}
          {csvContext && (
            <div className="csv-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{csvContext.name}</span>
              <span className="csv-chip-meta">
                {csvContext.rowCount} rows · {csvContext.headers.length} cols
              </span>
              <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
            </div>
          )}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image or CSV"
            >
              📎
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask a question, request analysis, or write & run code…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste}
              disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && !images.length && !csvContext && !channelJsonMeta}
              >
                Send
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </div>
      {enlargeContent && (
        <div className="chat-enlarge-overlay" onClick={() => setEnlargeContent(null)}>
          <div className="chat-enlarge-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="chat-enlarge-close" onClick={() => setEnlargeContent(null)} aria-label="Close">×</button>
            {enlargeContent.type === 'image' && (
              <>
                <img src={`data:${enlargeContent.mimeType || 'image/png'};base64,${enlargeContent.data}`} alt="Enlarged" className="chat-enlarge-img" />
                <a href={`data:${enlargeContent.mimeType};base64,${enlargeContent.data}`} download="generated.png" className="chat-enlarge-download">Download</a>
              </>
            )}
            {enlargeContent.type === 'chart' && enlargeContent.chart && (
              <>
                <div className="chat-enlarge-chart" ref={(el) => { if (el && !el._chartRef) { el._chartRef = true; } }}>
                  <MetricVsTimeChart data={enlargeContent.chart.data} metric={enlargeContent.chart.metric} title={enlargeContent.chart.title} />
                </div>
                <a href="#" className="chat-enlarge-download" onClick={(e) => { e.preventDefault(); const el = document.querySelector('.chat-enlarge-chart'); if (el) { const svg = el.querySelector('svg'); if (svg) { const s = new XMLSerializer().serializeToString(svg); const blob = new Blob([s], { type: 'image/svg+xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chart.svg'; a.click(); URL.revokeObjectURL(a.href); } } }}>Download (SVG)</a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
