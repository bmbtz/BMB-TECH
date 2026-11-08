const { bmbtz } = require('../../devbmb/bmbtz');
const { getGroupFeature, setGroupFeature } = require('../../lib/groupProtection');

// If lib/buttons.js was not uploaded, the command must still answer (with plain text instead of buttons).
let buttons;
try {
  buttons = require("../../lib/buttons");
} catch (e) {
  console.log("⚠️ [antispam] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.");
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

const ON = new Set(['on', 'enable', 'enabled', 'warn', 'start']);
const OFF = new Set(['off', 'disable', 'disabled', 'stop']);
const KICK = new Set(['kick', 'remove', 'ban', 'hard', 'strict']);

bmbtz({
    nomCom: 'antispam',
    alias: ['nospam', 'antiflood'],
    categorie: 'Group',
    reaction: '🛡️'
}, async (dest, client, commandeOptions) => {
    const { arg, repondre, superUser, verifAdmin, verifGroupe, prefixe } = commandeOptions;

    if (!verifGroupe) {
        return repondre('🚫 *This command is for group use only.*');
    }
    if (!(verifAdmin || superUser)) {
        return repondre(
`╭───〔 ACCESS DENIED 〕───
│
│ Admin only command
│
╰──────────────`
        );
    }

    const val = (arg[0] || '').toLowerCase();
    const current = await getGroupFeature(dest, 'antispam');

    if (!val) {
        // Status + buttons (Toxic-MD style): [✅ ON] [🚫 KICK] [❌ OFF]
        return buttons.sendButtons(client, dest, {
            body: card('ANTISPAM',
                `Status: ${current.toUpperCase()}\nThreshold: 5 messages / 5 seconds\n\nON   - delete + warn spammers\nKICK - delete + kick spammers\nOFF  - disabled\n\nOptions:\n${prefixe}antispam on\n${prefixe}antispam kick\n${prefixe}antispam off`),
            title: 'ANTISPAM',
            buttons: [
                { text: '✅ ON', id: `${prefixe}antispam on` },
                { text: '🚫 KICK', id: `${prefixe}antispam kick` },
                { text: '❌ OFF', id: `${prefixe}antispam off` },
            ],
        });
    }

    let newVal;
    if (KICK.has(val)) newVal = 'kick';
    else if (ON.has(val)) newVal = 'warn';
    else if (OFF.has(val)) newVal = 'off';
    else {
        return repondre(`Invalid option: ${val}\nUse: on, off, or kick`);
    }

    await setGroupFeature(dest, 'antispam', newVal);
    const desc = newVal === 'off' ? 'disabled ❌' : newVal === 'kick' ? 'enabled in KICK mode 🦾' : 'enabled in WARN mode ⚠️';
    return repondre(
`╭───〔 ANTISPAM 〕───
│
│ Anti-Spam ${desc}
│ Spammers (5+ msgs in 5s) will be
│ ${newVal === 'off' ? 'ignored' : newVal === 'kick' ? 'deleted + kicked' : 'deleted + warned'}
│
╰──────────────`
    );
});
