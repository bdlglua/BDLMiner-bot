// BDLMiner releases: /release shows one, and a scheduled check posts each new
// release in the server's releases channel.

import { option, rest } from "../discord.js";
import { lang } from "../util.js";

const REPO = "bdlglua/BDLMinerV1";
const API = `https://api.github.com/repos/${REPO}`;
const INSTALLER = "https://bdlglua.github.io/BDLMinerV1/";
const ORANGE = 0xf7931a;
const NOTES_MAX = 3500;
const DAY = 86400;

export const definitions = [{
  name: "release", description: "BDLMiner V1's latest release, or a given version",
  description_localizations: { fr: "La dernière version de BDLMiner V1, ou une version donnée" },
  options: [{
    type: 3, name: "version", description: "e.g. 1.7.2 (default: the latest)", max_length: 20,
    description_localizations: { fr: "ex. 1.7.2 (par défaut : la dernière)" },
  }],
}];

export function handles(name) {
  return name === "release";
}

export function handle(interaction, env) {
  const asked = String(option(interaction, "version") ?? "").trim().replace(/^v/i, "");
  if (asked && !/^\d+\.\d+\.\d+$/.test(asked))
    return {
      content: lang(interaction) === "fr" ? "Version illisible : écris par exemple `1.7.2`." : "Unreadable version: write for instance `1.7.2`.",
      ephemeral: true,
    };
  return {
    defer: true, ephemeral: false,
    run: async () => {
      const release = asked ? await tagged(env, `v${asked}`) : await latest(env);
      if (!release)
        return lang(interaction) === "fr" ? `La version ${asked} n'existe pas.` : `There is no version ${asked}.`;
      return { embeds: [embed(release, lang(interaction))] };
    },
  };
}

// --- GitHub ---

function slim(r) {
  return { tag_name: r.tag_name, name: r.name, body: r.body ?? "", html_url: r.html_url, published_at: r.published_at };
}

async function github(path, etag) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "bdlminer-bot", "X-GitHub-Api-Version": "2022-11-28" };
  if (etag) headers["If-None-Match"] = etag;
  return fetch(API + path, { headers, signal: AbortSignal.timeout(8000) });
}

// The latest release, kept in KV with its ETag: an unchanged answer (304) does
// not count against GitHub's limit of 60 anonymous requests an hour, which the
// Workers' shared addresses could otherwise reach.
export async function latest(env) {
  const cached = await env.BOT_KV.get("release:latest");
  const res = await github("/releases/latest", cached ? await env.BOT_KV.get("release:etag") : null);
  if (res.status === 304 && cached) return JSON.parse(cached);
  if (!res.ok) {
    if (cached) return JSON.parse(cached);
    throw new Error(`GitHub ${res.status}`);
  }
  const release = slim(await res.json());
  await env.BOT_KV.put("release:latest", JSON.stringify(release));
  const etag = res.headers.get("ETag");
  if (etag) await env.BOT_KV.put("release:etag", etag);
  return release;
}

async function tagged(env, tag) {
  const key = `release:tag:${tag}`;
  const cached = await env.BOT_KV.get(key);
  if (cached) return JSON.parse(cached);
  const res = await github(`/releases/tags/${tag}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const release = slim(await res.json());
  await env.BOT_KV.put(key, JSON.stringify(release), { expirationTtl: DAY });
  return release;
}

// --- Release notes as a Discord embed ---

// The notes are written for GitHub: hard-wrapped lines, ## headings, links
// relative to docs/releases/. Discord keeps line breaks and ignores headings
// in embeds, and relative links lead nowhere.
export function notes(body, tag, max = NOTES_MAX) {
  const base = `https://github.com/${REPO}/blob/${tag}/docs/releases/`;
  let text = body.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\]\(([^)\s]+)\)/g, (m, url) => (/^[a-z]+:/i.test(url) || url.startsWith("#") ? m : `](${new URL(url, base)})`));
  // Join wrapped lines, but not list items, headings or paragraphs.
  text = text.replace(/([^\n])\n(?![ \t]*(?:[-*+] |\d+\. |#|\n|$))[ \t]*/g, "$1 ");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "**$1**").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n\n", max);
  return `${text.slice(0, cut > max / 2 ? cut : max).trimEnd()}\n\n…`;
}

export function embed(release, l = "fr") {
  const fr = l === "fr";
  return {
    title: `🚀 ${release.name || `BDLMiner V1 ${release.tag_name}`}`,
    url: release.html_url,
    color: ORANGE,
    description: notes(release.body, release.tag_name),
    fields: [{
      name: fr ? "Installer" : "Install",
      value: fr
        ? `Les miners la trouvent d'eux-mêmes sur GitHub dans l'heure. Première installation : [installateur web](${INSTALLER}) · [notes complètes](${release.html_url})`
        : `Miners find it on GitHub by themselves within the hour. First install: [web flasher](${INSTALLER}) · [full notes](${release.html_url})`,
    }],
    footer: { text: release.tag_name },
    timestamp: release.published_at ?? undefined,
  };
}

// --- Announcing new releases ---

async function find(env, guild, kind, test) {
  const key = `cfg:${guild}:${kind}`;
  const hit = await env.BOT_KV.get(key);
  if (hit !== null) return hit;
  const list = await rest(env, "GET", kind === "releases" ? `/guilds/${guild}/channels` : `/guilds/${guild}/roles`);
  const id = list.find(test)?.id ?? "";
  if (id) await env.BOT_KV.put(key, id, { expirationTtl: DAY });
  return id;
}

// Called by the scheduled trigger. The first run only records the current
// release, so that deploying the bot does not announce an old one again.
export async function announce(env) {
  const guild = env.DISCORD_GUILD_ID;
  if (!guild) return "no guild";
  const release = await latest(env);
  const posted = await env.BOT_KV.get("release:posted");
  if (posted === release.tag_name) return "up to date";
  if (posted === null) {
    await env.BOT_KV.put("release:posted", release.tag_name);
    return `recorded ${release.tag_name}`;
  }
  const channel = env.RELEASE_CHANNEL_ID ||
    await find(env, guild, "releases", (c) => (c.type === 0 || c.type === 5) && /release/i.test(c.name));
  if (!channel) return "no releases channel";
  const role = await find(env, guild, "announce-role", (r) => /annonce|announce/i.test(r.name)).catch(() => "");
  await rest(env, "POST", `/channels/${channel}/messages`, {
    content: `${role ? `<@&${role}> ` : ""}**${release.name || release.tag_name}** est sortie !`,
    embeds: [embed(release, "fr")],
    allowed_mentions: { roles: role ? [role] : [] },
  });
  // Recorded only once posted: a failed post is tried again at the next run.
  await env.BOT_KV.put("release:posted", release.tag_name);
  return `posted ${release.tag_name}`;
}
