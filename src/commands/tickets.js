// Support tickets: a panel with a button; each click opens a private thread
// with the member and the moderators. One open ticket per member.

import { has, PERM, rest } from "../discord.js";
import { modLogChannel, modRole, say, userOf } from "../util.js";

const OPEN = "ticket:open";
const CLOSE = "ticket:close:";  // + the member's id
const ORANGE = 0xf7931a;
const WEEK_MINUTES = 10080;

export const definitions = [{
  name: "ticket-panel", description: "Post the support ticket button in this channel",
  description_localizations: { fr: "Poster le bouton des tickets de support dans ce salon" },
  default_member_permissions: String(PERM.MANAGE_GUILD),
}];

export function handles(name) {
  return name === "ticket-panel";
}

export function handlesComponent(id) {
  return id === OPEN || id.startsWith(CLOSE);
}

export function handle(interaction, env) {
  if (!interaction.guild_id) return { content: "Server only.", ephemeral: true };
  if (!has(interaction, PERM.MANAGE_GUILD))
    return { content: say(interaction, "⛔ Tu n'as pas la permission.", "⛔ You don't have the permission."), ephemeral: true };
  return { defer: true, ephemeral: true, run: () => postPanel(interaction, env) };
}

async function postPanel(i, env) {
  await rest(env, "POST", `/channels/${i.channel_id ?? i.channel?.id}/messages`, {
    embeds: [{
      color: ORANGE, title: "🎫 Support privé · Private support",
      description: [
        "Un souci avec ton miner que tu préfères ne pas exposer en public (adresse, réseau, journal) ? Ouvre un ticket : un fil privé avec toi et l'équipe.",
        "Pour les questions générales, le forum 🆘-aide aide tout le monde.",
        "",
        "*A problem you'd rather not post publicly? Open a ticket: a private thread with you and the team.*",
      ].join("\n"),
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Ouvrir un ticket · Open a ticket", emoji: { name: "🎫" }, custom_id: OPEN }] }],
  });
  return say(i, "✅ Panneau publié.", "✅ Panel posted.");
}

export function handleComponent(interaction, env) {
  const id = interaction.data.custom_id;
  if (id === OPEN) return { defer: true, ephemeral: true, run: () => open(interaction, env) };
  return close(interaction, env, id.slice(CLOSE.length));
}

const KEY = (guild, user) => `ticket:${guild}:${user}`;

async function open(i, env) {
  const member = userOf(i);
  const key = KEY(i.guild_id, member.id);
  const existing = await env.BOT_KV.get(key);
  if (existing) {
    const thread = await rest(env, "GET", `/channels/${existing}`).catch(() => null);
    if (thread && !thread.thread_metadata?.archived)
      return say(i, `Tu as déjà un ticket ouvert : <#${existing}>`, `You already have an open ticket: <#${existing}>`);
  }

  const thread = await rest(env, "POST", `/channels/${i.channel_id ?? i.channel?.id}/threads`, {
    name: `ticket-${member.username}`.slice(0, 100), type: 12, invitable: false, auto_archive_duration: WEEK_MINUTES,
  }, `ticket ${member.username}`);
  await rest(env, "PUT", `/channels/${thread.id}/thread-members/${member.id}`);
  const role = await modRole(env, i.guild_id).catch(() => "");
  // Mentioning the role brings the moderators into the private thread.
  await rest(env, "POST", `/channels/${thread.id}/messages`, {
    content: `<@${member.id}>${role ? ` <@&${role}>` : ""}`,
    embeds: [{
      color: ORANGE,
      description: say(i,
        "Explique ton problème ici : ta carte, la version du firmware et ce que tu vois. Un journal d'activité aide beaucoup. Seuls toi et l'équipe voyez ce fil.",
        "Describe your problem here: your board, the firmware version and what you see. An activity log helps a lot. Only you and the team can see this thread."),
    }],
    components: [{ type: 1, components: [{ type: 2, style: 4, label: say(i, "Fermer le ticket", "Close the ticket"), emoji: { name: "🔒" }, custom_id: CLOSE + member.id }] }],
    allowed_mentions: { users: [member.id], roles: role ? [role] : [] },
  });
  await env.BOT_KV.put(key, thread.id);

  const log = await modLogChannel(env, i.guild_id).catch(() => "");
  if (log)
    await rest(env, "POST", `/channels/${log}/messages`, {
      embeds: [{ title: "🎫 Ticket ouvert", color: ORANGE, description: `<@${member.id}> (${member.username}) : <#${thread.id}>`, timestamp: new Date().toISOString() }],
      allowed_mentions: { parse: [] },
    }).catch(() => {});
  return say(i, `🎫 Ticket ouvert : <#${thread.id}>`, `🎫 Ticket opened: <#${thread.id}>`);
}

// The member or a moderator closes it: the thread is archived and locked, so
// it stays readable by the team.
function close(i, env, owner) {
  const who = userOf(i);
  if (who.id !== owner && !has(i, PERM.MANAGE_MESSAGES))
    return { content: say(i, "Seule la personne qui a ouvert le ticket ou l'équipe peut le fermer.", "Only the member who opened the ticket or the team can close it."), ephemeral: true };
  const thread = i.channel_id ?? i.channel?.id;
  return {
    content: say(i, `🔒 Ticket fermé par <@${who.id}>.`, `🔒 Ticket closed by <@${who.id}>.`),
    // After the reply: a locked thread would refuse it.
    after: async () => {
      await env.BOT_KV.delete(KEY(i.guild_id, owner));
      await rest(env, "PATCH", `/channels/${thread}`, { archived: true, locked: true }, `ticket closed by ${who.username}`);
    },
  };
}
