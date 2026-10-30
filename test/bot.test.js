import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import worker, { commands } from "../src/index.js";
import { candidates, parseStats } from "../src/commands/stats.js";
import { announce, notes, parseFeed } from "../src/commands/releases.js";
import { chance, duration, parseRate, si } from "../src/util.js";

// --- Test harness: a signing key, a fake KV, a fake Discord/mempool ---

const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");

class Kv {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
}

let env, calls, routes;

function route(method, pattern, reply) {
  routes.push({ method, pattern, reply });
}

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
  const r = routes.find((x) => x.method === method && x.pattern.test(String(url)));
  if (!r) return new Response("not found", { status: 404 });
  const value = typeof r.reply === "function" ? r.reply(String(url), init) : r.reply;
  if (value instanceof Response) return value;
  return value === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value));
};

beforeEach(() => {
  env = { DISCORD_PUBLIC_KEY: publicKey, DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: "999", BOT_KV: new Kv() };
  calls = [];
  routes = [];
});

async function signed(body, { tamper = false } = {}) {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + text))).toString("hex");
  return new Request("https://bot.example/", {
    method: "POST", body: tamper ? text.replace("}", ',"x":1}') : text,
    headers: { "X-Signature-Ed25519": sig, "X-Signature-Timestamp": timestamp },
  });
}

// Runs one interaction; returns the immediate response and, once the
// background work is done, the deferred follow-up message (if any).
async function run(interaction) {
  const pending = [];
  const res = await worker.fetch(await signed(interaction), env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const follow = calls.find((c) => c.method === "PATCH" && c.url.includes("/messages/@original"));
  return { status: res.status, body: await res.json().catch(() => null), follow: follow?.body };
}

const MOD = String((1n << 40n) | (1n << 13n));  // moderate + manage messages
const ADMIN = String(1n << 3n);

function command(name, options = [], { perms = MOD, resolved, locale = "fr", user = { id: "100", username: "alice" } } = {}) {
  return {
    type: 2, token: "tok", guild_id: "1", channel_id: "50", locale,
    member: { user, permissions: perms },
    data: { name, options, resolved },
  };
}

function member(id, perms = "0") {
  return { users: { [id]: { id, username: `u${id}` } }, members: { [id]: { permissions: perms } } };
}

// --- Tests ---

describe("signature", () => {
  it("answers Discord's PING", async () => {
    const res = await worker.fetch(await signed({ type: 1 }), env, { waitUntil() {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 1 });
  });

  it("refuses a tampered body and a missing signature", async () => {
    const res = await worker.fetch(await signed({ type: 1 }, { tamper: true }), env, { waitUntil() {} });
    assert.equal(res.status, 401);
    const bare = new Request("https://bot.example/", { method: "POST", body: "{}" });
    assert.equal((await worker.fetch(bare, env, { waitUntil() {} })).status, 401);
  });
});

describe("commands", () => {
  it("have unique names and valid shapes for registration", () => {
    const names = commands.map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
    for (const c of commands) {
      assert.match(c.name, /^[a-z-]{1,32}$/);
      assert.ok(c.description.length <= 100, c.name);
      for (const o of c.options ?? []) {
        assert.match(o.name, /^[a-z_]{1,32}$/, `${c.name}.${o.name}`);
        assert.ok(o.description.length <= 100, `${c.name}.${o.name}`);
        for (const ch of o.choices ?? []) assert.ok(ch.name.length <= 100);
      }
      // Required options must come first.
      const req = (c.options ?? []).map((o) => !!o.required);
      assert.deepEqual(req, [...req].sort((a, b) => b - a), c.name);
    }
  });
});

describe("moderation", () => {
  it("refuses a member without the permission", async () => {
    const { body } = await run(command("warn", [{ name: "member", value: "200" }, { name: "reason", value: "spam" }],
      { perms: "0", resolved: member("200") }));
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, 64);
    assert.match(body.data.content, /permission/);
    assert.equal(calls.length, 0);
  });

  it("refuses to act on staff unless an administrator asks", async () => {
    const { body } = await run(command("kick", [{ name: "member", value: "200" }, { name: "reason", value: "x" }],
      { perms: String(1n << 1n), resolved: member("200", MOD) }));
    assert.match(body.data.content, /équipe/);
  });

  it("warns: keeps the history, DMs the member, logs and answers privately", async () => {
    route("GET", /\/guilds\/1\/channels$/, [{ id: "77", type: 0, name: "🔒-modération" }]);
    route("GET", /\/guilds\/1$/, { name: "BDLMiner" });
    route("POST", /\/users\/@me\/channels$/, { id: "dm1" });
    route("POST", /\/channels\/(dm1|77)\/messages$/, { id: "m" });
    route("PATCH", /@original/, null);
    for (const n of [1, 2]) {
      calls = [];
      const { body, follow } = await run(command("warn", [{ name: "member", value: "200" }, { name: "reason", value: `spam ${n}` }],
        { resolved: member("200") }));
      assert.deepEqual(body, { type: 5, data: { flags: 64 } });
      assert.match(follow.content, new RegExp(`${n} au total`));
    }
    const list = JSON.parse(await env.BOT_KV.get("warns:1:200"));
    assert.deepEqual(list.map((w) => w.reason), ["spam 1", "spam 2"]);
    assert.ok(calls.some((c) => c.url.endsWith("/channels/dm1/messages") && c.body.content.includes("spam 2")));
    const logged = calls.find((c) => c.url.endsWith("/channels/77/messages"));
    assert.equal(logged.body.embeds[0].title, "⚠️ Avertissement n°2");
  });

  it("times out with a reason in the audit log, and lifts it", async () => {
    route("PATCH", /\/guilds\/1\/members\/200$/, {});
    route("PATCH", /@original/, null);
    env.MOD_LOG_CHANNEL_ID = "77";
    route("POST", /./, { id: "x" });
    route("GET", /\/guilds\/1$/, { name: "BDLMiner" });
    await run(command("timeout", [{ name: "member", value: "200" }, { name: "duration", value: 600 }, { name: "reason", value: "flood" }],
      { resolved: member("200") }));
    const patch = calls.find((c) => c.url.endsWith("/members/200"));
    const until = Date.parse(patch.body.communication_disabled_until);
    assert.ok(Math.abs(until - Date.now() - 600000) < 5000);
    assert.equal(patch.headers["X-Audit-Log-Reason"], encodeURIComponent("alice: flood"));
    calls = [];
    await run(command("timeout", [{ name: "member", value: "200" }, { name: "duration", value: 0 }], { resolved: member("200") }));
    assert.equal(calls.find((c) => c.url.endsWith("/members/200")).body.communication_disabled_until, null);
  });

  it("purges only recent messages of the chosen member", async () => {
    const now = Date.now();
    route("GET", /\/channels\/50\/messages\?limit=100$/, [
      { id: "1", author: { id: "200" }, timestamp: new Date(now - 1000).toISOString() },
      { id: "2", author: { id: "300" }, timestamp: new Date(now - 2000).toISOString() },
      { id: "3", author: { id: "200" }, timestamp: new Date(now - 3000).toISOString() },
      { id: "4", author: { id: "200" }, timestamp: new Date(now - 15 * 86400000).toISOString() },
    ]);
    route("POST", /bulk-delete$/, null);
    route("GET", /\/guilds\/1\/channels$/, []);
    route("PATCH", /@original/, null);
    const { follow } = await run(command("purge", [{ name: "count", value: 10 }, { name: "member", value: "200" }],
      { resolved: member("200") }));
    assert.deepEqual(calls.find((c) => c.url.endsWith("bulk-delete")).body, { messages: ["1", "3"] });
    assert.match(follow.content, /2 message/);
  });

  it("reports a Discord refusal in the follow-up", async () => {
    route("DELETE", /\/guilds\/1\/members\/200$/, new Response('{"message":"Missing Permissions"}', { status: 403 }));
    route("POST", /\/users\/@me\/channels$/, new Response("", { status: 403 }));
    route("GET", /\/guilds\/1$/, { name: "BDLMiner" });
    route("PATCH", /@original/, null);
    const { follow } = await run(command("kick", [{ name: "member", value: "200" }, { name: "reason", value: "x" }],
      { perms: ADMIN, resolved: member("200") }));
    assert.match(follow.content, /❌ Échec : Discord 403/);
  });
});

describe("statistics", () => {
  it("parses hashrates, sizes and durations", () => {
    assert.equal(parseRate("1M"), 1e6);
    assert.equal(parseRate("350 kH/s"), 350e3);
    assert.equal(parseRate("1,2 TH/s"), 1.2e12);
    assert.equal(parseRate("980000"), 980000);
    assert.ok(Number.isNaN(parseRate("fast")));
    assert.equal(si(1.234e14), "123 T");
    assert.equal(si(1.5e6, "H/s"), "1.50 MH/s");
    assert.equal(duration(4.29), "4.3 s");
    assert.equal(duration(4295), "1 h 12 min");
    assert.equal(duration(8.9 * 365.25 * 86400, "en"), "8.9 years");
    assert.equal(duration(0.0036), "4 ms");
    assert.equal(duration(3599), "1 h");
    assert.equal(duration(16827 * 365.25 * 86400, "en"), "16,827 years");
    assert.equal(duration(2.02e10 * 365.25 * 86400), "20,2 milliards d'années");
    assert.equal(chance(0.5), "50 %");
    assert.equal(chance(1e-6, "en"), "1 in 1,000,000");
  });

  it("reads public-pool and ckpool answers like the miner", () => {
    const pp = parseStats({ bestDifficulty: "1234.5", workersCount: 1, workers: [{ name: "bdl", hashRate: 1.1e6 }], accounting: { totalAcceptedShares: "12" } });
    assert.deepEqual(pp, { kind: "public-pool", hashrate: 1.1e6, best: 1234.5, shares: 12, workers: 1, names: ["bdl"] });
    const ck = parseStats({ hashrate1hr: "1.02M", hashrate5m: "980K", bestever: 3456, shares: 40, workers: 1, lastshare: 1761800000, worker: [{ workername: "bc1q.bdl" }] });
    assert.equal(ck.kind, "ckpool");
    assert.equal(ck.hashrate, 1.02e6);
    assert.deepEqual(ck.names, ["bdl"]);
    assert.equal(parseStats({ error: "not found" }), null);
  });

  it("tries the miner's API paths on the host and its parent domain", () => {
    const urls = candidates("eu.pool.example", "bc1qabc");
    assert.ok(urls.includes("https://eu.pool.example/users/bc1qabc"));
    assert.ok(urls.includes("https://pool.example:40557/api/client/bc1qabc"));
    assert.ok(urls.includes("https://pool.example/api/miner?address=bc1qabc"));
    assert.equal(candidates("pool.example", "a").length, 4);
  });

  it("/pool answers from whichever API knows the address", async () => {
    route("GET", /pool\.nerdminers\.org\/users\/bc1qtestaddress123$/, { hashrate1hr: "1.1M", bestever: 777, shares: 5, workers: 1 });
    route("PATCH", /@original/, null);
    const { body, follow } = await run(command("pool", [{ name: "address", value: "bc1qtestaddress123.rig" }, { name: "pool", value: "pool.nerdminers.org" }]));
    assert.deepEqual(body, { type: 5, data: { flags: 64 } });
    assert.equal(follow.embeds[0].title, "⛏️ pool.nerdminers.org");
    assert.equal(follow.embeds[0].fields[0].value, "1.10 MH/s");
  });

  it("/odds refuses an unreadable hashrate at once, and computes from the difficulty", async () => {
    const bad = await run(command("odds", [{ name: "hashrate", value: "beaucoup" }]));
    assert.equal(bad.body.type, 4);
    route("GET", /mining\/hashrate\/3d$/, { currentDifficulty: 1e14, currentHashrate: 7e20 });
    route("GET", /v1\/prices$/, { USD: 100000, EUR: 90000 });
    route("PATCH", /@original/, null);
    const { follow } = await run(command("odds", [{ name: "hashrate", value: "1M" }, { name: "public", value: true }], { locale: "en-US" }));
    const fields = Object.fromEntries(follow.embeds[0].fields.map((f) => [f.name, f.value]));
    assert.equal(fields["A difficulty 1 share"], "every 1 h 12 min");
    assert.match(fields["Per year"], /^1 in /);
  });
});

describe("answers", () => {
  it("answers in the member's language and mentions the member asked for", async () => {
    const fr = await run(command("install", [{ name: "for", value: "300" }]));
    assert.equal(fr.body.data.content, "<@300>");
    assert.deepEqual(fr.body.data.allowed_mentions, { users: ["300"] });
    assert.match(fr.body.data.embeds[0].title, /Installer/);
    const en = await run(command("faq", [{ name: "topic", value: "worker" }], { locale: "en-GB" }));
    assert.match(en.body.data.embeds[0].description, /Worker missing/);
    assert.equal(en.body.data.flags, 0);
  });
});

describe("help", () => {
  const names = (body) => body.data.embeds[0].fields.map((f) => f.name);
  const text = (body) => body.data.embeds[0].fields.map((f) => f.value).join("\n");

  it("lists every command by category for an administrator", async () => {
    const { body } = await run(command("help", [], { perms: ADMIN }));
    assert.equal(body.data.flags, 64);
    assert.deepEqual(names(body), ["📚 Aide et réponses rapides", "₿ Bitcoin et pools", "🎫 Support", "🛡️ Modération"]);
    for (const c of commands) assert.ok(text(body).includes(`\`/${c.name}`), c.name);
    assert.match(text(body), /`\/warn membre raison` · Avertir un membre/);
    assert.match(text(body), /`\/pool adresse \[pool\] \[hôte\] \[public\]`/);
  });

  it("hides the commands a member cannot use, in their language", async () => {
    const { body } = await run(command("help", [], { perms: "0", locale: "en-US" }));
    assert.deepEqual(names(body), ["📚 Help and quick answers", "₿ Bitcoin and pools", "🎫 Support"]);
    assert.doesNotMatch(text(body), /\/warn|\/ticket-panel/);
    assert.match(text(body), /`\/odds hashrate \[public\]` · Your chance/);
    assert.match(text(body), /Open a ticket/);
  });
});

describe("tickets", () => {
  function click(custom_id, { user = { id: "100", username: "alice" }, perms = "0", channel = "60" } = {}) {
    return { type: 3, token: "tok", guild_id: "1", channel_id: channel, locale: "fr", member: { user, permissions: perms }, data: { custom_id, component_type: 2 } };
  }

  it("opens one private thread per member, with the moderators", async () => {
    route("GET", /\/guilds\/1\/roles$/, [{ id: "9", name: "🛠️ Modérateur" }]);
    route("GET", /\/guilds\/1\/channels$/, [{ id: "77", type: 0, name: "🔒-modération" }]);
    route("POST", /\/channels\/60\/threads$/, { id: "500" });
    route("PUT", /thread-members\/100$/, null);
    route("POST", /\/channels\/(500|77)\/messages$/, { id: "m" });
    route("GET", /\/channels\/500$/, { id: "500", thread_metadata: { archived: false } });
    route("PATCH", /@original/, null);
    const first = await run(click("ticket:open"));
    assert.deepEqual(first.body, { type: 5, data: { flags: 64 } });
    assert.equal(calls.find((c) => c.url.endsWith("/threads")).body.type, 12);
    const welcome = calls.find((c) => c.url.endsWith("/channels/500/messages")).body;
    assert.equal(welcome.content, "<@100> <@&9>");
    assert.deepEqual(welcome.allowed_mentions, { users: ["100"], roles: ["9"] });
    assert.equal(welcome.components[0].components[0].custom_id, "ticket:close:100");
    assert.equal(await env.BOT_KV.get("ticket:1:100"), "500");

    calls = [];
    const again = await run(click("ticket:open"));
    assert.match(again.follow.content, /déjà un ticket ouvert : <#500>/);
    assert.ok(!calls.some((c) => c.url.endsWith("/threads")));
  });

  it("lets only the member or the team close it, then locks the thread", async () => {
    await env.BOT_KV.put("ticket:1:100", "500");
    const stranger = await run(click("ticket:close:100", { user: { id: "300", username: "bob" }, channel: "500" }));
    assert.equal(stranger.body.data.flags, 64);
    assert.equal(calls.length, 0);

    route("PATCH", /\/channels\/500$/, {});
    const owner = await run(click("ticket:close:100", { channel: "500" }));
    assert.match(owner.body.data.content, /Ticket fermé/);
    assert.deepEqual(calls.find((c) => c.url.endsWith("/channels/500")).body, { archived: true, locked: true });
    assert.equal(await env.BOT_KV.get("ticket:1:100"), null);
  });
});

describe("releases", () => {
  const NOTES = "## What's new\n\nA long\nwrapped line.\n- an item\n  continued\n- see [notes](../hardware/x.md)";
  const feed = (tag) => `<?xml version="1.0"?><feed><title>Release notes</title><entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id><updated>2026-10-30T13:40:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/bdlglua/BDLMinerV1/releases/tag/${tag}"/>
    <title>BDLMiner V1 ${tag.slice(1)} &amp; more</title><content type="html">&lt;p&gt;x&lt;/p&gt;</content></entry>
    <entry><link href="https://github.com/bdlglua/BDLMinerV1/releases/tag/v0.0.1"/></entry></feed>`;
  const text = (s) => () => new Response(s);

  it("turns GitHub release notes into Discord text", () => {
    assert.equal(notes(NOTES, "v1.8.0"),
      "**What's new**\n\nA long wrapped line.\n- an item continued\n- see [notes](https://github.com/bdlglua/BDLMinerV1/blob/v1.8.0/docs/hardware/x.md)");
    assert.equal(notes("[a](https://x.org/y) [b](#c) <!-- hidden -->", "v1"), "[a](https://x.org/y) [b](#c)");
    const long = notes("para one\n\n" + "x".repeat(50) + "\n\npara three", "v1", 70);
    assert.equal(long, `para one\n\n${"x".repeat(50)}\n\n…`);
  });

  it("reads the newest release from GitHub's feed", () => {
    assert.deepEqual(parseFeed(feed("v1.8.0")), {
      tag_name: "v1.8.0", name: "BDLMiner V1 1.8.0 & more", published_at: "2026-10-30T13:40:00Z",
      html_url: "https://github.com/bdlglua/BDLMinerV1/releases/tag/v1.8.0",
    });
    assert.equal(parseFeed("<feed></feed>"), null);
  });

  it("/release shows the latest in the member's language, fetching its notes once", async () => {
    let notesServed = 0;
    route("GET", /github\.com\/bdlglua\/BDLMinerV1\/releases\.atom$/, text(feed("v1.8.0")));
    route("GET", /raw\.githubusercontent\.com\/bdlglua\/BDLMinerV1\/v1\.8\.0\/docs\/releases\/v1\.8\.0\.md$/, () => (notesServed++, new Response(NOTES)));
    route("GET", /raw\.githubusercontent\.com\/bdlglua\/BDLMinerV1\/main\/docs\/releases\/v1\.8\.0\.fr\.md$/, text("## Nouveautés\n\nTexte."));
    route("PATCH", /@original/, null);
    const first = await run(command("release"));
    assert.deepEqual(first.body, { type: 5, data: { flags: 0 } });
    assert.equal(first.follow.embeds[0].title, "🚀 BDLMiner V1 1.8.0 & more");
    assert.equal(first.follow.embeds[0].description, "**Nouveautés**\n\nTexte.");
    assert.match(first.follow.embeds[0].fields[0].value, /installateur web/);
    calls = [];
    const second = await run(command("release", [], { locale: "en-US" }));
    assert.equal(notesServed, 1);
    assert.match(second.follow.embeds[0].description, /^\*\*What's new\*\*/);
    assert.match(second.follow.embeds[0].fields[0].value, /web flasher/);
  });

  it("/release is all in English while the notes have no translation, then picks it up", async () => {
    let translated = false;
    route("GET", /releases\.atom$/, text(feed("v1.8.0")));
    route("GET", /\/v1\.8\.0\/docs\/releases\/v1\.8\.0\.md$/, text(NOTES));
    route("GET", /\/main\/docs\/releases\/v1\.8\.0\.fr\.md$/, () => (translated ? new Response("Texte.") : new Response("", { status: 404 })));
    route("PATCH", /@original/, null);
    const embed = (await run(command("release"))).follow.embeds[0];
    assert.match(embed.description, /What's new/);
    assert.equal(embed.fields[0].name, "Install");
    translated = true;
    calls = [];
    assert.equal((await run(command("release"))).follow.embeds[0].description, "Texte.");
  });

  it("/release falls back on the last release seen when GitHub fails", async () => {
    await env.BOT_KV.put("release:latest", JSON.stringify({ tag_name: "v1.8.0", name: "BDLMiner V1 1.8.0", body: "x", html_url: "u" }));
    route("GET", /releases\.atom$/, () => new Response("busy", { status: 429 }));
    route("PATCH", /@original/, null);
    assert.equal((await run(command("release"))).follow.embeds[0].footer.text, "v1.8.0");
  });

  it("/release finds a given version, with or without notes, or says it does not exist", async () => {
    route("GET", /\/v1\.7\.2\/docs\/releases\/v1\.7\.2\.md$/, text(NOTES));
    route("GET", /github\.com\/bdlglua\/BDLMinerV1\/releases\/tag\/v1\.0\.9$/, text("<html>"));
    route("PATCH", /@original/, null);
    assert.equal((await run(command("release", [{ name: "version", value: "v1.7.2" }]))).follow.embeds[0].footer.text, "v1.7.2");
    calls = [];
    const old = (await run(command("release", [{ name: "version", value: "1.0.9" }]))).follow.embeds[0];
    assert.equal(old.description, undefined);
    assert.equal(old.url, "https://github.com/bdlglua/BDLMinerV1/releases/tag/v1.0.9");
    calls = [];
    assert.match((await run(command("release", [{ name: "version", value: "9.9.9" }]))).follow.content, /n'existe pas/);
    assert.equal((await run(command("release", [{ name: "version", value: "latest" }]))).body.data.flags, 64);
  });

  it("announces each new release once, in the releases channel, to the announcements role", async () => {
    env.DISCORD_GUILD_ID = "1";
    let tag = "v1.8.0";
    route("GET", /releases\.atom$/, () => new Response(feed(tag)));
    route("GET", /\.fr\.md$/, () => new Response(tag === "v1.9.0" ? "Notes en français." : "", { status: tag === "v1.9.0" ? 200 : 404 }));
    route("GET", /raw\.githubusercontent\.com/, text(NOTES));
    route("GET", /\/guilds\/1\/channels$/, [{ id: "80", type: 0, name: "🔔-releases-github" }, { id: "81", type: 0, name: "💬-discussion" }]);
    route("GET", /\/guilds\/1\/roles$/, [{ id: "7", name: "🔔 Annonces" }]);
    let fail = true;
    route("POST", /\/channels\/80\/messages$/, () => (fail ? new Response("down", { status: 500 }) : new Response("{}")));

    assert.equal(await announce(env), "recorded v1.8.0");  // first run: no old release reposted
    assert.equal(await announce(env), "up to date");
    tag = "v1.9.0";
    await assert.rejects(announce(env));  // Discord down: tried again next time
    fail = false;
    assert.equal(await announce(env), "posted v1.9.0");
    const post = calls.filter((c) => c.url.endsWith("/channels/80/messages")).at(-1).body;
    assert.equal(post.content, "<@&7> **BDLMiner V1 1.9.0 & more** est sortie !");
    assert.deepEqual(post.allowed_mentions, { roles: ["7"] });
    assert.equal(post.embeds[0].title, "🚀 BDLMiner V1 1.9.0 & more");
    assert.equal(post.embeds[0].description, "Notes en français.");
    assert.equal(post.embeds[0].fields[0].name, "Installer");
    assert.equal(await announce(env), "up to date");
  });
});
