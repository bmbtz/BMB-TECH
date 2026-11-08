const { bmbtz } = require("../../devbmb/bmbtz");
const { getGroupFeature, setGroupFeature } = require("../../lib/groupProtection");
const db = require("../../database/db");

// If lib/buttons.js was not uploaded, the command must still answer (with plain text instead of buttons).
let buttons;
try {
  buttons = require("../../lib/buttons");
} catch (e) {
  console.log("⚠️ [antistatusmention] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.");
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
 * antistatusmention
 *
 * Ported from BMB-TECH's updated antistatusmention settings command
 * (4 modes: off/delete/warn/kick), adapted to BMB-TECH's bmbtz()
 * command style and lib/groupProtection.js storage instead of
 * database/config.js's getGroupSettings/updateGroupSetting.
 *
 * The actual enforcement (detecting a status-mention message and
 * acting on it) lives in index.js — see the block guarded by
 * `mtype === 'groupStatusMentionMessage'`.
 */
function fmt(msg) {
    return `🛡️ *ANTISTATUSMENTION*\n━━━━━━━━━━━━━━━━\n${msg}\n━━━━━━━━━━━━━━━━\n© bmb tech`;
}

bmbtz({
    nomCom: "antistatusmention",
    alias: ["antimention"],
    categorie: "Group",
    reaction: "🛡️"
}, async (dest, client, commandeOptions) => {
    const { ms, repondre, arg, verifGroupe, verifAdmin, superUser } = commandeOptions;

    await client.sendMessage(dest, { react: { text: "⌛", key: ms.key } }).catch(() => {});

    if (!verifGroupe) {
        await client.sendMessage(dest, { react: { text: "❌", key: ms.key } }).catch(() => {});
        return repondre(fmt("Groups only, genius. 😤"));
    }

    if (!(verifAdmin || superUser)) {
        await client.sendMessage(dest, { react: { text: "❌", key: ms.key } }).catch(() => {});
        return repondre(fmt("Admins only. You're not special enough. 😒"));
    }

    try {
        const value = (arg || []).join(" ").toLowerCase();
        const validModes = ["off", "warn", "kick", "delete"];

        // Buttons (Toxic-MD style). [✅ ON] asks which action to use, one tap more:
        //   .antistatusmention        -> status + [✅ ON] [❌ OFF]
        //   .antistatusmention on     -> choose:  [🗑️ DELETE] [⚠️ WARN] [🚫 KICK]
        const p = commandeOptions.prefixe || ".";
        if (value === "on") {
            await client.sendMessage(dest, { react: { text: "✅", key: ms.key } }).catch(() => {});
            return buttons.sendButtons(client, dest, {
                body: card("ANTISTATUSMENTION MODE",
                    `What should happen when someone mentions the group in a status?\n\nDELETE - only delete it\nWARN   - delete + warn (kick at the warn limit)\nKICK   - delete + kick at once\n\nOptions:\n${p}antistatusmention delete\n${p}antistatusmention warn\n${p}antistatusmention kick`),
                title: "ANTISTATUSMENTION",
                buttons: [
                    { text: "🗑️ DELETE", id: `${p}antistatusmention delete` },
                    { text: "⚠️ WARN", id: `${p}antistatusmention warn` },
                    { text: "🚫 KICK", id: `${p}antistatusmention kick` },
                ],
            });
        }

        if (validModes.includes(value)) {
            const currentMode = (await getGroupFeature(dest, "antistatusmention")).toLowerCase();
            if (currentMode === value) {
                await client.sendMessage(dest, { react: { text: "❌", key: ms.key } }).catch(() => {});
                return repondre(fmt(`AntiStatusMention is already *${value.toUpperCase()}*. Pay attention. 😒`));
            }

            await setGroupFeature(dest, "antistatusmention", value);

            const desc =
                value === "off" ? "Status mentions are now allowed. Hope that's intentional. 🙄" :
                value === "warn" ? "Status mentions deleted + user warned.\nHit the warn limit and they're KICKED. 😈" :
                value === "delete" ? "Status mentions get deleted, no warn, no kick.\nJust silently wiped. 🗑️" :
                "Status mention = Instant kick. Zero tolerance. 😈";

            await client.sendMessage(dest, { react: { text: "✅", key: ms.key } }).catch(() => {});
            return repondre(fmt(`✅ AntiStatusMention set to *${value.toUpperCase()}*.\n│ ${desc}`));
        }

        const currentMode = (await getGroupFeature(dest, "antistatusmention")).toUpperCase();
        const warnLimit = await db.getWarnLimit(dest);

        await client.sendMessage(dest, { react: { text: "✅", key: ms.key } }).catch(() => {});
        return buttons.sendButtons(client, dest, {
            body: card("ANTISTATUSMENTION",
                `Current mode: ${currentMode}\nWarn limit: ${warnLimit} (set with ${p}setwarnlimit)\n\nOptions:\n${p}antistatusmention on\n${p}antistatusmention off\n\nDirect: ${p}antistatusmention delete / warn / kick`),
            title: "ANTISTATUSMENTION",
            buttons: [
                { text: "✅ ON", id: `${p}antistatusmention on` },
                { text: "❌ OFF", id: `${p}antistatusmention off` },
            ],
        });
    } catch (error) {
        await client.sendMessage(dest, { react: { text: "❌", key: ms.key } }).catch(() => {});
        console.error("[antistatusmention] command error:", error);
        await repondre(fmt("Something broke. Try again. 😤"));
    }
});
