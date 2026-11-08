const { bmbtz } = require("../../devbmb/bmbtz");
const moment = require("moment-timezone");

// If lib/buttons.js was not uploaded, the command must still answer (with plain text instead of buttons).
let buttons;
try {
  buttons = require("../../lib/buttons");
} catch (e) {
  console.log("⚠️ [ping] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.");
  buttons = {
    sendButtons: async (client, jid, { body, buttons: list = [] }) =>
      client.sendMessage(jid, { text: `${body}\n\nType one of these:\n${list.map((b) => "• " + b.id).join("\n")}` }),
  };
}

// Toxic-MD text frame (defined here too, so this command works even with an old lib/buttons.js).
const card = (typeof buttons.card === "function") ? buttons.card : (title, lines) => {
  const list = Array.isArray(lines) ? lines : String(lines == null ? "" : lines).split("\n");
  return `╭─❏ 「 ${title}」\n${list.map((l) => `│ ${l}`.trimEnd()).join("\n")}\n╰───────────────`;
};

/**
 * ping - speed and status, with two buttons (Toxic-MD style):
 *   [📜 MENU]  -> runs the menu command
 *   [👑 OWNER] -> runs the owner command
 */
bmbtz({
  nomCom: "ping",
  alias: ["speed", "p", "pong"],
  desc: "Check bot speed and status.",
  categorie: "General",
  reaction: "💫"
}, async (dest, client, commandeOptions) => {
  const { ms, prefixe, mybotpic } = commandeOptions;
  const p = prefixe || ".";

  try {
    const start = Date.now();
    await client.sendMessage(dest, { text: "💥 Pinging..." }, { quoted: ms });
    const ping = Date.now() - start;

    const time = moment().format("HH:mm:ss");
    const date = moment().format("DD/MM/YYYY");
    const uptime = process.uptime();
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

    await buttons.sendButtons(client, dest, {
      body: card("BMB-TECH PING",
        `Response: ${ping}ms\nDate: ${date}\nTime: ${time}\nUptime: ${uptimeStr}`),
      title: "BMB-TECH PING",
      mybotpic,
      buttons: [
        { text: "📜 MENU", id: `${p}menu` },
        { text: "👑 OWNER", id: `${p}owner` },
      ],
    });
  } catch (e) {
    console.log("❌ Ping Command Error:", e);
    await client.sendMessage(dest, { text: `❌ Error: ${e}` }, { quoted: ms }).catch(() => {});
  }
});
