// Moderation: warnings kept in KV, timeouts, kicks, bans, purges and slow
// mode. Every action is logged in the moderation channel and, for the member
// concerned, sent to them by direct message when Discord allows it.

import { has, option, PERM, rest } from "../discord.js";
import { modLogChannel, say, userOf } from "../util.js";

const MAX_WARNINGS = 50;
const DAY = 86400;

export const definitions = [
  {
    name: "warn", description: "Warn a member (kept in their history)",
    description_localizations: { fr: "Avertir un membre (gardé dans son historique)" },
    default_member_permissions: String(PERM.MODERATE),
    options: [user(), reason(true)],
  },
  {
    name: "warnings", description: "Show a member's warnings",
    description_localizations: { fr: "Voir les avertissements d'un membre" },
    default_member_permissions: String(PERM.MODERATE),
    options: [user()],
  },
  {
    name: "clearwarnings", description: "Erase a member's warnings",
    description_localizations: { fr: "Effacer les avertissements d'un membre" },
    default_member_permissions: String(PERM.MODERATE),
    options: [user()],
  },
  {
    name: "timeout", description: "Mute a member for a while",
    description_localizations: { fr: "Rendre un membre muet pour un temps" },
    default_member_permissions: String(PERM.MODERATE),
    options: [user(), {
      type: 4, name: "duration", description: "How long", required: true,
      name_localizations: { fr: "durée" }, description_localizations: { fr: "Combien de temps" },
      choices: [
        ["60 seconds", "60 secondes", 60], ["10 minutes", "10 minutes", 600], ["1 hour", "1 heure", 3600],
        ["1 day", "1 jour", DAY], ["1 week", "1 semaine", 7 * DAY], ["Lift the timeout", "Lever la sanction", 0],
      ].map(([en, fr, value]) => ({ name: en, name_localizations: { fr }, value })),
    }, reason(false)],
  },
  {
    name: "kick", description: "Remove a member from the server (they can come back)",
    description_localizations: { fr: "Expulser un membre (il peut revenir)" },
    default_member_permissions: String(PERM.KICK),
    options: [user(), reason(true)],
  },
  {
    name: "ban", description: "Ban a member",
    description_localizations: { fr: "Bannir un membre" },
    default_member_permissions: String(PERM.BAN),
    options: [user(), reason(true), {
      type: 4, name: "delete", description: "Also delete their recent messages",
      name_localizations: { fr: "supprimer" }, description_localizations: { fr: "Supprimer aussi ses messages récents" },
      choices: [
        ["Nothing", "Rien", 0], ["Last hour", "Dernière heure", 3600], ["Last day", "Dernier jour", DAY],
        ["Last 7 days", "7 derniers jours", 7 * DAY],
      ].map(([en, fr, value]) => ({ name: en, name_localizations: { fr }, value })),
    }],
  },
  {
    name: "unban", description: "Lift a ban",
    description_localizations: { fr: "Lever un bannissement" },
    default_member_permissions: String(PERM.BAN),
    options: [{
      type: 3, name: "user_id", description: "The banned user's id", required: true,
      name_localizations: { fr: "id" }, description_localizations: { fr: "L'identifiant de la personne bannie" },
    }, reason(false)],
  },
  {
    name: "purge", description: "Delete the last messages of this channel",
    description_localizations: { fr: "Supprimer les derniers messages de ce salon" },
    default_member_permissions: String(PERM.MANAGE_MESSAGES),
    options: [{
      type: 4, name: "count", description: "How many (1-100)", required: true, min_value: 1, max_value: 100,
      name_localizations: { fr: "nombre" }, description_localizations: { fr: "Combien (1-100)" },
    }, { ...user(), required: false, description: "Only this member's messages",
      description_localizations: { fr: "Seulement les messages de ce membre" } }],
  },
  {
    name: "slowmode", description: "Set this channel's slow mode",
    description_localizations: { fr: "Régler le mode lent de ce salon" },
    default_member_permissions: String(PERM.MANAGE_MESSAGES),
    options: [{
      type: 4, name: "seconds", description: "Seconds between two messages (0 = off)", required: true,
      min_value: 0, max_value: 21600,
      name_localizations: { fr: "secondes" }, description_localizations: { fr: "Secondes entre deux messages (0 = désactivé)" },
    }],
  },
];

function user() {
  return {
    type: 6, name: "member", description: "The member", required: true,
    name_localizations: { fr: "membre" }, description_localizations: { fr: "Le membre" },
  };
}

function reason(required) {
  return {
    type: 3, name: "reason", description: "Why (shown to the member and in the log)", required, max_length: 400,
    name_localizations: { fr: "raison" }, description_localizations: { fr: "Pourquoi (montré au membre et dans le journal)" },
  };
}

// The permission each command needs, checked again here: the defaults set at
// registration can be changed by the server's admins.
const NEEDS = {
  warn: PERM.MODERATE, warnings: PERM.MODERATE, clearwarnings: PERM.MODERATE, timeout: PERM.MODERATE,
  kick: PERM.KICK, ban: PERM.BAN, unban: PERM.BAN, purge: PERM.MANAGE_MESSAGES, slowmode: PERM.MANAGE_MESSAGES,
};

export function handles(name) {
  return name in NEEDS;
}

export function handle(interaction, env) {
  const name = interaction.data.name;
  if (!interaction.guild_id) return { content: "Server only.", ephemeral: true };
  if (!has(interaction, NEEDS[name]))
    return { content: say(interaction, "⛔ Tu n'as pas la permission.", "⛔ You don't have the permission."), ephemeral: true };

  const target = targetOf(interaction);
  if (target) {
    const refusal = refuse(interaction, env, target);
    if (refusal) return { content: refusal, ephemeral: true };
  }
  return { defer: true, ephemeral: true, run: () => ACTIONS[name](interaction, env, target) };
}

function targetOf(interaction) {
  const id = option(interaction, "member");
  if (!id) return null;
  const resolved = interaction.data.resolved ?? {};
  return { id, user: resolved.users?.[id], member: resolved.members?.[id] };
}

function refuse(interaction, env, target) {
  const me = userOf(interaction).id;
  if (target.id === me) return say(interaction, "Tu ne peux pas te viser toi-même.", "You can't target yourself.");
  if (target.id === env.DISCORD_APPLICATION_ID || target.user?.bot)
    return say(interaction, "Pas sur un bot.", "Not on a bot.");
  // A moderator acting on another moderator: only an administrator may.
  const theirs = BigInt(target.member?.permissions ?? "0");
  const staff = PERM.MODERATE | PERM.KICK | PERM.BAN;
  if ((theirs & PERM.ADMIN) !== 0n || ((theirs & staff) !== 0n && !has(interaction, PERM.ADMIN)))
    return say(interaction, "⛔ Ce membre fait partie de l'équipe.", "⛔ This member is staff.");
  return null;
}

function tag(user, id) {
  return user ? `<@${id}> (${user.username})` : `<@${id}>`;
}

// Embed in the moderation channel; a missing channel only loses the log.
async function log(interaction, env, title, fields, color) {
  const channel = await modLogChannel(env, interaction.guild_id).catch(() => "");
  if (!channel) return;
  const by = userOf(interaction);
  await rest(env, "POST", `/channels/${channel}/messages`, {
    embeds: [{
      title, color, timestamp: new Date().toISOString(),
      fields: [...fields, { name: "Par", value: `<@${by.id}> (${by.username})`, inline: true },
        { name: "Salon", value: `<#${interaction.channel_id ?? interaction.channel?.id}>`, inline: true }],
    }],
    allowed_mentions: { parse: [] },
  }).catch(() => {});
}

// Members may close their DMs: that is not an error.
async function dm(env, userId, content) {
  try {
    const channel = await rest(env, "POST", "/users/@me/channels", { recipient_id: userId });
    await rest(env, "POST", `/channels/${channel.id}/messages`, { content, allowed_mentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

async function guildName(env, guild) {
  try {
    return (await rest(env, "GET", `/guilds/${guild}`)).name;
  } catch {
    return "BDLMiner";
  }
}

const WARN_KEY = (guild, user) => `warns:${guild}:${user}`;

async function warnings(env, guild, user) {
  return JSON.parse((await env.BOT_KV.get(WARN_KEY(guild, user))) ?? "[]");
}

const ACTIONS = {
  async warn(i, env, t) {
    const why = option(i, "reason");
    const list = await warnings(env, i.guild_id, t.id);
    list.push({ at: Date.now(), by: userOf(i).id, reason: why });
    await env.BOT_KV.put(WARN_KEY(i.guild_id, t.id), JSON.stringify(list.slice(-MAX_WARNINGS)));
    const told = await dm(env, t.id, `⚠️ Avertissement sur **${await guildName(env, i.guild_id)}** : ${why}`);
    await log(i, env, `⚠️ Avertissement n°${list.length}`, [
      { name: "Membre", value: tag(t.user, t.id), inline: true }, { name: "Raison", value: why },
    ], 0xf1c40f);
    return say(i, `⚠️ <@${t.id}> averti (${list.length} au total)${told ? "" : ", message privé impossible"}.`,
      `⚠️ <@${t.id}> warned (${list.length} in total)${told ? "" : ", could not DM them"}.`);
  },

  async warnings(i, env, t) {
    const list = await warnings(env, i.guild_id, t.id);
    if (!list.length) return say(i, `<@${t.id}> n'a aucun avertissement.`, `<@${t.id}> has no warnings.`);
    const lines = list.slice(-15).map((w, n) => `**${list.length - Math.min(list.length, 15) + n + 1}.** <t:${Math.floor(w.at / 1000)}:d> par <@${w.by}> : ${w.reason}`);
    return say(i, `Avertissements de <@${t.id}> (${list.length}) :\n`, `Warnings of <@${t.id}> (${list.length}):\n`) + lines.join("\n");
  },

  async clearwarnings(i, env, t) {
    const count = (await warnings(env, i.guild_id, t.id)).length;
    await env.BOT_KV.delete(WARN_KEY(i.guild_id, t.id));
    await log(i, env, "🧹 Avertissements effacés", [
      { name: "Membre", value: tag(t.user, t.id), inline: true }, { name: "Nombre", value: String(count), inline: true },
    ], 0x95a5a6);
    return say(i, `🧹 ${count} avertissement(s) de <@${t.id}> effacé(s).`, `🧹 ${count} warning(s) of <@${t.id}> erased.`);
  },

  async timeout(i, env, t) {
    const seconds = option(i, "duration");
    const why = option(i, "reason") ?? "";
    const until = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
    await rest(env, "PATCH", `/guilds/${i.guild_id}/members/${t.id}`, { communication_disabled_until: until },
      `${userOf(i).username}: ${why || "timeout"}`);
    if (!seconds) {
      await log(i, env, "🔊 Sanction levée", [{ name: "Membre", value: tag(t.user, t.id), inline: true }], 0x2ecc71);
      return say(i, `🔊 <@${t.id}> peut de nouveau parler.`, `🔊 <@${t.id}> can talk again.`);
    }
    await log(i, env, "🔇 Exclusion temporaire", [
      { name: "Membre", value: tag(t.user, t.id), inline: true },
      { name: "Jusqu'à", value: `<t:${Math.floor(Date.parse(until) / 1000)}:f>`, inline: true },
      ...(why ? [{ name: "Raison", value: why }] : []),
    ], 0xe67e22);
    await dm(env, t.id, `🔇 Tu es exclu temporairement de **${await guildName(env, i.guild_id)}** jusqu'à <t:${Math.floor(Date.parse(until) / 1000)}:f>${why ? ` : ${why}` : "."}`);
    return say(i, `🔇 <@${t.id}> muet jusqu'à <t:${Math.floor(Date.parse(until) / 1000)}:t>.`,
      `🔇 <@${t.id}> muted until <t:${Math.floor(Date.parse(until) / 1000)}:t>.`);
  },

  async kick(i, env, t) {
    const why = option(i, "reason");
    // Before the kick: once out of the server, the bot can no longer DM them.
    await dm(env, t.id, `👢 Tu as été expulsé de **${await guildName(env, i.guild_id)}** : ${why}`);
    await rest(env, "DELETE", `/guilds/${i.guild_id}/members/${t.id}`, undefined, `${userOf(i).username}: ${why}`);
    await log(i, env, "👢 Expulsion", [
      { name: "Membre", value: tag(t.user, t.id), inline: true }, { name: "Raison", value: why },
    ], 0xe74c3c);
    return say(i, `👢 <@${t.id}> expulsé.`, `👢 <@${t.id}> kicked.`);
  },

  async ban(i, env, t) {
    const why = option(i, "reason");
    const seconds = option(i, "delete") ?? 0;
    await dm(env, t.id, `🔨 Tu as été banni de **${await guildName(env, i.guild_id)}** : ${why}`);
    await rest(env, "PUT", `/guilds/${i.guild_id}/bans/${t.id}`, { delete_message_seconds: seconds },
      `${userOf(i).username}: ${why}`);
    await log(i, env, "🔨 Bannissement", [
      { name: "Membre", value: tag(t.user, t.id), inline: true }, { name: "Raison", value: why },
    ], 0xc0392b);
    return say(i, `🔨 <@${t.id}> banni.`, `🔨 <@${t.id}> banned.`);
  },

  async unban(i, env) {
    const id = String(option(i, "user_id")).trim();
    if (!/^\d{17,20}$/.test(id)) return say(i, "Identifiant invalide.", "Invalid id.");
    const why = option(i, "reason") ?? "";
    try {
      await rest(env, "DELETE", `/guilds/${i.guild_id}/bans/${id}`, undefined, `${userOf(i).username}: ${why || "unban"}`);
    } catch (e) {
      if (e.status === 404) return say(i, "Cette personne n'est pas bannie.", "This user is not banned.");
      throw e;
    }
    await log(i, env, "🕊️ Bannissement levé", [
      { name: "Membre", value: `<@${id}>`, inline: true }, ...(why ? [{ name: "Raison", value: why }] : []),
    ], 0x2ecc71);
    return say(i, `🕊️ <@${id}> débanni.`, `🕊️ <@${id}> unbanned.`);
  },

  async purge(i, env, t) {
    const count = option(i, "count");
    const channel = i.channel_id ?? i.channel?.id;
    const messages = await rest(env, "GET", `/channels/${channel}/messages?limit=100`);
    // Bulk deletion refuses messages older than 14 days.
    const limit = Date.now() - 14 * DAY * 1000 + 60000;
    const ids = messages.filter((m) => (!t || m.author.id === t.id) && Date.parse(m.timestamp) > limit)
      .slice(0, count).map((m) => m.id);
    if (ids.length === 1) await rest(env, "DELETE", `/channels/${channel}/messages/${ids[0]}`, undefined, "purge");
    else if (ids.length > 1) await rest(env, "POST", `/channels/${channel}/messages/bulk-delete`, { messages: ids }, "purge");
    await log(i, env, "🗑️ Messages supprimés", [
      { name: "Nombre", value: String(ids.length), inline: true },
      ...(t ? [{ name: "Membre", value: tag(t.user, t.id), inline: true }] : []),
    ], 0x95a5a6);
    return say(i, `🗑️ ${ids.length} message(s) supprimé(s).`, `🗑️ ${ids.length} message(s) deleted.`);
  },

  async slowmode(i, env) {
    const seconds = option(i, "seconds");
    await rest(env, "PATCH", `/channels/${i.channel_id ?? i.channel?.id}`, { rate_limit_per_user: seconds },
      `${userOf(i).username}: slowmode`);
    await log(i, env, "🐢 Mode lent", [{ name: "Délai", value: `${seconds} s`, inline: true }], 0x3498db);
    return seconds ? say(i, `🐢 Mode lent : ${seconds} s.`, `🐢 Slow mode: ${seconds} s.`)
      : say(i, "🐢 Mode lent désactivé.", "🐢 Slow mode off.");
  },
};
