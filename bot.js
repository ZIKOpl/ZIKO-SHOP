// bot.js (COMPLET) --------------------------------------------------------

/**
 * Fonctionnalités :
 * - API: /stock.json, /prices.json, /order (option : x-api-key)
 * - Stock & prices persistés dans stock.json / prices.json
 * - Création de ticket Discord pour chaque commande
 * - Embed "stock" auto-updaté dans STOCK_CHANNEL_ID (rouge + images)
 * - Panel Admin dans ADMIN_CHANNEL_ID : select menu -> modal -> maj stock/prix
 * - CORS autorisé pour NETLIFY_ORIGIN
 *
 * Variables d'environnement recommandées :
 * DISCORD_TOKEN, GUILD_ID, STAFF_ROLE_ID, CATEGORY_ID,
 * STOCK_CHANNEL_ID, ADMIN_CHANNEL_ID, ORDERS_CHANNEL_ID,
 * API_SECRET (optionnel), NETLIFY_ORIGIN
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// discord.js imports (v14)
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType
} = require("discord.js");

// ---- Config / env ----
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const STOCK_CHANNEL_ID = process.env.STOCK_CHANNEL_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID || null;
const API_SECRET = process.env.API_SECRET || null;
const NETLIFY_ORIGIN = process.env.NETLIFY_ORIGIN || "https://zikoshop.netlify.app";
const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN || !GUILD_ID || !STAFF_ROLE_ID || !CATEGORY_ID || !STOCK_CHANNEL_ID || !ADMIN_CHANNEL_ID) {
  console.error("❌ Variables d'environnement manquantes. Vérifie DISCORD_TOKEN, GUILD_ID, STAFF_ROLE_ID, CATEGORY_ID, STOCK_CHANNEL_ID, ADMIN_CHANNEL_ID");
  process.exit(1);
}

// ---- Files ----
const STOCK_FILE = path.join(__dirname, "stock.json");
const PRICES_FILE = path.join(__dirname, "prices.json");

// If missing, create defaults
if (!fs.existsSync(STOCK_FILE)) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify({
    nitro1m: 10,
    nitro1y: 5,
    boost1m: 8,
    boost1y: 3
  }, null, 2));
}
if (!fs.existsSync(PRICES_FILE)) {
  fs.writeFileSync(PRICES_FILE, JSON.stringify({
    nitro1m: 1.5,
    nitro1y: 10,
    boost1m: 3.5,
    boost1y: 30
  }, null, 2));
}

// ---- Helpers stock/prices ----
function getStock() {
  try {
    return JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
  } catch (e) {
    console.error("Erreur lecture stock.json", e);
    return {};
  }
}
function saveStock(stock) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

function getPrices() {
  try {
    return JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
  } catch (e) {
    console.error("Erreur lecture prices.json", e);
    return {};
  }
}
function savePrices(prices) {
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices, null, 2), "utf8");
}

// ---- Product metadata (pour images & noms lisibles) ----
const PRODUCTS = {
  nitro1m: { name: "Nitro 1 mois", img: "https://zikoshop.netlify.app/Assets/nitro.png" },
  nitro1y: { name: "Nitro 1 an", img: "https://zikoshop.netlify.app/Assets/nitro.png" },
  boost1m: { name: "Nitro Boost 1 mois", img: "https://zikoshop.netlify.app/Assets/nitroboost.png" },
  boost1y: { name: "Nitro Boost 1 an", img: "https://zikoshop.netlify.app/Assets/nitroboost.png" }
};

// ---- Express API ----
const app = express();
app.use(bodyParser.json());
// Autoriser uniquement ton frontend (cross origin)
app.use(cors({ origin: NETLIFY_ORIGIN }));

// Route statique pour le stock (site)
app.get("/stock.json", (req, res) => {
  res.json(getStock());
});
app.get("/prices.json", (req, res) => {
  res.json(getPrices());
});

// POST /order (le site appelle cette route)
// Si tu as défini API_SECRET, la requête doit fournir header 'x-api-key' correspondant
app.post("/order", (req, res) => {
  if (API_SECRET) {
    const key = req.headers["x-api-key"];
    if (!key || key !== API_SECRET) return res.status(403).send("Clé API invalide");
  }

  const { username, discordId, cart } = req.body;
  if (!cart || !Array.isArray(cart) || cart.length === 0) return res.status(400).send("Panier vide");

  const stock = getStock();
  // vérif
  for (const it of cart) {
    if (!stock[it.productId] || stock[it.productId] < it.qty) {
      return res.status(400).send(`Stock insuffisant pour ${it.name}`);
    }
  }
  // décrémente
  cart.forEach(it => stock[it.productId] -= it.qty);
  saveStock(stock);

  // envoi notification au bot (via channel orders) - fait asynchrone
  (async () => {
    try {
      if (ORDERS_CHANNEL_ID) {
        const ch = await client.channels.fetch(ORDERS_CHANNEL_ID).catch(() => null);
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("🛒 Nouvelle commande")
            .setColor(0xff0000)
            .setDescription(`Commande de ${username} (${discordId})`)
            .addFields(
              ...cart.map(c => ({ name: PRODUCTS[c.productId]?.name || c.name, value: `Quantité: ${c.qty} — Total: ${c.price * c.qty}€`, inline: false })),
              { name: "Total", value: `**${cart.reduce((a, c) => a + c.price * c.qty, 0)}€**` }
            )
            .setTimestamp();
          ch.send({ embeds: [embed] });
        }
      }
    } catch (e) {
      console.error("Erreur notify orders:", e);
    }
  })();

  // On met aussi à jour l'embed de stock côté Discord (async)
  updateStockEmbed().catch(()=>{});

  res.send("Commande traitée");
});

// ---- Discord bot ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// IDs & storage of messages
let stockMessageId = null;
let adminMessageId = null;

// create or edit embed stock
async function updateStockEmbed() {
  const stock = getStock();
  const prices = getPrices();

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);
    if (!channel) throw new Error("Stock channel introuvable");

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel des produits")
      .setColor(0xff0000)
      .setDescription("Produits disponibles (prix + stock)")
      .setTimestamp()
      .setFooter({ text: "ZIKO SHOP" });

    // add product fields with images as small thumbnails via embed fields and setThumbnail once per embed (can't per-field),
    // We'll add values and set first product as thumbnail for visibility.
    let firstImage = null;
    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      if (!firstImage) firstImage = p.img;
      embed.addFields({
        name: p.name,
        value: `Prix : **${prices[key] ?? "N/A"}€**\nStock : **${stock[key] ?? 0}**`,
        inline: true
      });
    }
    if (firstImage) embed.setThumbnail(firstImage);

    if (stockMessageId) {
      const msg = await channel.messages.fetch(stockMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
      // if not found, continue to send new
    }
    const newMsg = await channel.send({ embeds: [embed] });
    stockMessageId = newMsg.id;
  } catch (err) {
    console.error("Erreur updateStockEmbed:", err);
  }
}

// Create admin panel message (select menu) in ADMIN_CHANNEL_ID
async function ensureAdminPanel() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);
    if (!channel) throw new Error("Admin channel introuvable");

    // build select options: for each product, three options: add/remove/setprice (encoded in value)
    const options = [];
    for (const key of Object.keys(PRODUCTS)) {
      options.push({
        label: `${PRODUCTS[key].name} — Ajouter`,
        value: `add_${key}`
      });
      options.push({
        label: `${PRODUCTS[key].name} — Retirer`,
        value: `remove_${key}`
      });
      options.push({
        label: `${PRODUCTS[key].name} — Modifier prix`,
        value: `price_${key}`
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("admin_select_action")
      .setPlaceholder("Choisis une action (ajouter, retirer, ou changer le prix)")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setTitle("🔧 Panel Admin — Gestion Stock & Prix")
      .setColor(0xff0000)
      .setDescription("Sélectionne l'action à effectuer. Un formulaire te sera ouvert pour entrer la quantité / le prix.")
      .setTimestamp();

    // If adminMessageId exists try to edit, otherwise send new and save id.
    if (adminMessageId) {
      const existing = await channel.messages.fetch(adminMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components: [row] });
        return;
      }
    }

    const m = await channel.send({ embeds: [embed], components: [row] });
    adminMessageId = m.id;
  } catch (err) {
    console.error("Erreur ensureAdminPanel:", err);
  }
}

// ---- Interaction handlers: select menu + modal submit + button ----
client.on("interactionCreate", async (interaction) => {
  try {
    // Button close_ticket
    if (interaction.isButton()) {
      if (interaction.customId === "close_ticket") {
        await interaction.reply({ content: "Ticket fermé.", ephemeral: true });
        await interaction.channel.delete().catch(()=>{});
      }
      return;
    }

    // Select menu admin action
    if (interaction.isStringSelectMenu() && interaction.customId === "admin_select_action") {
      // single selection expected
      const value = interaction.values[0]; // e.g. "add_nitro1m" or "price_boost1y"
      const [action, productId] = value.split("_"); // action: add/remove/price

      // show modal to input number (quantity or price)
      const modal = new ModalBuilder()
        .setCustomId(`admin_modal_${action}_${productId}`)
        .setTitle(`${action === "price" ? "Changer le prix" : (action === "add" ? "Ajouter au stock" : "Retirer du stock")} — ${PRODUCTS[productId]?.name || productId}`);

      const input = new TextInputBuilder()
        .setCustomId("value_input")
        .setLabel(action === "price" ? "Nouveau prix (ex: 3.50)" : "Quantité (entier)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(action === "price" ? "Ex: 3.50" : "Ex: 1");

      // Put in one row
      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // Modal submit (admin)
    if (interaction.type === InteractionType.ModalSubmit) {
      const id = interaction.customId; // ex admin_modal_add_nitro1m
      if (!id.startsWith("admin_modal_")) return;
      const [, action, productId] = id.split("_");
      const value = interaction.fields.getTextInputValue("value_input").trim();

      // permission check: ensure user has staff role in guild
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        await interaction.reply({ content: "Erreur : impossible de vérifier les permissions.", ephemeral: true });
        return;
      }
      if (!member.roles.cache.has(STAFF_ROLE_ID) && !member.permissions.has("ManageGuild")) {
        await interaction.reply({ content: "Tu n'as pas la permission d'utiliser ce panel.", ephemeral: true });
        return;
      }

      // parse
      if (action === "price") {
        const num = parseFloat(value.replace(",", "."));
        if (isNaN(num) || num < 0) {
          await interaction.reply({ content: "Valeur de prix invalide.", ephemeral: true });
          return;
        }
        const prices = getPrices();
        prices[productId] = num;
        savePrices(prices);
        await interaction.reply({ content: `Prix de ${PRODUCTS[productId].name} mis à **${num}€**.`, ephemeral: true });
        await updateStockEmbed();
        return;
      } else if (action === "add" || action === "remove") {
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty <= 0) {
          await interaction.reply({ content: "Quantité invalide.", ephemeral: true });
          return;
        }
        const stock = getStock();
        stock[productId] = (stock[productId] || 0) + (action === "add" ? qty : -qty);
        if (stock[productId] < 0) stock[productId] = 0;
        saveStock(stock);
        await interaction.reply({ content: `${action === "add" ? "Ajouté" : "Retiré"} ${qty} sur ${PRODUCTS[productId].name}. Nouveau stock : ${stock[productId]}`, ephemeral: true });
        await updateStockEmbed();
        return;
      } else {
        await interaction.reply({ content: "Action inconnue.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Erreur interactionCreate:", err);
    if (interaction.replied || interaction.deferred) {
      try { await interaction.followUp({ content: "Erreur interne.", ephemeral: true }); } catch(e) {}
    } else {
      try { await interaction.reply({ content: "Erreur interne.", ephemeral: true }); } catch(e) {}
    }
  }
});

// ---- Utility: when ready create/update admin panel & stock embed ----
client.once("ready", async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  // initial update
  await updateStockEmbed();
  await ensureAdminPanel();

  // periodic update
  setInterval(async () => {
    await updateStockEmbed();
    await ensureAdminPanel();
  }, 10 * 1000);
});

// ---- Start express + login bot ----
app.listen(PORT, () => {
  console.log(`API en ligne sur port ${PORT}`);
});
client.login(DISCORD_TOKEN).catch(err => {
  console.error("Erreur login Discord:", err);
  process.exit(1);
});
