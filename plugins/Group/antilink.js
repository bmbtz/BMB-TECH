const { bmbtz } = require("../../devbmb/bmbtz");
const {
  ajouterOuMettreAJourJid, verifierEtatJid,
  setRemoveMode, getRemoveMode,
  setWarnMode, getWarnMode,
} = require("../../lib/antilien");
const ownerAccess = require("../../lib/ownerAccess");

// If lib/buttons.js was not uploaded, the command must still answer (with plain text instead of buttons).
let buttons;
try {
  buttons = require("../../lib/buttons");
} catch (e) {
  console.log("⚠️ [antilink] lib/buttons.js is missing - upload it to get the buttons. Using plain text for now.");
  buttons = {
    boldFont: (t) => String(t),
    card: (t, m) => `${t}\n${m}`,
    sendButtons: async (client, jid, { body, buttons: list = [] }) =>
      client.sendMessage(jid, { text: `${body}\n\nType one of these:\n${list.map((b) => "• " + b.id).join("\n")}` }),
  };
}

// Toxic-MD text frame. Defined here too, so this command never breaks even if lib/buttons.js is an old copy.
const card = (typeof buttons.card === "function") ? buttons.card : (title, lines) => {
  const list = Array.isArray(lines) ? lines : String(lines == null ? "" : lines).split("\n");
  return `╭─❏ 「 ${title}」\n${list.map((l) => `│ ${l}`.trimEnd()).join("\n")}\n╰───────────────`;
};
if (typeof buttons.card !== "function") console.log("⚠️ lib/buttons.js is the OLD version - replace it with the new one to get the Toxic-style buttons.");

/**
 * antilink - with buttons (Toxic-MD style: separate rounded buttons under the message)
 *
 *   .antilink              -> status + buttons  [✅ ON] [❌ OFF]
 *   [✅ ON]                -> (.antilink on)     asks what to do:  [🗑️ DELETE] [🚫 REMOVE]
 *   [🗑️ DELETE]            -> (.antilink delete) turns antilink ON, links are only deleted
 *   [🚫 REMOVE]            -> (.antilink remove) turns antilink ON, links are deleted AND the sender is removed
 *   [❌ OFF]               -> (.antilink off)    turns antilink OFF
 *
 * The text commands of the earlier version still work:
 *   .antilink remove on|off      - turn the "also remove" part on or off by itself
 *   .antilink warn on|off        - warn (kicks at the group's warn limit) instead of removing at once
 *
 * Tapping a button runs the command on the button, as the person who tapped it,
 * so only group admins and super users can change anything.
 */
const d = (v) => ownerAccess.digits(v);
const isAdminMember = (p) => p && (p.admin === "admin" || p.admin === "superadmin" || p.admin === true);
const idsOf = (p) =>
  [p && p.id, p && p.lid, p && p.jid, p && p.phoneNumber, p && p.phone_number].filter(Boolean).map(d).filter(Boolean);

const FRAME_TOP = (t) => `╭───❰ *${t}* ❱───╮`;
const FRAME_BOTTOM = "╰──────────────────────────╯";

bmbtz({ nomCom: "antilink", alias: ["antilinks"], categorie: 'Group', reaction: "🔗" }, async (dest, client, commandeOptions) => {
  var { repondre, arg, verifGroupe, superUser, verifAdmin, prefixe, mbre, auteurMessage, senderJid } = commandeOptions;
  const p = prefixe || ".";

  if (!verifGroupe) return repondre("🚫 *This command works in groups only.*");

  // Admins are recognised even when WhatsApp shows them as an @lid id.
  const senderIds = [auteurMessage, senderJid].filter(Boolean).map(d);
  const senderIsAdmin = verifAdmin || (Array.isArray(mbre) && mbre.some((m) => isAdminMember(m) && idsOf(m).some((i) => senderIds.includes(i))));
  if (!(superUser || senderIsAdmin)) {
    return repondre("🚫 *Only group admins or super users can use this command.*");
  }

  const sendCard = (body, buttonList) =>
    buttons.sendButtons(client, dest, {
      body,
      title: "ANTILINK",
      buttons: buttonList,
    });

  try {
    const sub = (arg && arg[0] || '').toLowerCase();

    // .antilink remove on/off   (the old modifier)   |   .antilink remove   (button: delete + remove)
    if (sub === 'remove') {
      const val = (arg[1] || '').toLowerCase();
      if (val === 'on' || val === 'off') {
        await setRemoveMode(dest, val === 'on');
        return repondre(
`${FRAME_TOP("ANTILINK · REMOVE")}\n│ 🔧 Remove-on-catch: *${val.toUpperCase()}*\n${FRAME_BOTTOM}`
        );
      }
      await ajouterOuMettreAJourJid(dest, 'oui');
      await setRemoveMode(dest, true);
      await setWarnMode(dest, false);
      return repondre(
`${FRAME_TOP("ANTILINK")}\n│ ✅ Antilink is *ON*\n│ 🚫 Mode: *Remove*\n│\n│ A link is deleted and the\n│ sender is removed from the group.\n${FRAME_BOTTOM}`
      );
    }

    // .antilink delete   (button: delete only)
    if (sub === 'delete') {
      await ajouterOuMettreAJourJid(dest, 'oui');
      await setRemoveMode(dest, false);
      await setWarnMode(dest, false);
      return repondre(
`${FRAME_TOP("ANTILINK")}\n│ ✅ Antilink is *ON*\n│ 🗑️ Mode: *Delete*\n│\n│ A link is only deleted.\n│ The sender stays in the group.\n${FRAME_BOTTOM}`
      );
    }

    // .antilink warn on/off
    if (sub === 'warn') {
      const val = (arg[1] || '').toLowerCase();
      if (val !== 'on' && val !== 'off') {
        const current = await getWarnMode(dest);
        return repondre(
`${FRAME_TOP("ANTILINK · WARN")}\n│ Status: ${current ? 'ON ✅' : 'OFF ❌'}\n│\n│ ⚙️ antilink warn on\n│ ⚙️ antilink warn off\n│\n│ When ON, the sender is warned;\n│ hitting the group's warn limit\n│ (see .setwarnlimit) kicks them.\n${FRAME_BOTTOM}`
        );
      }
      await setWarnMode(dest, val === 'on');
      return repondre(
`${FRAME_TOP("ANTILINK · WARN")}\n│ 🔧 Warn-on-catch: *${val.toUpperCase()}*\n${FRAME_BOTTOM}`
      );
    }

    // .antilink off
    if (sub === 'off') {
      await ajouterOuMettreAJourJid(dest, 'non');
      return repondre(
`${FRAME_TOP("ANTILINK STATUS")}\n│ ❌ Antilink has been *deactivated*\n${FRAME_BOTTOM}`
      );
    }

    // .antilink on  -> ask what should happen to a link (buttons: Delete / Remove)
    if (sub === 'on') {
      return sendCard(
        card("ANTILINK MODE", `What should happen when a member sends a link?\n\nDELETE - the link is deleted\nREMOVE - the link is deleted and the member is removed\n\nOptions:\n${p}antilink delete\n${p}antilink remove`),
        [
          { text: "🗑️ DELETE", id: `${p}antilink delete` },
          { text: "🚫 REMOVE", id: `${p}antilink remove` },
        ]
      );
    }

    // .antilink  -> status + buttons On / Off
    const masterOn = await verifierEtatJid(dest);
    const removeOn = await getRemoveMode(dest);
    const warnOn = await getWarnMode(dest);
    const action = !masterOn ? '-' : removeOn ? 'Delete + Remove' : warnOn ? 'Delete + Warn' : 'Delete only';

    return sendCard(
      card("ANTILINK", `Status: ${masterOn ? 'ON ✅' : 'OFF ❌'}\nAction: ${action}\n\nOptions:\n${p}antilink on\n${p}antilink off\n\nExtra: ${p}antilink warn on/off`),
      [
        { text: "✅ ON", id: `${p}antilink on` },
        { text: "❌ OFF", id: `${p}antilink off` },
      ]
    );

  } catch (error) {
    repondre("❌ *Error:* " + (error.message || error));
  }
});
