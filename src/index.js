// BDLMiner Discord bot: a Cloudflare Worker answering Discord interactions
// (slash commands and buttons) over HTTPS, with no gateway connection.

import { COMMAND, COMPONENT, DEFERRED, EPHEMERAL, followUp, json, MESSAGE, PING, PONG, verify } from "./discord.js";
import { say } from "./util.js";
import * as answers from "./commands/answers.js";
import * as moderation from "./commands/moderation.js";
import * as stats from "./commands/stats.js";
import * as tickets from "./commands/tickets.js";

const MODULES = [moderation, stats, answers, tickets];

export const commands = MODULES.flatMap((m) => m.definitions).map((c) => ({ type: 1, contexts: [0], ...c }));

export default {
  async fetch(request, env, ctx) {
    if (request.method === "GET") return new Response("BDLMiner bot: OK\n");
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const body = await request.text();
    if (!(await verify(request, body, env.DISCORD_PUBLIC_KEY))) return new Response("Bad signature", { status: 401 });
    const interaction = JSON.parse(body);

    if (interaction.type === PING) return json({ type: PONG });
    let result;
    if (interaction.type === COMMAND) {
      const module = MODULES.find((m) => m.handles(interaction.data.name));
      result = module ? module.handle(interaction, env) : { content: "?", ephemeral: true };
    } else if (interaction.type === COMPONENT && tickets.handlesComponent(interaction.data.custom_id)) {
      result = tickets.handleComponent(interaction, env);
    } else {
      return new Response("Unknown interaction", { status: 400 });
    }
    return respond(interaction, env, ctx, result);
  },
};

// A result is a message ({content, embeds, components, ephemeral}), or
// {defer, ephemeral, run} for work that may take more than Discord's 3 s:
// "thinking…" is shown at once and replaced by what run() returns.
function respond(interaction, env, ctx, result) {
  if (result.defer) {
    ctx.waitUntil(finish(interaction, env, result.run));
    return json({ type: DEFERRED, data: { flags: result.ephemeral ? EPHEMERAL : 0 } });
  }
  if (result.after) ctx.waitUntil(result.after().catch((e) => console.error(e)));
  return json({ type: MESSAGE, data: message(result) });
}

function message(result) {
  const { content, embeds, components, ephemeral, allowed_mentions } = result;
  return { content, embeds, components, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: allowed_mentions ?? { parse: [] } };
}

async function finish(interaction, env, run) {
  let data;
  try {
    const out = await run();
    data = typeof out === "string" ? { content: out } : out;
  } catch (e) {
    console.error(e);
    data = { content: say(interaction, `❌ Échec : ${String(e.message ?? e).slice(0, 300)}`, `❌ Failed: ${String(e.message ?? e).slice(0, 300)}`) };
  }
  await followUp(env, interaction, data);
}
