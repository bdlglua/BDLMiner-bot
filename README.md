# BDLMiner bot

The Discord bot of the [BDLMiner](https://github.com/bdlglua/BDLMinerV1) community
server: moderation, Bitcoin and pool statistics, ready answers and private support
tickets. It answers in French or English, following each member's Discord language.

It runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (free
plan) that receives Discord *interactions* over HTTPS: no server to keep running,
no gateway connection. Every push to `main` is tested and deployed by GitHub Actions.

## Commands

| Command | Who | What |
|---|---|---|
| `/warn` `/warnings` `/clearwarnings` | Moderators | Warnings kept per member, sent to them by DM and logged |
| `/timeout` | Moderators | Mute for 60 s to 1 week, or lift it |
| `/kick` `/ban` `/unban` | Moderators | With the reason in the server's audit log; `/ban` can delete recent messages |
| `/purge` | Moderators | Delete the last 1–100 messages of a channel, optionally of one member |
| `/slowmode` | Moderators | Slow mode of the channel |
| `/ticket-panel` | Admins | Posts the *Open a ticket* button in the channel |
| `/btc` | Everyone | Price, height, difficulty, network hashrate, next adjustment, fees (mempool.space) |
| `/pool` | Everyone | What a solo pool sees of an address: hashrate, best difficulty, shares, workers |
| `/odds` | Everyone | Chance of a block per day and year for a hashrate (`1M`, `350k`, `1.2 TH/s`) |
| `/help` | Everyone | The commands the member can use, by category |
| `/install` `/pools` `/faq` | Everyone | Ready answers, optionally mentioning a member |
| `/release` | Everyone | The latest BDLMiner V1 release notes, or those of a given version |

Moderation replies are only shown to the moderator; every action is logged in the
moderation channel (the text channel whose name contains *modération*) and the bot
refuses to act on staff unless an administrator asks. A ticket is a private thread
of the panel's channel with the member and the moderator role (the role whose name
contains *Modérat*); the member or a moderator closes it, which archives and locks it.

`/pool` finds the pool's statistics API the way the miner does: ckpool's
`/users/<address>` (or `/api/miner?address=`) and public-pool's `/api/client/<address>`,
on the pool's host and its parent domain.

Every 10 minutes the Worker checks [BDLMinerV1's releases](https://github.com/bdlglua/BDLMinerV1/releases)
and posts a new one in the releases channel (the channel whose name contains
*release*), mentioning the announcements role (*Annonces*). The first check after
installing the bot only records the current release. `RELEASE_CHANNEL_ID` replaces
the lookup by name.

Music is not possible here: a Worker cannot join voice channels.

## Setup

1. **Discord** ([Developer Portal](https://discord.com/developers/applications), the
   application of the bot): note the *Application ID* and the *Public Key* (General
   Information), and the bot *Token* (Bot → Reset Token). The token is a password:
   keep it out of chats and commits.
2. **Cloudflare** (free account): note the *Account ID* (Workers & Pages), and create an
   API token (My Profile → API Tokens → *Edit Cloudflare Workers* template).
3. **GitHub** (this repository → Settings → Secrets and variables → Actions):
   - secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_TOKEN`;
   - variables: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`
     (the server's id).
4. Run the **Test and deploy** workflow (Actions tab), or push to `main`. It creates the
   KV namespace `bdlminer-bot-kv` if needed, deploys the Worker, sets its token and
   registers the commands on the server.
5. In the Developer Portal, set **Interactions Endpoint URL** to the Worker's address,
   `https://bdlminer-bot.<your-subdomain>.workers.dev/` (Discord checks it on saving).
6. The bot needs these permissions on the server (its role above the members it
   moderates): View Channels, Send Messages, Send Messages in Threads, Embed Links,
   Read Message History, Manage Messages, Manage Channels, Manage Threads, Create
   Private Threads, Kick, Ban, Moderate Members. Invite link with exactly those:
   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=1460288973846`
7. Post the ticket panel with `/ticket-panel` in a text channel where members can
   read but need not write (they need *Send Messages in Threads*).

Optional Worker variables `MOD_LOG_CHANNEL_ID` and `MOD_ROLE_ID` replace the lookups by name.

## Development

```sh
npm test                 # unit tests (Node 20+), Discord and the APIs are faked
npm run commands         # list the commands as they will be registered
```

To try it for real, `npx wrangler dev` with `DISCORD_PUBLIC_KEY=…` in `.dev.vars`
(ignored by git) and a tunnel as the Interactions Endpoint URL.

## License

[GNU GPL v3.0](LICENSE), like BDLMiner V1.
