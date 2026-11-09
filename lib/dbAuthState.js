"use strict";
/**
 * lib/dbAuthState.js
 *
 * Keeps the WhatsApp session (login + all encryption keys) in the PostgreSQL database instead of the
 * ./public folder.
 *
 * Why: hosts like Heroku/Render wipe the disk every time they restart the bot. The login came back
 * from SESSION_ID, but the encryption keys (sessions with every contact, pre-keys) were lost, so
 * WhatsApp kept sending messages the bot could not open. The sender then has to send them again,
 * which can take many minutes - that is the "bot is connected but answers very late" problem.
 *
 * Works like Baileys' own useMultiFileAuthState, only the storage is the database.
 * Returns null when no PostgreSQL is in use, then index.js keeps using the ./public folder as before.
 *
 * SESSION_ID rules:
 *   - database empty                 -> the session from SESSION_ID is stored
 *   - SESSION_ID unchanged           -> the stored session is kept (it is newer than SESSION_ID)
 *   - SESSION_ID changed (new login) -> the old session is removed and the new one stored
 */
const crypto = require("crypto");
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");

const CREDS_KEY = "creds";
const HASH_KEY = "__session_hash";

const hashOf = (text) => crypto.createHash("sha256").update(String(text || "")).digest("hex");

// one retry, then log - a database hiccup must not crash the bot
async function safely(label, fn) {
  try {
    return await fn();
  } catch (e) {
    try {
      return await fn();
    } catch (e2) {
      console.log(`⚠️ [AUTH] could not ${label}:`, e2 && e2.message ? e2.message : e2);
      return undefined;
    }
  }
}

async function useDbAuthState({ db, sessionB64 } = {}) {
  if (!db || typeof db.getBackend !== "function") return null;
  await db.ensureReady();
  if (db.getBackend() !== "pg") return null;

  const wanted = sessionB64 && sessionB64 !== "zokk" ? String(sessionB64) : "";
  const wantedHash = hashOf(wanted);
  const storedHash = await db.authGet(HASH_KEY);
  const storedCreds = await db.authGet(CREDS_KEY);

  let creds = null;

  if (wanted && (!storedCreds || storedHash !== wantedHash)) {
    // first start, or a new SESSION_ID was pasted: import it
    try {
      creds = JSON.parse(Buffer.from(wanted, "base64").toString("utf8"), BufferJSON.reviver);
    } catch (e) {
      console.log("⚠️ [AUTH] SESSION_ID is not valid, ignoring it:", e.message);
    }
    if (creds) {
      await db.authClear();
      await db.authSet(CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer));
      await db.authSet(HASH_KEY, wantedHash);
      console.log("✅ [AUTH] SESSION_ID stored in the database.");
    }
  }

  if (!creds && storedCreds) {
    creds = JSON.parse(storedCreds, BufferJSON.reviver);
    console.log("✅ [AUTH] Using the session kept in the database.");
  }

  if (!creds) {
    // no SESSION_ID and nothing stored: a fresh login (QR / pairing code)
    creds = initAuthCreds();
    await db.authSet(HASH_KEY, wantedHash);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              const raw = await safely(`read ${type}-${id}`, () => db.authGet(`${type}-${id}`));
              let value = raw ? JSON.parse(raw, BufferJSON.reviver) : null;
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(
                value
                  ? safely(`save ${key}`, () => db.authSet(key, JSON.stringify(value, BufferJSON.replacer)))
                  : safely(`remove ${key}`, () => db.authDel(key))
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await safely("save the login", () => db.authSet(CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer)));
    },
  };
}

module.exports = { useDbAuthState };
