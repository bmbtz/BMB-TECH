const { bmbtz } = require("../../devbmb/bmbtz");
const axios = require('axios');
const yts = require('yt-search');

const BOT_NAME = 'BMB-TECH'; // Change as you want
const NEWSLETTER_JID = '120363382023564830@newsletter';
const NEWSLETTER_NAME = 'Bmb Tech Info';

/**
 * What the user sees (2 messages, nothing else):
 *   1. the picture with the details, sent as soon as the YouTube search is done
 *   2. the song / video itself
 *
 * To make it fast, the download link is requested right after the search, while the picture is sent.
 */

const buildCaption = (type, video) => {
  const banner = type === "video" ? `${BOT_NAME} VIDEO PLAYER` : `${BOT_NAME} SONG PLAYER`;
  return (
    `*${banner}*\n\n` +
    `╭───────────────◆\n` +
    `│⿻ *Title:* ${video.title}\n` +
    `│⿻ *Duration:* ${video.timestamp || 'LIVE'}\n` +
    `│⿻ *Views:* ${Number(video.views || 0).toLocaleString()}\n` +
    `│⿻ *Uploaded:* ${video.ago || '-'}\n` +
    `│⿻ *Channel:* ${(video.author && video.author.name) || '-'}\n` +
    `╰────────────────◆\n\n` +
    `🔗 ${video.url}`
  );
};

// getContextInfo takes the query and the bot name, and includes body and title
const getContextInfo = (query = '', botName = BOT_NAME) => ({
  forwardingScore: 1,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: NEWSLETTER_JID,
    newsletterName: NEWSLETTER_NAME,
    serverMessageId: -1
  },
  body: query ? `Requested song: ${query}` : undefined,
  title: botName
});

// ---------------------------------------------------------------------------
// DOWNLOAD SOURCES
// Every source is tried in order; the first one that gives a link that WhatsApp can open wins.
//   - davidcyril is first (it is the one that works best for this bot)
//   - the others are backups: Knight, Prince, Hector, Yupra, EliteProTech, Okatsu, Prexzy, Izumi
// Optional keys / addresses (environment variables):
//   DAVIDCYRIL_API_KEY, KNIGHT_API_URL, KNIGHT_API_KEY, PRINCE_API_URL, PRINCE_API_KEY
// ---------------------------------------------------------------------------
const API_BASE = 'https://apis.davidcyril.name.ng';
const API_KEY = process.env.DAVIDCYRIL_API_KEY || '';
const KNIGHT_BASE = String(process.env.KNIGHT_API_URL || 'https://knightbotapi.stream').replace(/\/$/, '');
const KNIGHT_KEY = process.env.KNIGHT_API_KEY || 'knight';
const PRINCE_BASE = String(process.env.PRINCE_API_URL || 'https://api.princetechn.com').replace(/\/$/, '');
const PRINCE_KEY = process.env.PRINCE_API_KEY || 'prince';

// How long ONE source may take, and how long all sources together may take before we give up.
// Converting a video takes much longer than a song, so it gets more time.
const API_TIMEOUT_MS = { audio: 30000, video: 90000 };
const TOTAL_BUDGET_MS = { audio: 150000, video: 300000 };
const VIDEO_QUALITY = '360'; // small enough to send quickly, clear enough on a phone
const MAX_VIDEO_BYTES = 90 * 1024 * 1024; // the biggest video the bot downloads itself

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const pickUrl = (r) => {
  const u = r && (r.download || r.dl_url || r.dl || r.downloadUrl || r.downloadURL);
  return isHttp(u) ? u : null;
};
const anyLink = (r) => pickUrl(r) || (isHttp(r && r.download_url) ? r.download_url : null) || (isHttp(r && r.url) ? r.url : null) || (r && r.audio && isHttp(r.audio.url) ? r.audio.url : null);
const isIpLocked = (u) => /googlevideo\.com|youtube\.com\/videoplayback/i.test(String(u || ''));
const watchUrl = (video) => (video.videoId ? `https://youtu.be/${video.videoId}` : video.url);

/** GET + JSON. Never throws on a bad HTTP code by itself: the message is made readable here. */
async function getJson(url, params, c, headers = {}) {
  const res = await axios.get(url, {
    params,
    timeout: c.timeout,
    validateStatus: () => true,
    headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
  });
  const data = res.data;
  if (res.status >= 400) {
    const why = data && typeof data === 'object' ? (data.message || data.error || (data.result && data.result.error) || '') : '';
    throw new Error(`HTTP ${res.status}${why ? ' - ' + String(why).slice(0, 100) : ''}`);
  }
  return data;
}
const said = (data) => (data && typeof data === 'object' ? (data.message || data.error || (data.result && data.result.error) || '') : '');

// quality helpers (from the other bot's api.js)
const qualityNumber = (value, fallback = '360') => (String(value || '').match(/(\d{3,4})/) || [])[1] || fallback;
function pickQualityUrl(videos, wanted = '360') {
  if (!videos || typeof videos !== 'object' || Array.isArray(videos)) return null;
  const ladder = ['1080', '720', '480', '360', '240', '144'];
  const want = qualityNumber(wanted);
  const start = Math.max(0, ladder.indexOf(want));
  for (const q of ladder.slice(start).concat(ladder.slice(0, start))) {
    const url = videos[q] || videos[`${q}p`];
    if (isHttp(url)) return url;
  }
  return null;
}

// ----- davidcyril (apis.davidcyril.name.ng) -----
const david = (name, path, by, pick) => ({
  name,
  run: async (c) => {
    const headers = API_KEY ? { 'X-API-Key': API_KEY } : {};
    const params = by === 'q' ? { q: c.video.title || c.query } : { url: c.video.url };
    const data = await getJson(`${API_BASE}${path}`, params, c, headers);
    const ok = data && (data.success === true || data.status === true || data.status === 200) && data.result;
    const link = ok ? (pick(data.result) || anyLink(data.result)) : null;
    if (!link) throw new Error(said(data) || 'no link in the answer');
    return { downloadUrl: link, title: data.result.title || '' };
  },
});

// ----- Knight -----
const knight = (name, path, extra, pickFrom) => ({
  name,
  run: async (c) => {
    const data = await getJson(`${KNIGHT_BASE}${path}`, { apikey: KNIGHT_KEY, url: watchUrl(c.video), ...extra }, c);
    if (!data || !data.success) throw new Error(said(data) || 'no success');
    const result = data.result || data;
    const link = pickFrom ? pickFrom(result) : pickUrl(result);
    if (!isHttp(link)) throw new Error('no download URL');
    return { downloadUrl: link, title: result.title || '' };
  },
});

// ----- Prince -----
const prince = (name, path, extra, pickFrom) => ({
  name,
  run: async (c) => {
    const data = await getJson(`${PRINCE_BASE}${path}`, { apikey: PRINCE_KEY, url: watchUrl(c.video), ...extra }, c);
    const result = (data && data.result) || data;
    if (!data || data.success === false || (result && result.error)) throw new Error(said(data) || (result && result.error) || 'failed');
    const link = pickFrom(result);
    if (!isHttp(link)) throw new Error('no download URL');
    return { downloadUrl: link, title: (result && result.title) || '' };
  },
});

// ----- Hector (one address for audio and video) -----
const HECTOR_URL = 'https://yt-dl.officialhectormanuel.workers.dev';
const hector = (name, pickFrom) => ({
  name,
  run: async (c) => {
    const data = await getJson(HECTOR_URL, { url: watchUrl(c.video) }, c);
    if (!data || data.status === false) throw new Error(said(data) || 'failed');
    const link = pickFrom(data);
    if (!isHttp(link) || /[?&]format=mp3(?:&|$)/i.test(link) && c.kind === 'video') throw new Error('no usable URL');
    return { downloadUrl: link, title: data.title || '' };
  },
});

// ----- the simple ones: one address, one field -----
const simple = (name, url, params, check, pickFrom, titleFrom) => ({
  name,
  run: async (c) => {
    const data = await getJson(url, params(c), c);
    if (!check(data)) throw new Error(said(data) || 'no link in the answer');
    const link = pickFrom(data);
    if (!isHttp(link)) throw new Error('no download URL');
    return { downloadUrl: link, title: (titleFrom && titleFrom(data)) || '' };
  },
});
const ELITE = 'https://eliteprotech-apis.zone.id/ytdown';
const YUPRA = 'https://api.yupra.my.id/api/downloader';
const OKATSU = 'https://okatsu-rolezapiiz.vercel.app/downloader';

const SOURCES = {
  audio: [
    david('davidcyril ytmp3', '/download/ytmp3', 'url', (r) => r.download_url),
    david('davidcyril ytmp3-v2', '/download/ytmp3-v2', 'url', (r) => r.download),
    david('davidcyril play-v2', '/play-v2', 'q', (r) => r.audio && r.audio.url),
    knight('knight', '/api/download/ytaudio', { format: '128kbps' }),
    prince('prince', '/api/download/ytmp3', {}, (r) => r.downloadUrl || pickUrl(r)),
    hector('hector', (d) => d.audio),
    simple('yupra', `${YUPRA}/ytmp3`, (c) => ({ url: watchUrl(c.video) }), (d) => d && d.success && d.data, (d) => d.data.download_url, (d) => d.data.title),
    simple('elite', ELITE, (c) => ({ url: watchUrl(c.video), format: 'mp3' }), (d) => d && d.success, (d) => d.downloadURL, (d) => d.title),
    simple('okatsu', `${OKATSU}/ytmp3`, (c) => ({ url: watchUrl(c.video) }), (d) => d && d.dl, (d) => d.dl, (d) => d.title),
    simple('prexzy', 'https://prexzyapis.com/download/ytmp3', (c) => ({ url: watchUrl(c.video) }), (d) => d && d.status && d.download_url && !isIpLocked(d.download_url), (d) => d.download_url, (d) => d.info && d.info.title),
    simple('izumi', 'https://izumiiiiiiii.dpdns.org/downloader/youtube', (c) => ({ url: watchUrl(c.video), format: 'mp3' }), (d) => d && d.result && d.result.download, (d) => d.result.download, (d) => d.result.title),
  ],
  video: [
    david('davidcyril ytmp4', '/download/ytmp4', 'url', (r) => r.download_url),
    knight('knight', '/api/download/ytmp4', { format: `${VIDEO_QUALITY}p` }),
    prince('prince', '/api/download/ytvideo', { quality: VIDEO_QUALITY },
      (r) => (isHttp(r.downloadUrl || r.download_url || r.video || pickUrl(r)) ? (r.downloadUrl || r.download_url || r.video || pickUrl(r)) : pickQualityUrl(r.videos, VIDEO_QUALITY))),
    hector('hector', (d) => pickQualityUrl(d.videos, VIDEO_QUALITY) || pickQualityUrl(d.result && d.result.videos, VIDEO_QUALITY)),
    simple('yupra', `${YUPRA}/ytmp4`, (c) => ({ url: watchUrl(c.video) }), (d) => d && d.success && d.data, (d) => d.data.download_url, (d) => d.data.title),
    simple('elite', ELITE, (c) => ({ url: watchUrl(c.video), format: 'mp4' }), (d) => d && d.success, (d) => d.downloadURL, (d) => d.title),
    simple('okatsu', `${OKATSU}/ytmp4`, (c) => ({ url: watchUrl(c.video) }), (d) => d && d.result && d.result.mp4, (d) => d.result.mp4, (d) => d.result.title),
    david('davidcyril mp4 v2', '/youtube/mp444', 'url', (r) => r.url), // its link is tied to one address, so it is the last resort
  ],
};

const shortError = (err) => {
  if (!err) return 'unknown error';
  const status = err.response && err.response.status;
  const body = err.response && err.response.data;
  const detail = body && typeof body === 'object' ? (body.message || body.error || JSON.stringify(body)) : (typeof body === 'string' ? body : '');
  const base = err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '') ? 'timed out' : (err.message || String(err));
  return `${status ? 'HTTP ' + status + ' ' : ''}${base}${detail ? ' - ' + String(detail).slice(0, 120) : ''}`.slice(0, 220);
};

/** Asks ONE source for a link. Throws when it has none. */
async function fetchFromSource(kind, src, video, query) {
  return src.run({ kind, video, query, timeout: API_TIMEOUT_MS[kind] || 30000 });
}

/** The sources that are still allowed to run (the time budget is not used up). */
function* sourcesWithinBudget(kind) {
  const started = Date.now();
  for (const src of SOURCES[kind]) {
    if (Date.now() - started > (TOTAL_BUDGET_MS[kind] || 150000)) {
      console.log('[PLAY] time budget used up, no more sources are tried');
      return;
    }
    yield src;
  }
}

/**
 * Gets a download link for the video that was found. kind: "audio" | "video".
 * Every source is tried once; the next one is used when it fails.
 */
async function getLink(kind, video, query) {
  const problems = [];
  for (const src of sourcesWithinBudget(kind)) {
    try {
      return await fetchFromSource(kind, src, video, query);
    } catch (err) {
      problems.push(`${src.name}: ${shortError(err)}`);
      console.log('[PLAY] source failed, trying the next one:', problems[problems.length - 1]);
    }
  }
  const error = new Error(problems.join(' | ') || 'No download source answered.');
  error.details = problems;
  throw error;
}

/**
 * Gets a link AND sends the file. If the file can not be sent (the link is dead, blocked, or WhatsApp
 * could not download it), the next source is tried. `send(result)` does the actual sending.
 */
async function sendWithFallback(kind, video, query, send) {
  const problems = [];
  for (const src of sourcesWithinBudget(kind)) {
    try {
      const result = await fetchFromSource(kind, src, video, query);
      await send(result);
      return result;
    } catch (err) {
      problems.push(`${src.name}: ${shortError(err)}`);
      console.log('[PLAY] source failed, trying the next one:', problems[problems.length - 1]);
    }
  }
  const error = new Error(problems.join(' | ') || 'No download source answered.');
  error.details = problems;
  throw error;
}

/**
 * Sends a video. WhatsApp downloads the link itself first; if that fails (some servers refuse it),
 * the bot downloads the file and sends it from memory.
 */
async function sendVideoFile(client, to, ms, result, fallbackName) {
  const fileName = `${result.title || fallbackName}.mp4`;
  try {
    return await client.sendMessage(to, { video: { url: result.downloadUrl }, mimetype: 'video/mp4', fileName }, { quoted: ms });
  } catch (firstError) {
    console.log('[PLAY] sending the link failed, downloading the video first:', shortError(firstError));
    const file = await axios.get(result.downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: MAX_VIDEO_BYTES,
      maxBodyLength: MAX_VIDEO_BYTES,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
    });
    return client.sendMessage(to, { video: Buffer.from(file.data), mimetype: 'video/mp4', fileName }, { quoted: ms });
  }
}

/** Starts a request now and makes sure an early failure can never crash the bot while we wait. */
function startEarly(promiseFactory) {
  const promise = promiseFactory();
  promise.catch(() => {});
  return promise;
}

const text = (client, to, ms, message) =>
  client.sendMessage(to, { text: message, contextInfo: getContextInfo() }, { quoted: ms });

/**
 * One implementation for the three commands.
 *   kind "audio"    -> .play  (audio message)
 *   kind "document" -> .song  (audio as a file)
 *   kind "video"    -> .video (mp4)
 */
function registerCommand({ nomCom, reaction, kind, askText, label }) {
  bmbtz(
    { nomCom, categorie: "Search", reaction },
    async (origineMessage, client, commandeOptions) => {
      const { ms, arg } = commandeOptions;
      const query = arg.join(' ');
      if (!query) return text(client, origineMessage, ms, askText);

      try {
        const search = await yts(query);
        const video = search.videos[0];
        if (!video) return text(client, origineMessage, ms, 'No results found for your query.');

        // The download link is requested right after the search, while the picture is already on its way.
        const linkEarly = startEarly(() => getLink(kind === 'video' ? 'video' : 'audio', video, query));

        await client.sendMessage(
          origineMessage,
          {
            image: { url: video.thumbnail },
            caption: buildCaption(kind === 'video' ? 'video' : (kind === 'document' ? 'song' : 'audio'), video),
            contextInfo: getContextInfo(kind === 'audio' ? query : '')
          },
          { quoted: ms }
        );

        let result;
        try {
          result = await linkEarly;
        } catch (err) {
          console.error(`[${nomCom.toUpperCase()}] download link error:`, err && err.message ? err.message : err);
          return text(client, origineMessage, ms, `Failed to retrieve the ${label} download link.`);
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const downloadUrl = result.downloadUrl;

        if (kind === 'audio') {
          const fileName = `${result.title || safeTitle}.mp3`;
          await client.sendMessage(
            origineMessage,
            {
              audio: { url: downloadUrl },
              mimetype: 'audio/mpeg',
              fileName,
              title: BOT_NAME,
              body: `Requested song :${query}`,
              image: { url: video.thumbnail, renderSmallThumbnail: true },
              contextInfo: getContextInfo()
            },
            { quoted: ms }
          );
        } else if (kind === 'document') {
          const fileName = `${result.title || safeTitle}.mp3`;
          await client.sendMessage(
            origineMessage,
            { document: { url: downloadUrl }, mimetype: 'audio/mpeg', fileName },
            { quoted: ms }
          );
        } else {
          const fileName = `${result.title || safeTitle}.mp4`;
          await client.sendMessage(
            origineMessage,
            { video: { url: downloadUrl }, mimetype: 'video/mp4', fileName },
            { quoted: ms }
          );
        }
      } catch (err) {
        console.error(`[${nomCom.toUpperCase()}] Error:`, err);
        await text(client, origineMessage, ms, 'An error occurred while processing your request.');
      }
    }
  );
}

// SONG COMMAND (audio as document) - sends the file straight away
registerCommand({ nomCom: "song", reaction: "🎶", kind: "document", askText: 'Please provide a song name or keyword.', label: 'MP3' });

// ---------------------------------------------------------------------------
// PLAY and VIDEO with buttons (Toxic-MD style)
//   .play <name>  or  .video <name>  -> picture + details + 3 buttons: [🎵 AUDIO] [📄 DOCUMENT] [🎬 VIDEO]
//   tapping a button sends that format for the song that was found.
// The buttons carry a short code; the found video is kept in memory for 30 minutes.
// ---------------------------------------------------------------------------
let buttons = null;
try {
  buttons = require('../../lib/buttons');
} catch (e) {
  console.log('⚠️ [play] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.');
}

const CHOICE_TTL_MS = 30 * 60 * 1000;
const pending = new Map(); // code -> { video, query, at }

function rememberChoice(video, query) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > CHOICE_TTL_MS) pending.delete(k);
  if (pending.size > 500) pending.delete(pending.keys().next().value);
  let code;
  do { code = Math.random().toString(36).slice(2, 8); } while (pending.has(code));
  pending.set(code, { video, query, at: now });
  return code;
}

async function pictureOf(video) {
  try {
    const res = await axios.get(video.thumbnail, { responseType: 'arraybuffer', timeout: 8000 });
    return Buffer.from(res.data);
  } catch (e) {
    return undefined; // the picture from settings.js is used instead
  }
}

function registerChoice({ nomCom, reaction, askText, banner }) {
  bmbtz(
    { nomCom, categorie: "Search", reaction },
    async (origineMessage, client, commandeOptions) => {
      const { ms, arg, prefixe, mybotpic } = commandeOptions;
      const query = arg.join(' ');
      if (!query) return text(client, origineMessage, ms, askText);
      const p = prefixe || '.';

      try {
        const search = await yts(query);
        const video = search.videos[0];
        if (!video) return text(client, origineMessage, ms, 'No results found for your query.');

        const code = rememberChoice(video, query);
        const list = [
          { text: '🎵 AUDIO', id: `${p}playaudio ${code}` },
          { text: '📄 DOCUMENT', id: `${p}playdoc ${code}` },
          { text: '🎬 VIDEO', id: `${p}playvideo ${code}` },
        ];
        const body = buildCaption(banner, video);

        if (!buttons) {
          return text(client, origineMessage, ms, `${body}\n\nType one of these:\n${list.map((b) => '• ' + b.id).join('\n')}`);
        }
        await buttons.sendButtons(client, origineMessage, {
          body,
          title: banner === 'video' ? 'VIDEO PLAYER' : 'SONG PLAYER',
          buttons: list,
          thumbnail: await pictureOf(video),
          mybotpic,
        });
      } catch (err) {
        console.error(`[${nomCom.toUpperCase()}] Error:`, err);
        await text(client, origineMessage, ms, 'An error occurred while processing your request.');
      }
    }
  );
}

/** The commands behind the buttons. They are hidden from the menu. */
function registerDeliver({ nomCom, kind, label, reaction }) {
  bmbtz(
    { nomCom, categorie: "Search", reaction, hidden: true },
    async (origineMessage, client, commandeOptions) => {
      const { ms, arg } = commandeOptions;
      const item = pending.get(String((arg && arg[0]) || '').trim());
      if (!item) {
        return text(client, origineMessage, ms, 'This choice has expired. Search again, for example: .play <song name>');
      }
      const { video, query } = item;
      const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
      try {
        if (kind === 'video') {
          await text(client, origineMessage, ms, 'Preparing your video, please wait...');
        }
        await sendWithFallback(kind === 'video' ? 'video' : 'audio', video, query, async (result) => {
          const downloadUrl = result.downloadUrl;
          if (kind === 'audio') {
            await client.sendMessage(
              origineMessage,
              {
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                fileName: `${result.title || safeTitle}.mp3`,
                title: BOT_NAME,
                body: `Requested song :${query}`,
                image: { url: video.thumbnail, renderSmallThumbnail: true },
                contextInfo: getContextInfo()
              },
              { quoted: ms }
            );
          } else if (kind === 'document') {
            await client.sendMessage(
              origineMessage,
              { document: { url: downloadUrl }, mimetype: 'audio/mpeg', fileName: `${result.title || safeTitle}.mp3` },
              { quoted: ms }
            );
          } else {
            await sendVideoFile(client, origineMessage, ms, result, safeTitle);
          }
        });
      } catch (err) {
        console.error(`[${nomCom.toUpperCase()}] Error:`, err && err.message ? err.message : err);
        const shown = err && err.details ? err.details.slice(0, 3) : [];
        const more = err && err.details && err.details.length > 3 ? `\n(+${err.details.length - 3} more sources failed, see the logs)` : '';
        const why = shown.length ? `\n\nReason:\n${shown.join('\n')}${more}` : '';
        await text(client, origineMessage, ms, `Failed to send the ${label} file. Please try again in a moment.${why}`);
      }
    }
  );
}

registerChoice({ nomCom: "play", reaction: "🎵", askText: 'Please provide a song name or keyword.', banner: 'audio' });
registerChoice({ nomCom: "video", reaction: "🎬", askText: 'Please provide a video name or keyword.', banner: 'video' });

registerDeliver({ nomCom: "playaudio", kind: "audio", label: "MP3", reaction: "🎵" });
registerDeliver({ nomCom: "playdoc", kind: "document", label: "MP3", reaction: "📄" });
registerDeliver({ nomCom: "playvideo", kind: "video", label: "MP4", reaction: "🎬" });
