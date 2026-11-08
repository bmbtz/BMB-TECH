const { bmbtz } = require('../../devbmb/bmbtz');
const { attribuerUnevaleur, recupevents } = require('../../lib/welcome');

// If lib/buttons.js was not uploaded, the command must still answer (with plain text instead of buttons).
let buttons;
try {
    buttons = require('../../lib/buttons');
} catch (e) {
    console.log('⚠️ [welcome] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.');
    buttons = {
        boldFont: (t) => String(t),
        card: (t, m) => `${t}\n${m}`,
        sendButtons: async (client, jid, { body, buttons: list = [] }) =>
            client.sendMessage(jid, { text: `${body}\n\nType one of these:\n${list.map((b) => '• ' + b.id).join('\n')}` }),
    };
}

// Toxic-MD text frame. Defined here too, so this command never breaks even if lib/buttons.js is an old copy.
const card = (typeof buttons.card === "function") ? buttons.card : (title, lines) => {
  const list = Array.isArray(lines) ? lines : String(lines == null ? "" : lines).split("\n");
  return `╭─❏ 「 ${title}」\n${list.map((l) => `│ ${l}`.trimEnd()).join("\n")}\n╰───────────────`;
};
if (typeof buttons.card !== "function") console.log("⚠️ lib/buttons.js is the OLD version - replace it with the new one to get the Toxic-style buttons.");

/**
 * Group features that are switched on and off:
 *   welcome, goodbye, antipromote, antidemote
 *
 * "welcome" works with buttons (the same style as .antilink):
 *   .welcome          -> shows the status and the buttons  [Welcome On] [Welcome Off]
 *   [Welcome On]      -> (.welcome on)   welcome messages ON
 *   [Welcome Off]     -> (.welcome off)  welcome messages OFF
 * The text commands still work:  .welcome on   .welcome off
 * The message itself can be changed with .setwelcome <text>
 *
 * Tapping a button runs the command on the button as the person who tapped it,
 * so only group admins and super users can change anything.
 */
const digits = (v) => String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const isAdminMember = (p) => p && (p.admin === 'admin' || p.admin === 'superadmin' || p.admin === true);
const idsOf = (p) =>
    [p && p.id, p && p.lid, p && p.jid, p && p.phoneNumber, p && p.phone_number].filter(Boolean).map(digits).filter(Boolean);

// Features that get the button card. The others keep the plain text help.
const WITH_BUTTONS = new Set(['welcome']);

const FRAME_TOP = (t) => `╭───❰ *${t}* ❱───╮`;
const FRAME_BOTTOM = '╰──────────────────────────╯';

async function events(nomCom) {
bmbtz({
    nomCom: nomCom,
    categorie: 'Group'
}, async (dest, client, commandeOptions) => {

    const { arg, repondre, superUser, verifAdmin, verifGroupe, prefixe, mbre, auteurMessage, senderJid } = commandeOptions;
    const p = prefixe || '.';

    if (!verifGroupe) {
        return repondre('🚫 *This command works in groups only.*');
    }

    // Admins are recognised even when WhatsApp shows them as an @lid id.
    const senderIds = [auteurMessage, senderJid].filter(Boolean).map(digits);
    const senderIsAdmin = verifAdmin ||
        (Array.isArray(mbre) && mbre.some((m) => isAdminMember(m) && idsOf(m).some((i) => senderIds.includes(i))));

    if (!(senderIsAdmin || superUser)) {
        return repondre(
`╭───〔 ACCESS DENIED 〕───\n│\n│ Admin only command\n│\n╰──────────────`
        );
    }

    const choice = (arg && arg[0] || '').toLowerCase();

    // on / off
    if (choice === 'on' || choice === 'off') {

        await attribuerUnevaleur(dest, nomCom, choice);

        let extra = '';
        if (nomCom === 'welcome' && choice === 'on') {
            extra = `│\n│ Change the message with:\n│ ${p}setwelcome <text>\n`;
        }
        return repondre(
`╭───〔 SUCCESS 〕───\n│\n│ Feature : ${nomCom}\n│ Status  : ${choice.toUpperCase()}\n${extra}│\n╰──────────────`
        );
    }

    // No argument
    if (!choice) {

        // welcome: status + buttons
        if (WITH_BUTTONS.has(nomCom)) {
            const status = await recupevents(dest, nomCom);
            const custom = await recupevents(dest, 'welcometext');
            const isOn = status === 'on';
            const hasCustom = custom !== undefined && custom !== 'non';

            return buttons.sendButtons(client, dest, {
                body: card(nomCom.toUpperCase(), `Status: ${isOn ? 'ON ✅' : 'OFF ❌'}\nMessage: ${hasCustom ? 'Custom' : 'Default'}\n\nOptions:\n${p}${nomCom} on\n${p}${nomCom} off\n\nChange the message:\n${p}set${nomCom} <text>`),
                title: nomCom.toUpperCase(),
                buttons: [
                    { text: "✅ ON", id: `${p}${nomCom} on` },
                    { text: "❌ OFF", id: `${p}${nomCom} off` },
                ],
            });
        }

        // other features: text help
        return repondre(
`╭───〔 ${nomCom.toUpperCase()} 〕───\n│\n│ ▶ ${nomCom} on\n│    Activate feature\n│\n│ ▶ ${nomCom} off\n│    Deactivate feature\n│\n╰──────────────`
        );
    }

    // Bad argument
    return repondre(
`╭───〔 ERROR 〕───\n│\n│ Invalid option\n│ Use only:\n│ • on\n│ • off\n│\n╰──────────────`
    );
});
}

// Group features
events('welcome');
events('goodbye');
events('antipromote');
events('antidemote');
