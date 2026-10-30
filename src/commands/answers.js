// Ready answers to the questions that come back often, from the README of
// BDLMinerV1. Posted publicly so a helper can answer someone in one command.

import { option } from "../discord.js";
import { lang } from "../util.js";

const REPO = "https://github.com/bdlglua/BDLMinerV1";
const INSTALLER = "https://bdlglua.github.io/BDLMinerV1/";
const ORANGE = 0xf7931a;

const INSTALL = {
  fr: {
    title: "📲 Installer BDLMiner V1",
    description: [
      `1. Ouvre **${INSTALLER}** dans **Chrome ou Edge** sur un ordinateur.`,
      "2. Branche la carte avec un câble USB **de données** (pas seulement de charge).",
      "3. Choisis ta carte dans la liste et clique sur **Installer** (la première installation efface la carte).",
      "4. Au démarrage, connecte-toi au Wi-Fi **`BDLMinerV1-XXXX`**, mot de passe **`MineYourCoins`** (les cartes avec écran affichent un QR code).",
      "5. Ouvre **http://192.168.4.1**, choisis ton Wi-Fi, ta pool et ton **adresse Bitcoin**, puis enregistre.",
      "",
      "Ensuite, le tableau de bord est sur **http://bdlminer-xxxx.local** ou l'adresse IP affichée sur l'écran Réseau. Les mises à jour arrivent toutes seules depuis GitHub.",
    ].join("\n"),
  },
  en: {
    title: "📲 Install BDLMiner V1",
    description: [
      `1. Open **${INSTALLER}** in **Chrome or Edge** on a computer.`,
      "2. Plug the board in with a **data** USB cable (not a charge-only one).",
      "3. Pick your board in the list and click **Install** (the first install erases the board).",
      "4. At boot, join the WiFi **`BDLMinerV1-XXXX`**, password **`MineYourCoins`** (boards with a screen show a QR code).",
      "5. Open **http://192.168.4.1**, pick your WiFi, your pool and your **Bitcoin address**, then save.",
      "",
      "The dashboard is then at **http://bdlminer-xxxx.local** or the IP shown on the Network screen. Updates come by themselves from GitHub.",
    ].join("\n"),
  },
};

const POOLS = {
  fr: {
    title: "⚙️ Pools pour ESP32",
    description: [
      "Ce sont des pools **solo** : les shares acceptées montrent ton travail, un gain demande de trouver un bloc entier.",
      "",
      "• **pool.nerdminers.org** : `3333`, V1. Adresse `TON_ADRESSE.worker1`. Accepte une faible difficulté : le worker reste affiché.",
      "• **pool.nerdminer.io** : `3333`, V1. Difficulté adaptée aux petits miners ; ton adresse Bitcoin comme worker.",
      "• **public-pool.io** : `3333` en V1, `23330` en V2 (avec la clé d'autorité). Impose une difficulté de 1 : environ une share par heure à 1 MH/s.",
      "",
      "Mot de passe : `x`. Agent utilisateur : Automatique. `/pool` montre ce qu'une pool voit de ton adresse.",
    ].join("\n"),
  },
  en: {
    title: "⚙️ Pools for ESP32",
    description: [
      "These are **solo** pools: accepted shares show your work; a payout needs a whole block.",
      "",
      "• **pool.nerdminers.org**: `3333`, V1. Address `YOUR_ADDRESS.worker1`. Honours a low difficulty: the worker stays listed.",
      "• **pool.nerdminer.io**: `3333`, V1. Difficulty adapted to small miners; your Bitcoin address as the worker.",
      "• **public-pool.io**: `3333` for V1, `23330` for V2 (with the authority key). Imposes difficulty 1: about one share an hour at 1 MH/s.",
      "",
      "Password: `x`. User agent: Automatic. `/pool` shows what a pool sees of your address.",
    ].join("\n"),
  },
};

const FAQ = {
  worker: {
    label: ["Worker absent or offline on the pool", "Worker absent ou hors ligne sur la pool"],
    fr: "**Le worker n'apparaît pas, ou « Offline » ?** Les pools calculent l'état en ligne à partir du hashrate des dernières minutes. public-pool impose une difficulté de 1 et ignore la difficulté suggérée : à 1 MH/s, une share toutes les 70 minutes environ, donc le worker n'apparaît que brièvement après chacune. La pool compte quand même tes shares. pool.nerdminers.org accepte une faible difficulté et garde le worker affiché. Pour lui donner un nom : `adresse.nom`.",
    en: "**Worker missing, or \"Offline\"?** Pools derive the online state from the hashrate of the last minutes. public-pool imposes difficulty 1 and ignores the suggested difficulty: at 1 MH/s that is a share about every 70 minutes, so the worker only shows briefly after each one. The pool still counts your shares. pool.nerdminers.org honours a low difficulty and keeps the worker listed. To name it: `address.name`.",
  },
  shares: {
    label: ["Accepted shares stay at zero", "Les shares acceptées restent à zéro"],
    fr: "**Shares acceptées à zéro ?** Elles dépendent de la difficulté imposée par la pool (*pool diff* sur le tableau de bord). Temps moyen par share = `difficulté × 2^32 / hashrate` : à 1 MH/s, 4,3 s à 0,001, environ 1 h 12 à 1. Si le hashrate s'affiche, le miner travaille. Regarde aussi l'état de la connexion et le journal d'activité.",
    en: "**Accepted shares at zero?** They depend on the difficulty the pool assigns (*pool diff* on the dashboard). Average time per share = `difficulty × 2^32 / hashrate`: at 1 MH/s, 4.3 s at 0.001, about 1 h 12 at 1. If the hashrate shows, the miner is working. Check the connection status and the activity log too.",
  },
  odds: {
    label: ["Can I really find a block?", "Puis-je vraiment trouver un bloc ?"],
    fr: "**Trouver un bloc ?** Oui, c'est possible, mais c'est une loterie : chaque hash a la même chance, sans progression. À 1 MH/s, il faut en moyenne des milliards d'années. `/odds 1M` calcule tes chances avec la difficulté du moment.",
    en: "**Finding a block?** Yes, it is possible, but it is a lottery: every hash has the same chance, with no progress. At 1 MH/s it takes billions of years on average. `/odds 1M` works out your chances at the current difficulty.",
  },
  update: {
    label: ["Updates and the trial period", "Mises à jour et période d'essai"],
    fr: "**Mises à jour :** le miner vérifie GitHub 30 s après le démarrage puis toutes les heures, et installe seul toute version plus récente **signée** (réglage *Mises à jour depuis GitHub* = `2`). Une nouvelle version est d'abord **à l'essai** : elle est confirmée après 3 minutes connectée à la pool en minant. Si elle plante, le miner revient à la version précédente ; après 2 échecs, cette version est refusée. Une coupure de courant ou un reset ne compte pas comme échec.",
    en: "**Updates:** the miner checks GitHub 30 s after boot and then hourly, and installs any newer **signed** release by itself (setting *Updates from GitHub* = `2`). A new version first runs **on trial**: it is confirmed after 3 minutes connected to the pool and hashing. If it crashes, the miner goes back to the previous version; after 2 failures that version is refused. A power cut or a reset does not count as a failure.",
  },
  dashboard: {
    label: ["Finding the web dashboard", "Trouver le tableau de bord web"],
    fr: "**Tableau de bord :** ouvre **http://bdlminer-xxxx.local** (le nom est sur l'écran Réseau). Si le `.local` ne marche pas (certains réseaux, anciens Android), utilise l'adresse IP affichée sur l'écran Réseau ou dans le moniteur série (115200 bauds).",
    en: "**Dashboard:** open **http://bdlminer-xxxx.local** (the name is on the Network screen). If `.local` does not resolve (some networks, older Android), use the IP shown on the Network screen or in the serial monitor (115200 baud).",
  },
  portal: {
    label: ["Can't find the setup WiFi", "Le Wi-Fi de configuration n'apparaît pas"],
    fr: "**Pas de réseau `BDLMinerV1-XXXX` ?** Le portail se ferme après 3 minutes et la carte redémarre : attends qu'il réapparaisse, ou maintiens le bouton principal pendant le démarrage. Mot de passe : `MineYourCoins`, puis http://192.168.4.1.",
    en: "**No `BDLMinerV1-XXXX` network?** The portal closes after 3 minutes and the board restarts: wait for it to come back, or hold the main button during boot. Password: `MineYourCoins`, then http://192.168.4.1.",
  },
  pool: {
    label: ["Pool unreachable / auth failed", "Pool injoignable / authentification refusée"],
    fr: "**`Pool unreachable` ou `Pool silent` :** vérifie l'hôte, le port et le protocole : un port V1 et un port V2 ne sont pas interchangeables. **`Auth failed: check address` :** la pool refuse le nom d'utilisateur, corrige l'adresse Bitcoin dans les réglages.",
    en: "**`Pool unreachable` or `Pool silent`:** check the host, the port and the protocol: a V1 port and a V2 port are not interchangeable. **`Auth failed: check address`:** the pool refuses the user name; fix the Bitcoin address in the settings.",
  },
  bug: {
    label: ["Reporting a bug", "Signaler un bug"],
    fr: `**Un bug ?** Ouvre une issue sur ${REPO}/issues/new/choose avec ta carte, la version du firmware et le journal d'activité (page Journal du tableau de bord). Une faille de sécurité se signale en privé : ${REPO}/security/advisories/new`,
    en: `**A bug?** Open an issue at ${REPO}/issues/new/choose with your board, the firmware version and the activity log (Log page of the dashboard). Report security issues privately: ${REPO}/security/advisories/new`,
  },
};

const target = {
  type: 6, name: "for", description: "Mention this member in the answer",
  name_localizations: { fr: "pour" }, description_localizations: { fr: "Mentionner ce membre dans la réponse" },
};

export const definitions = [
  {
    name: "install", description: "How to install BDLMiner V1",
    description_localizations: { fr: "Comment installer BDLMiner V1" }, options: [target],
  },
  {
    name: "pools", description: "Which pool to choose for an ESP32",
    description_localizations: { fr: "Quelle pool choisir pour un ESP32" }, options: [target],
  },
  {
    name: "faq", description: "Answer a frequent question",
    description_localizations: { fr: "Répondre à une question fréquente" },
    options: [{
      type: 3, name: "topic", description: "The question", required: true,
      name_localizations: { fr: "sujet" }, description_localizations: { fr: "La question" },
      choices: Object.entries(FAQ).map(([value, f]) => ({ name: f.label[0], name_localizations: { fr: f.label[1] }, value })),
    }, target],
  },
];

export function handles(name) {
  return name === "install" || name === "pools" || name === "faq";
}

export function handle(interaction) {
  const l = lang(interaction);
  const name = interaction.data.name;
  const who = option(interaction, "for");
  const mention = who ? { content: `<@${who}>`, allowed_mentions: { users: [who] } } : {};
  if (name === "faq") {
    const entry = FAQ[option(interaction, "topic")];
    if (!entry) return { content: "?", ephemeral: true };
    return { ...mention, embeds: [{ color: ORANGE, description: entry[l] }] };
  }
  const page = (name === "install" ? INSTALL : POOLS)[l];
  return { ...mention, embeds: [{ color: ORANGE, url: name === "install" ? INSTALLER : `${REPO}#pools-for-esp32`, ...page }] };
}
