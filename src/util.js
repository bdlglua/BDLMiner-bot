// Small helpers shared by the commands: language, formatting, server lookups.

import { rest } from "./discord.js";

// The server speaks French; members with an English client get English.
export function lang(interaction) {
  const locale = interaction.locale || interaction.guild_locale || "fr";
  return locale.startsWith("fr") ? "fr" : "en";
}

export function say(interaction, fr, en) {
  return lang(interaction) === "fr" ? fr : en;
}

const PREFIXES = ["", "k", "M", "G", "T", "P", "E", "Z"];

// 1234567 -> "1.23 M"; `unit` is appended ("H/s").
export function si(value, unit = "") {
  if (!Number.isFinite(value)) return "?";
  let i = 0;
  while (Math.abs(value) >= 1000 && i < PREFIXES.length - 1) {
    value /= 1000;
    i++;
  }
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${PREFIXES[i]}${unit}`.trim();
}

// "1.2M", "500 kH/s", "1.5 TH/s", "980000" -> hashes per second; NaN otherwise.
export function parseRate(text) {
  const m = String(text ?? "").trim().match(/^(\d+(?:[.,]\d+)?)\s*([kKmMgGtTpPeE]?)\s*(?:h\/?s|H\/?s)?$/);
  if (!m) return NaN;
  const value = Number(m[1].replace(",", "."));
  const power = m[2] ? "KMGTPE".indexOf(m[2].toUpperCase()) + 1 : 0;
  return value * 1000 ** power;
}

// Seconds -> "4.3 s", "1 h 12 min", "8.9 years"
export function duration(seconds, l = "fr") {
  const fr = l === "fr";
  if (!Number.isFinite(seconds)) return "∞";
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 3570) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const minutes = Math.round(seconds / 60), h = Math.floor(minutes / 60), m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const days = seconds / 86400;
  if (days < 365) return `${days.toFixed(days < 10 ? 1 : 0)} ${fr ? "jours" : "days"}`;
  const years = days / 365.25;
  if (years < 1000) return `${years.toFixed(years < 10 ? 1 : 0)} ${fr ? "ans" : "years"}`;
  if (years < 1e6) return `${number(Math.round(years), l)} ${fr ? "ans" : "years"}`;
  const [scale, word] = years < 1e9 ? [1e6, fr ? "millions d'années" : "million years"]
    : [1e9, fr ? "milliards d'années" : "billion years"];
  return `${number(Number((years / scale).toPrecision(3)), l)} ${word}`;
}

export function number(value, l = "fr") {
  return Number.isFinite(value) ? value.toLocaleString(l === "fr" ? "fr-FR" : "en-US") : "?";
}

// Probability as text, readable from 50 % down to one in billions.
export function chance(p, l = "fr") {
  if (!(p > 0)) return "0 %";
  if (p >= 0.01) return `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)} %`;
  return `${l === "fr" ? "1 sur" : "1 in"} ${number(Math.round(1 / p), l)}`;
}

// JSON GET with a timeout; throws on HTTP errors.
export async function getJson(url, seconds = 8) {
  const res = await fetch(url, { signal: AbortSignal.timeout(seconds * 1000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// The moderation log channel and moderator role are found by name, so the
// bot needs no configuration; the ids found are cached in KV for a day.
const LOOKUP_TTL = 86400;

export async function modLogChannel(env, guild) {
  if (env.MOD_LOG_CHANNEL_ID) return env.MOD_LOG_CHANNEL_ID;
  return cached(env, `cfg:${guild}:modlog`, async () => {
    const channels = await rest(env, "GET", `/guilds/${guild}/channels`);
    return channels.find((c) => c.type === 0 && /mod[ée]ration/i.test(c.name))?.id ?? "";
  });
}

export async function modRole(env, guild) {
  if (env.MOD_ROLE_ID) return env.MOD_ROLE_ID;
  return cached(env, `cfg:${guild}:modrole`, async () => {
    const roles = await rest(env, "GET", `/guilds/${guild}/roles`);
    return roles.find((r) => /mod[ée]rat/i.test(r.name))?.id ?? "";
  });
}

async function cached(env, key, find) {
  const hit = await env.BOT_KV.get(key);
  if (hit !== null) return hit;
  const value = await find();
  if (value) await env.BOT_KV.put(key, value, { expirationTtl: LOOKUP_TTL });
  return value;
}

export function userOf(interaction) {
  return interaction.member?.user ?? interaction.user;
}
