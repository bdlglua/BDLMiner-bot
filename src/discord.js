// Discord plumbing: request signatures, REST calls and interaction responses.

export const API = "https://discord.com/api/v10";

// Interaction and response types used here.
export const PING = 1, COMMAND = 2, COMPONENT = 3;
export const PONG = 1, MESSAGE = 4, DEFERRED = 5;
export const EPHEMERAL = 64;

// Permission bits checked again on our side (Discord already hides the commands).
export const PERM = {
  KICK: 1n << 1n, BAN: 1n << 2n, ADMIN: 1n << 3n, MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n, MODERATE: 1n << 40n,
};

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Discord signs every interaction (Ed25519 over timestamp + body). Anything
// that does not verify is refused: the endpoint URL is public.
export async function verify(request, body, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

export function has(interaction, bit) {
  const perms = BigInt(interaction.member?.permissions ?? "0");
  return (perms & PERM.ADMIN) !== 0n || (perms & bit) !== 0n;
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

export function reply(content, { ephemeral = false, embeds, components } = {}) {
  return json({ type: MESSAGE, data: { content, embeds, components, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
}

export class DiscordError extends Error {
  constructor(status, body) {
    super(`Discord ${status}: ${body}`);
    this.status = status;
  }
}

// Bot-authenticated REST call. `reason` shows in the server's audit log.
export async function rest(env, method, path, body, reason) {
  const headers = { Authorization: `Bot ${env.DISCORD_TOKEN}`, "User-Agent": "DiscordBot (https://github.com/bdlglua/BDLMiner-bot, 1.0)" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason.slice(0, 400));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new DiscordError(res.status, text);
    return text ? JSON.parse(text) : null;
  }
  throw new DiscordError(429, "rate limited");
}

// Replaces the "thinking…" of a deferred response.
export async function followUp(env, interaction, data) {
  await fetch(`${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  });
}

export function option(interaction, name) {
  return interaction.data?.options?.find((o) => o.name === name)?.value;
}
