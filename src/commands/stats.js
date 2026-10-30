// Bitcoin network and pool statistics: /btc, /pool and /odds.

import { option } from "../discord.js";
import { chance, duration, getJson, lang, number, parseRate, say, si } from "../util.js";

const MEMPOOL = "https://mempool.space/api";
const TWO32 = 2 ** 32;
const SUBSIDY = 3.125;  // BTC per block until the 2028 halving
const ORANGE = 0xf7931a;

// The pools the README suggests for ESP32 miners; any other host can be typed.
const POOLS = [
  ["public-pool.io", "public-pool.io"],
  ["pool.nerdminers.org", "pool.nerdminers.org"],
  ["pool.nerdminer.io", "pool.nerdminer.io"],
  ["solo.ckpool.org", "solo.ckpool.org"],
];

const pub = {
  type: 5, name: "public", description: "Show the answer to everyone (default: only you)",
  description_localizations: { fr: "Montrer la réponse à tout le monde (par défaut : à toi seul)" },
};

export const definitions = [
  {
    name: "btc", description: "Bitcoin price, block height, difficulty, fees",
    description_localizations: { fr: "Prix du Bitcoin, hauteur, difficulté, frais" },
  },
  {
    name: "pool", description: "What a solo pool sees of a Bitcoin address",
    description_localizations: { fr: "Ce qu'une pool solo voit d'une adresse Bitcoin" },
    options: [
      {
        type: 3, name: "address", description: "Your Bitcoin address (as entered in the miner)", required: true,
        min_length: 14, max_length: 100,
        name_localizations: { fr: "adresse" }, description_localizations: { fr: "Ton adresse Bitcoin (comme dans le miner)" },
      },
      {
        type: 3, name: "pool", description: "The pool (default: public-pool.io)",
        description_localizations: { fr: "La pool (par défaut : public-pool.io)" },
        choices: POOLS.map(([name, value]) => ({ name, value })),
      },
      {
        type: 3, name: "host", description: "Another pool's host, e.g. eusolo.ckpool.org", max_length: 100,
        name_localizations: { fr: "hôte" }, description_localizations: { fr: "L'hôte d'une autre pool, ex. eusolo.ckpool.org" },
      },
      pub,
    ],
  },
  {
    name: "odds", description: "Your chance of finding a block, from your hashrate",
    description_localizations: { fr: "Tes chances de trouver un bloc, selon ton hashrate" },
    options: [{
      type: 3, name: "hashrate", description: "e.g. 1M, 350k, 1.2 TH/s", required: true, max_length: 20,
      description_localizations: { fr: "ex. 1M, 350k, 1,2 TH/s" },
    }, pub],
  },
];

export function handles(name) {
  return name === "btc" || name === "pool" || name === "odds";
}

export function handle(interaction) {
  const name = interaction.data.name;
  if (name === "odds" && !(parseRate(option(interaction, "hashrate")) > 0))
    return {
      content: say(interaction, "Hashrate illisible : écris par exemple `1M`, `350k` ou `1.2 TH/s`.",
        "Unreadable hashrate: write for instance `1M`, `350k` or `1.2 TH/s`."),
      ephemeral: true,
    };
  const ephemeral = name !== "btc" && !option(interaction, "public");
  const run = { btc, pool, odds }[name];
  return { defer: true, ephemeral, run: () => run(interaction) };
}

async function btc(i) {
  const l = lang(i);
  const [prices, adjust, height, fees, mining] = await Promise.all([
    getJson(`${MEMPOOL}/v1/prices`),
    getJson(`${MEMPOOL}/v1/difficulty-adjustment`),
    getJson(`${MEMPOOL}/blocks/tip/height`),
    getJson(`${MEMPOOL}/v1/fees/recommended`),
    getJson(`${MEMPOOL}/v1/mining/hashrate/3d`),
  ]);
  const fr = l === "fr";
  const change = adjust.difficultyChange;
  return {
    embeds: [{
      title: "₿ Bitcoin", url: "https://mempool.space", color: ORANGE,
      fields: [
        { name: fr ? "Prix" : "Price", value: `${number(prices.USD, l)} $ · ${number(prices.EUR, l)} €`, inline: true },
        { name: fr ? "Hauteur" : "Height", value: number(height, l), inline: true },
        { name: fr ? "Difficulté" : "Difficulty", value: si(mining.currentDifficulty), inline: true },
        { name: fr ? "Hashrate réseau" : "Network hashrate", value: si(mining.currentHashrate, "H/s"), inline: true },
        {
          name: fr ? "Prochain ajustement" : "Next adjustment",
          value: `${change >= 0 ? "+" : ""}${change.toFixed(2)} % · ${number(adjust.remainingBlocks, l)} ${fr ? "blocs" : "blocks"} · <t:${Math.floor(adjust.estimatedRetargetDate / 1000)}:R>`,
          inline: true,
        },
        {
          name: fr ? "Frais (sat/vB)" : "Fees (sat/vB)",
          value: `${fr ? "rapide" : "fast"} ${fees.fastestFee} · 30 min ${fees.halfHourFee} · 1 h ${fees.hourFee}`,
          inline: true,
        },
      ],
      footer: { text: "mempool.space" },
      timestamp: new Date().toISOString(),
    }],
  };
}

// Pool APIs as the miner itself finds them (src/market.cpp in BDLMinerV1):
// ckpool's /users/<address> (also /api/miner?address=) and public-pool's
// /api/client/<address>, on the host and on its parent domain.
export function candidates(host, address) {
  const a = encodeURIComponent(address);
  const hosts = [host];
  const parts = host.split(".");
  if (parts.length > 2 && !/^[\d.]+$/.test(host)) hosts.push(parts.slice(1).join("."));
  const urls = [];
  for (const h of hosts)
    urls.push(`https://${h}/users/${a}`, `https://${h}:40557/api/client/${a}`, `https://${h}/api/client/${a}`,
      `https://${h}/api/miner?address=${a}`);
  return urls;
}

function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
}

// Reads either API's JSON; null for anything else.
export function parseStats(doc) {
  if (!doc || typeof doc !== "object") return null;
  if ("bestDifficulty" in doc || "workersCount" in doc) {  // public-pool
    const workers = Array.isArray(doc.workers) ? doc.workers : [];
    return {
      kind: "public-pool",
      hashrate: workers.reduce((sum, w) => sum + (num(w.hashRate) ?? 0), 0),
      best: num(doc.bestDifficulty),
      shares: num(doc.accounting?.totalAcceptedShares),
      workers: doc.workersCount ?? workers.length,
      names: workers.map((w) => w.name).filter(Boolean),
    };
  }
  if ("bestever" in doc || "hashrate1hr" in doc || "hashrate5m" in doc) {  // ckpool
    return {
      kind: "ckpool",
      hashrate: parseRate(doc.hashrate1hr ?? doc.hashrate5m),
      hashrate5m: parseRate(doc.hashrate5m),
      best: num(doc.bestever),
      shares: num(doc.shares),
      workers: num(doc.workers),
      lastShare: num(doc.lastshare),
      names: Array.isArray(doc.worker) ? doc.worker.map((w) => String(w.workername ?? "").split(".").pop()) : [],
    };
  }
  return null;
}

async function lookup(host, address) {
  const tries = candidates(host, address).map(async (url) => {
    const stats = parseStats(await getJson(url, 6));
    if (!stats) throw new Error("not a pool API");
    return { url, stats };
  });
  try {
    return await Promise.any(tries);
  } catch {
    return null;
  }
}

async function pool(i) {
  const l = lang(i), fr = l === "fr";
  const address = String(option(i, "address")).trim().split(".")[0];
  const host = String(option(i, "host") ?? option(i, "pool") ?? "public-pool.io").trim().toLowerCase()
    .replace(/^[a-z0-9+]+:\/\//, "").replace(/[:/].*$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return say(i, "Hôte de pool invalide.", "Invalid pool host.");
  if (!/^[a-zA-Z0-9]{14,100}$/.test(address)) return say(i, "Adresse invalide.", "Invalid address.");

  const found = await lookup(host, address);
  if (!found)
    return say(i,
      `**${host}** ne connaît pas encore \`${address}\`, ou sa page de statistiques ne répond pas. La plupart des pools ne publient une adresse qu'après sa première share acceptée.`,
      `**${host}** does not know \`${address}\` yet, or its statistics page is not answering. Most pools only publish an address after its first accepted share.`);

  const s = found.stats;
  const fields = [
    { name: "Hashrate", value: s.hashrate > 0 ? si(s.hashrate, "H/s") : "0", inline: true },
    { name: fr ? "Meilleure difficulté" : "Best difficulty", value: s.best !== undefined ? si(s.best) : "?", inline: true },
    { name: fr ? "Shares acceptées" : "Accepted shares", value: s.shares !== undefined ? number(s.shares, l) : "?", inline: true },
    { name: "Workers", value: String(s.workers ?? "?"), inline: true },
  ];
  if (s.lastShare) fields.push({ name: fr ? "Dernière share" : "Last share", value: `<t:${s.lastShare}:R>`, inline: true });
  if (s.names.length) fields.push({ name: fr ? "Noms" : "Names", value: s.names.slice(0, 10).join(", ").slice(0, 1000) });
  const notes = [];
  if (s.kind === "public-pool" && !s.workers)
    notes.push(fr
      ? "public-pool n'affiche un worker que s'il a envoyé une share dans les 10 dernières minutes (difficulté imposée : 1, environ une share par heure à 1 MH/s)."
      : "public-pool only lists a worker that sent a share in the last 10 minutes (it imposes difficulty 1, about one share an hour at 1 MH/s).");
  return {
    embeds: [{
      title: `⛏️ ${host}`, color: ORANGE, description: `\`${address}\`${notes.length ? `\n\n${notes.join("\n")}` : ""}`,
      fields, footer: { text: found.url.replace(/^https:\/\//, "").replace(address, "…") },
    }],
  };
}

async function odds(i) {
  const l = lang(i), fr = l === "fr";
  const rate = parseRate(option(i, "hashrate"));
  const [mining, prices] = await Promise.all([
    getJson(`${MEMPOOL}/v1/mining/hashrate/3d`), getJson(`${MEMPOOL}/v1/prices`).catch(() => ({})),
  ]);
  const difficulty = mining.currentDifficulty;
  const perBlock = (difficulty * TWO32) / rate;  // seconds, on average
  const p = (seconds) => -Math.expm1(-seconds / perBlock);
  const reward = prices.USD ? ` (≈ ${number(Math.round(SUBSIDY * prices.USD), l)} $)` : "";
  return {
    embeds: [{
      title: `🎲 ${si(rate, "H/s")}`, color: ORANGE,
      description: fr
        ? `Un bloc rapporte **${SUBSIDY} BTC** + les frais${reward}. Chaque hash a la même chance : il n'y a pas de progression, seulement une loterie.`
        : `A block pays **${SUBSIDY} BTC** + fees${reward}. Every hash has the same chance: there is no progress, only a lottery.`,
      fields: [
        { name: fr ? "Par jour" : "Per day", value: chance(p(86400), l), inline: true },
        { name: fr ? "Par an" : "Per year", value: chance(p(365.25 * 86400), l), inline: true },
        { name: fr ? "Temps moyen pour un bloc" : "Average time to a block", value: duration(perBlock, l), inline: true },
        { name: fr ? "Une share de difficulté 1" : "A difficulty 1 share", value: `${fr ? "toutes les" : "every"} ${duration(TWO32 / rate, l)}`, inline: true },
        { name: fr ? "Difficulté du réseau" : "Network difficulty", value: si(difficulty), inline: true },
      ],
      footer: { text: "mempool.space" },
    }],
  };
}
