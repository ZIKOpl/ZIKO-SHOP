// === Modules ===
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

// === Express App ===
const app = express();
app.use(cors());
app.use(bodyParser.json());

// === CONFIG (met ça dans Render > Environment) ===
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const STOCK_CHANNEL_ID = process.env.STOCK_CHANNEL_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID; // salon panel admin
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID; // logs commandes

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// === Stock & Prix ===
const STOCK_FILE = path.join(__dirname, "stock.json");
const PRICES_FILE = path.join(__dirname, "prices.json");

// === Discord Bot ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// === Gestion Stock ===
function getStock() {
  if (!fs.existsSync(STOCK_FILE)) return {};
  return JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
}

function saveStock(stock) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

function getPrices() {
  if (!fs.existsSync(PRICES_FILE)) {
    const defaultPrices = { nitro1m: 1.5, nitro1y: 10, boost1m: 3.5, boost1y: 30 };
    fs.writeFileSync(PRICES_FILE, JSON.stringify(defaultPrices, null, 2));
    return defaultPrices;
  }
  return JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
}

function savePrices(prices) {
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices, null, 2), "utf8");
}

// === Fonction update Stock Embed ===
let stockMessageId = null;

async function updateStockEmbed() {
  const stock = getStock();
  const prices = getPrices();

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel des produits")
      .setColor("Red")
      .setFooter({ text: "ZIKO SHOP - Stock mis à jour automatiquement" })
      .setTimestamp();

    const produits = {
      nitro1m: "Nitro 1 mois",
      nitro1y: "Nitro 1 an",
      boost1m: "Nitro Boost 1 mois",
      boost1y: "Nitro Boost 1 an"
    };

    for (const [key, name] of Object.entries(produits)) {
      embed.addFields({
        name,
        value: `Prix : **${prices[key]}€**\nStock : **${stock[key] || 0}**`,
        inline: true
      });
    }

    if (stockMessageId) {
      const msg = await channel.messages.fetch(stockMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    }
    const newMsg = await channel.send({ embeds: [embed] });
    stockMessageId = newMsg.id;

  } catch (err) {
    console.error("Erreur update stock embed:", err);
  }
}

// === API Routes ===

// --- stock.json pour le site
app.get("/stock.json", (req, res) => {
  res.json(getStock());
});

// --- prices.json pour le site
app.get("/prices.json", (req, res) => {
  res.json(getPrices());
});

// --- OAuth2 callback
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("Code manquant");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        scope: "identify"
      })
    });
    const tokenData = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();

    res.send(`
      <h1>Connecté en tant que ${user.username}#${user.discriminator}</h1>
      <script>
        localStorage.setItem("discordUser", '${JSON.stringify(user)}');
        window.location.href = "/shop.html";
      </script>
    `);
  } catch (err) {
    console.error("Erreur OAuth2:", err);
    res.send("Erreur OAuth2");
  }
});

// --- passer commande
app.post("/order", async (req, res) => {
  const { discordId, username, cart } = req.body;
  if (!cart || cart.length === 0) return res.status(400).send("Panier vide");

  let stock = getStock();
  let prices = getPrices();

  // Vérifier stock
  for (const item of cart) {
    if (!stock[item.productId] || stock[item.productId] < item.qty) {
      return res.status(400).send(`Stock insuffisant pour ${item.name}`);
    }
  }

  // Décrémenter stock
  cart.forEach(item => stock[item.productId] -= item.qty);
  saveStock(stock);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);

    // Créer salon ticket
    const channel = await guild.channels.create({
      name: `ticket-${username}`,
      type: 0,
      parent: CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: discordId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    // Embed commande
    const embed = new EmbedBuilder()
      .setTitle("🛒 Nouvelle commande")
      .setColor("Red")
      .setDescription(`Merci ${member || username} pour ta commande ! 🎉`)
      .addFields(
        ...cart.map(c => ({
          name: c.name,
          value: `Quantité: **${c.qty}** — Total: **${c.price * c.qty}€**`,
          inline: false
        })),
        { name: "Total", value: `**${cart.reduce((a, c) => a + c.price * c.qty, 0)}€**` }
      )
      .setFooter({ text: "ZIKO SHOP" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Fermer la commande")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: `${member || ""}`, embeds: [embed], components: [row] });

    // log global
    if (ORDERS_CHANNEL_ID) {
      const logChannel = client.channels.cache.get(ORDERS_CHANNEL_ID);
      if (logChannel) logChannel.send({ embeds: [embed] });
    }

    await updateStockEmbed();

    res.send("Commande validée !");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur lors de la commande");
  }
});

// === Gestion interactions (fermer ticket)
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "close_ticket") {
    await interaction.channel.delete();
  }
});

// === Ready ===
client.once("ready", async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  await updateStockEmbed();
  setInterval(updateStockEmbed, 10000);
});

// === Start ===
app.listen(process.env.PORT || 3000, () => console.log("API en ligne"));
client.login(TOKEN);
