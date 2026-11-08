"use strict";
/**
 * lib/buttonBuilder.js
 *
 * CommonJS port of Toxic-MD's ButtonV2 (lib/WABuilder.js).
 * Sends the separate rounded quick-reply buttons you see under the Toxic-MD menu:
 *   - a buttonsMessage with an (optional) image header
 *   - the extra <biz> / native_flow node that makes WhatsApp draw the buttons
 *
 * Usage:
 *   const { ButtonV2 } = require("./buttonBuilder");
 *   const b = new ButtonV2(client);
 *   b.setBody("...").setFooter("...").setThumbnail(buffer).addButton("✅ ON", ".anticall on");
 *   await b.send(jid, { mentions: [sender], userJid: client.user.id });
 */
const crypto = require("crypto");
const { generateWAMessageFromContent } = require("@whiskeysockets/baileys");

let sharp = null;
try { sharp = require("sharp"); } catch (e) { /* thumbnail is sent as-is without sharp */ }

async function toThumbnail(source) {
  if (!source) return null;
  let buf = null;
  if (Buffer.isBuffer(source)) {
    buf = source;
  } else if (/^https?:\/\//i.test(String(source))) {
    const res = await fetch(source, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    buf = require("fs").readFileSync(source);
  }
  if (!buf || !buf.length) return null;
  if (!sharp) return buf;
  try {
    return await sharp(buf).resize(300, 300, { fit: "cover" }).jpeg().toBuffer();
  } catch (e) {
    return buf;
  }
}

class ButtonV2 {
  constructor(client) {
    if (!client) throw new Error("Socket is required");
    this._client = client;
    this._title = "";
    this._subtitle = "";
    this._body = "";
    this._footer = "";
    this._contextInfo = {};
    this._buttons = [];
    this._image = null;
  }

  setTitle(title) { this._title = String(title || ""); return this; }
  setSubtitle(subtitle) { this._subtitle = String(subtitle || ""); return this; }
  setBody(body) { this._body = String(body || ""); return this; }
  setFooter(footer) { this._footer = String(footer || ""); return this; }
  setContextInfo(obj) { this._contextInfo = { ...this._contextInfo, ...(obj || {}) }; return this; }

  /** image (Buffer, file path or URL) shown above the message, like the Toxic-MD menu */
  setThumbnail(source) { this._image = source || null; return this; }

  /**
   * @param {string} displayText - label shown on the button
   * @param {string} buttonId    - text sent back when tapped (the command)
   */
  addButton(displayText = "", buttonId = crypto.randomUUID()) {
    this._buttons.push({ buttonId, buttonText: { displayText }, type: 1 });
    return this;
  }

  async build(jid, { mentions, userJid, ...options } = {}) {
    let thumb = null;
    try { thumb = await toThumbnail(this._image); } catch (e) { thumb = null; }

    const contextInfo = { ...this._contextInfo };
    if (mentions && mentions.length) contextInfo.mentionedJid = mentions;

    // Toxic-MD header = location bubble carrying the picture. Without a picture the bubble would be
    // an empty map, so then we use a plain text header instead.
    const header = thumb
      ? {
          headerType: 6,
          locationMessage: {
            degreesLatitude: 0,
            degreesLongitude: 0,
            name: this._title,
            address: this._subtitle,
            jpegThumbnail: thumb,
          },
        }
      : { headerType: 1 };

    return generateWAMessageFromContent(
      jid,
      {
        buttonsMessage: {
          contentText: this._body,
          footerText: this._footer,
          ...header,
          viewOnce: true,
          contextInfo,
          buttons: [...this._buttons],
        },
      },
      { userJid: userJid || (this._client.user && this._client.user.id) || "", ...options }
    );
  }

  /**
   * @param {object} options  mentions, userJid, and beforeRelay(msg) - called with the built message
   *                          right before it is sent (used to remember the message id).
   */
  async send(jid, { beforeRelay, ...options } = {}) {
    if (this._buttons.length < 1) throw new Error("ButtonV2 requires at least one button");
    const { extraNode = true, ...buildOptions } = options;
    const msg = await this.build(jid, buildOptions);
    if (typeof beforeRelay === "function") beforeRelay(msg);

    // extraNode=false: some Baileys forks add the <biz> node themselves for a buttonsMessage;
    // sending a second one makes WhatsApp drop the message silently.
    await this._client.relayMessage(msg.key.remoteJid, msg.message, {
      messageId: msg.key.id,
      ...(extraNode ? { additionalNodes: [
        {
          tag: "biz",
          attrs: {},
          content: [
            {
              tag: "interactive",
              attrs: { type: "native_flow", v: "1" },
              content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
            },
          ],
        },
      ] } : {}),
    });
    return msg;
  }
}

module.exports = { ButtonV2 };
