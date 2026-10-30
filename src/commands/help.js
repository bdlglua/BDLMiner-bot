// /help: every command the member can use, by category, built from the
// command definitions so that it never goes out of date.

import { has } from "../discord.js";
import { lang } from "../util.js";
import * as answers from "./answers.js";
import * as moderation from "./moderation.js";
import * as releases from "./releases.js";
import * as stats from "./stats.js";
import * as tickets from "./tickets.js";

const ORANGE = 0xf7931a;

export const definitions = [{
  name: "help", description: "All the bot's commands, by category",
  description_localizations: { fr: "Toutes les commandes du bot, par catégorie" },
}];

// Order shown; /help itself goes with the quick answers.
const CATEGORIES = [
  { fr: "📚 Aide et réponses rapides", en: "📚 Help and quick answers", commands: () => [...answers.definitions, ...releases.definitions, ...definitions] },
  { fr: "₿ Bitcoin et pools", en: "₿ Bitcoin and pools", commands: () => stats.definitions },
  {
    fr: "🎫 Support", en: "🎫 Support", commands: () => tickets.definitions,
    note: {
      fr: "Le bouton **Ouvrir un ticket** ouvre un fil privé avec l'équipe.",
      en: "The **Open a ticket** button opens a private thread with the team.",
    },
  },
  { fr: "🛡️ Modération", en: "🛡️ Moderation", commands: () => moderation.definitions },
];

export function handles(name) {
  return name === "help";
}

// "/warn membre raison" with optional options in brackets, in the member's language.
export function usage(command, l) {
  const local = (o) => (l === "fr" && o.name_localizations?.fr) || o.name;
  const options = (command.options ?? []).map((o) => (o.required ? local(o) : `[${local(o)}]`));
  return `\`/${[command.name, ...options].join(" ")}\``;
}

function allowed(interaction, command) {
  const needed = command.default_member_permissions;
  return !needed || has(interaction, BigInt(needed));
}

// A field holds at most 1024 characters: long categories continue in a second one.
function fields(title, lines) {
  const out = [];
  let value = "";
  for (const line of lines) {
    if (value && value.length + line.length + 1 > 1024) {
      out.push({ name: out.length ? `${title} (2)` : title, value });
      value = "";
    }
    value += (value ? "\n" : "") + line;
  }
  if (value) out.push({ name: out.length ? `${title} (2)` : title, value });
  return out;
}

export function handle(interaction) {
  const l = lang(interaction);
  const fr = l === "fr";
  const embedFields = [];
  for (const category of CATEGORIES) {
    const visible = category.commands().filter((c) => allowed(interaction, c));
    const lines = visible.map((c) => `${usage(c, l)} · ${(fr && c.description_localizations?.fr) || c.description}`);
    if (category.note) lines.push(category.note[l]);
    if (visible.length || category.note) embedFields.push(...fields(category[l], lines));
  }
  return {
    ephemeral: true,
    embeds: [{
      color: ORANGE,
      title: fr ? "🤖 Commandes du bot BDLMiner" : "🤖 BDLMiner bot commands",
      description: fr
        ? "Tape `/` puis le nom d'une commande. Les options entre crochets sont facultatives."
        : "Type `/` then a command's name. Options in brackets are optional.",
      fields: embedFields,
      footer: {
        text: fr ? "Seules les commandes que tu peux utiliser sont listées." : "Only the commands you can use are listed.",
      },
    }],
  };
}
