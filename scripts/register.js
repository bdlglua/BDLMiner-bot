// Registers the slash commands on the server (guild commands appear at once).
// Reads DISCORD_TOKEN, DISCORD_APPLICATION_ID and DISCORD_GUILD_ID from the
// environment; `--dry-run` prints them without calling Discord.

import { commands } from "../src/index.js";

if (process.argv.includes("--dry-run")) {
  for (const c of commands) console.log(`/${c.name}  ${c.description}`);
  console.log(`${commands.length} commands`);
  process.exit(0);
}

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;
for (const [name, value] of Object.entries({ DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID }))
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }

const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`Discord ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`${(await res.json()).length} commands registered`);
