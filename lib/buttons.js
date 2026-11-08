"use strict";
/**
 * lib/buttons.js
 *
 * Sends the choice buttons used by .antilink, .anticall, .antidelete, .mode, .welcome ...
 * The picture on top comes from settings.js (URL / BOT_MENU_LINKS, a random link of the list).
 *
 * Styles (set with .buttonstyle, default "toxic"):
 *   native - picture + message + rounded buttons (interactiveMessage / nativeFlow quick_reply,
 *            sent the way .pair sends its button - known to show on this bot). Buttons have a reply arrow.
 *   toxic  - the exact Toxic-MD menu look: picture, message, footer and plain rounded buttons without
 *            arrows (buttonsMessage, the library adds its own <biz> node).
 *   v2     - same as toxic but with Toxic-MD's own extra <biz> node (for libraries that do not add one).
 *   list   - a "Choose an option" picker
 *   text   - no buttons, the commands are listed
 * toxic / v2 can be dropped silently by WhatsApp on some libraries; if a card does not appear,
 * send .buttonstyle native. If a style throws an error, the next one is tried, ending with plain text.
 *
 * replyId() reads the chosen id from any reply type (buttons, list, native-flow, template),
 * so taps work whatever style the card was sent in.
 */
const fs = require("fs");
const path = require("path");

const MAX_BUTTONS = 10; // lists support up to 10 rows per section
const V2_MAX = 3;       // ButtonV2: WhatsApp shows at most 3 buttons per message
const STYLES = ["native", "toxic", "v2", "list", "text"];
const FOOTER = "> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐁𝐌𝐁-𝐓𝐄𝐂𝐇";

/**
 * The Toxic-MD text frame:
 *   ╭─❏ 「 TITLE」
 *   │ line
 *   ╰───────────────
 * `lines` is a string (may contain \n) or an array of lines.
 */
function card(title, lines) {
  const list = Array.isArray(lines) ? lines : String(lines == null ? "" : lines).split("\n");
  const body = list.map((l) => `│ ${l}`.trimEnd()).join("\n");
  return `╭─❏ 「 ${title}」\n${body}\n╰───────────────`;
}

// ---------------------------------------------------------------------------
// Bold font (Toxic-MD style labels)
// ---------------------------------------------------------------------------
function boldFont(text) {
  return String(text).replace(/[A-Za-z0-9]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + (c - 65));
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + (c - 97));
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + (c - 48));
    return ch;
  });
}

// ---------------------------------------------------------------------------
// Reading the chosen option
// ---------------------------------------------------------------------------
function unwrap(message) {
  let m = message || {};
  for (let i = 0; i < 4; i++) {
    const inner = (m.ephemeralMessage && m.ephemeralMessage.message) ||
      (m.viewOnceMessage && m.viewOnceMessage.message) ||
      (m.deviceSentMessage && m.deviceSentMessage.message);
    if (!inner) break;
    m = inner;
  }
  return m;
}

function replyId(message) {
  const m = unwrap(message);
  // list reply (the one we use)
  if (m.listResponseMessage && m.listResponseMessage.singleSelectReply)
    return m.listResponseMessage.singleSelectReply.selectedRowId || "";
  // legacy buttons
  if (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedButtonId)
    return m.buttonsResponseMessage.selectedButtonId;
  if (m.templateButtonReplyMessage && m.templateButtonReplyMessage.selectedId)
    return m.templateButtonReplyMessage.selectedId;
  // native-flow (pair.js style)
  const flow = m.interactiveResponseMessage &&
    m.interactiveResponseMessage.nativeFlowResponseMessage;
  if (flow && flow.paramsJson) {
    try {
      const p = typeof flow.paramsJson === "string"
        ? JSON.parse(flow.paramsJson) : flow.paramsJson;
      if (p && p.id) return String(p.id);
    } catch (e) {}
  }
  return "";
}

// ---------------------------------------------------------------------------
// Current style (stored setting or env var, defaults to "list")
// ---------------------------------------------------------------------------
function currentStyle() {
  let value = process.env.BUTTON_STYLE;
  try {
    const stored = require("./settingsCache").getSetting("BUTTON_STYLE", "");
    if (stored) value = stored;
  } catch (e) {}
  value = String(value || "toxic").toLowerCase().trim();
  if (["wrapped", "legacy"].includes(value)) return "native";
  return STYLES.includes(value) ? value : "toxic";
}

// iPhone cannot show these buttons, so there the options are sent as text (set DEVICE=ios).
function isIosDevice() {
  let value = process.env.DEVICE;
  try {
    const stored = require("./settingsCache").getSetting("DEVICE", "");
    if (stored) value = stored;
  } catch (e) {}
  return String(value || "").toLowerCase().trim() === "ios";
}

function plainTextVersion(body, footer, btns) {
  return `${body}\n\nType one of these:\n${btns.map(b => "• " + b.id).join("\n")}${footer ? "\n\n" + footer : ""}`;
}

// ---------------------------------------------------------------------------
// Thumbnail (kept for API compatibility; not needed for list messages)
// ---------------------------------------------------------------------------
async function makeThumbnail(source) {
  if (!source) return null;
  try {
    if (Buffer.isBuffer(source)) return source;
    if (/^https?:\/\//i.test(String(source))) {
      const res = await fetch(source, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return fs.readFileSync(source);
  } catch (e) { return null; }
}

const _picCache = new Map(); // url -> { buf, at }

async function pictureFromUrl(url) {
  const hit = _picCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.buf;
  const buf = await makeThumbnail(url);
  if (buf) _picCache.set(url, { buf, at: Date.now() });
  return buf;
}

// The main picture: a random link from settings.js (URL / BOT_MENU_LINKS, comma separated).
async function settingsPicture() {
  let conf = {};
  try { conf = require("../settings"); } catch (e) {}
  const links = String(conf.URL || "").split(",").map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x) && !/\.(mp4|webm|gif|mov|mkv)(\?|$)/i.test(x));
  while (links.length) {
    const i = Math.floor(Math.random() * links.length);
    try {
      const buf = await pictureFromUrl(links.splice(i, 1)[0]);
      if (buf) return buf;
    } catch (e) {}
  }
  return null;
}

async function defaultThumbnail(mybotpic) {
  try { const buf = await settingsPicture(); if (buf) return buf; } catch (e) {}
  try {
    const url = typeof mybotpic === "function" ? mybotpic() : "";
    if (url) { const buf = await pictureFromUrl(url); if (buf) return buf; }
  } catch (e) {}
  try {
    const dir = path.join(__dirname, "..", "plugins", "scs");
    const files = fs.readdirSync(dir).filter(f => /^menu\d+\.(jpg|jpeg|png)$/i.test(f));
    if (files.length) {
      const buf = await makeThumbnail(path.join(dir, files[Math.floor(Math.random() * files.length)]));
      if (buf) return buf;
    }
  } catch (e) {}
  return null;
}

// ---------------------------------------------------------------------------
// toxic / v2 style — Toxic-MD ButtonV2: buttonsMessage (+ optional extra <biz> node)
// ---------------------------------------------------------------------------
async function sendV2Style(client, jid, { body, footer, buttons, mentions, thumbnail, mybotpic }, { extraNode = false } = {}) {
  const { ButtonV2 } = require("./buttonBuilder");
  const picture = thumbnail || (await defaultThumbnail(mybotpic));
  const b = new ButtonV2(client).setBody(body).setFooter(footer || FOOTER);
  if (picture) b.setThumbnail(picture);
  buttons.forEach((x) => b.addButton(boldFont(x.text), x.id));
  await b.send(jid, {
    userJid: (client.user && client.user.id) || "",
    extraNode,
    ...(mentions && mentions.length ? { mentions } : {}),
    beforeRelay: (msg) => { if (typeof client.rememberSentId === "function") client.rememberSentId(msg.key.id); },
  });
}

// ---------------------------------------------------------------------------
// List style — the only interactive widget that reliably works
// ---------------------------------------------------------------------------
async function sendListStyle(client, jid, { body, footer, title, buttons, mentions }) {
  await client.sendMessage(jid, {
    text: body,
    footer: footer || FOOTER,
    title: title || "",
    buttonText: "Choose an option ▾",
    sections: [{
      title: title || "Options",
      rows: buttons.map(b => ({
        rowId: b.id,
        title: b.text,
        description: b.id,
      })),
    }],
    ...(mentions && mentions.length ? { mentions } : {}),
  });
}

// ---------------------------------------------------------------------------
// Native style — interactiveMessage + nativeFlow quick_reply buttons, sent the way .pair sends its
// button (known to render on this bot). The picture is a real image header of the message.
// ---------------------------------------------------------------------------
async function sendNativeStyle(client, jid, { body, footer, buttons, mentions, thumbnail, mybotpic }) {
  const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require("@whiskeysockets/baileys");
  const I = proto.Message.InteractiveMessage;

  let header = I.Header.create({ title: "", subtitle: "", hasMediaAttachment: false });
  try {
    const picture = thumbnail || (await defaultThumbnail(mybotpic));
    if (picture && typeof prepareWAMessageMedia === "function") {
      const media = await prepareWAMessageMedia({ image: picture }, { upload: client.waUploadToServer });
      if (media && media.imageMessage) {
        header = I.Header.create({ title: "", subtitle: "", hasMediaAttachment: true, imageMessage: media.imageMessage });
      }
    }
  } catch (e) {
    console.log("[buttons] picture header skipped:", e && e.message ? e.message : e);
  }

  const interactive = I.create({
    body: I.Body.create({ text: body }),
    footer: I.Footer.create({ text: footer || FOOTER }),
    header,
    ...(mentions && mentions.length ? { contextInfo: { mentionedJid: mentions } } : {}),
    nativeFlowMessage: I.NativeFlowMessage.create({
      messageVersion: 1,
      buttons: buttons.map(b => ({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: boldFont(b.text), id: b.id }),
      })),
    }),
  });
  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: interactive,
      },
    },
  };
  const msg = generateWAMessageFromContent(jid, content, { userJid: (client.user && client.user.id) || "" });
  if (typeof client.rememberSentId === "function") client.rememberSentId(msg.key.id);
  await client.relayMessage(jid, msg.message, { messageId: msg.key.id });
}

// ---------------------------------------------------------------------------
// Main send function
// ---------------------------------------------------------------------------
async function sendButtons(client, jid, {
  body, footer = "", buttons, title = "", subtitle = "",
  mentions = [], thumbnail = null, style, mybotpic
} = {}) {
  const list = (buttons || []).slice(0, MAX_BUTTONS);

  const asText = async () => {
    await client.sendMessage(jid, {
      text: plainTextVersion(body, footer, list), mentions,
    });
    return "text";
  };

  if (!list.length || String(process.env.BUTTONS || "").toLowerCase() === "off")
    return asText();
  if (isIosDevice()) return asText();
  // The person who just wrote in this chat uses an iPhone: iPhones do not show these buttons,
  // so the options are sent as text and the answer is not lost.
  try { if (client._chatDevice && client._chatDevice.get(jid) === "ios") return asText(); } catch (e) {}

  let wanted = STYLES.includes(style) ? style : currentStyle();
  if (wanted === "text") return asText();

  const args = { body, footer, title, subtitle, buttons: list, thumbnail, mentions, mybotpic };

  if (wanted === "toxic" || wanted === "v2") {
    if (list.length > V2_MAX) wanted = "native";
    else {
      try { await sendV2Style(client, jid, args, { extraNode: wanted === "v2" }); return wanted; }
      catch (e) { console.log(`[buttons] ${wanted} failed:`, e && e.message ? e.message : e); }
      wanted = "native";
    }
  }

  if (wanted === "native") {
    try { await sendNativeStyle(client, jid, args); return "native"; }
    catch (e) { console.log("[buttons] native failed:", e && e.message ? e.message : e); }
    try { await sendListStyle(client, jid, args); return "list"; }
    catch (e) { console.log("[buttons] list failed:", e && e.message ? e.message : e); }
    return asText();
  }

  // list
  try { await sendListStyle(client, jid, args); return "list"; }
  catch (e) {
    console.log("[buttons] list failed:", e && e.message ? e.message : e);
    try { await sendNativeStyle(client, jid, args); return "native"; }
    catch (e2) { return asText(); }
  }
}

module.exports = {
  sendButtons, replyId, boldFont, card, FOOTER,
  makeThumbnail, defaultThumbnail,
  currentStyle, STYLES, MAX_BUTTONS,
};
