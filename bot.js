// === Modules ===
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, 
  PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, InteractionType 
} = require("discord.js");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

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

// === Express App ===
const app = express();
app.use(cors());
app.use(bodyParser.json());

// === Config ===
const TOKEN = "MTQxNjc0ODMxNjg3NTU1ODkxMw.GrZNfH.IdQEh4kkeGSwA1YW7UEJuIeAvO8Li32mNoTwZA";  
const GUILD_ID = "1416496222419550412"; 
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 
const ADMIN_CHANNEL_ID = "1416904307428691978";

// === Chemin vers stock ===
const STOCK_FILE = path.join(__dirname, "stock.json");

// === Images produits ===
const PRODUCT_IMAGES = {
  "nitro1m": "https://zikoshop.netlify.app/Assets/nitro.png",
  "nitro1y": "https://zikoshop.netlify.app/Assets/nitro.png",
  "boost1m": "https://zikoshop.netlify.app/Assets/nitroboost.png",
  "boost1y": "https://zikoshop.netlify.app/Assets/nitroboost.png"
};

// === Fonctions Stock ===
function getStock() {
  if (!fs.existsSync(STOCK_FILE)) return {};
  return JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
}

function saveStock(stock) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

// === Embed Stock ===
let stockMessageId = null;
async function updateStockEmbed() {
  const stock = getStock();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel")
      .setColor(0x00ff99)
      .setDescription("Voici les produits disponibles sur le site :")
      .setTimestamp()
      .setFooter({ text: "ZIKO SHOP" });

    for (const [key, qty] of Object.entries(stock)) {
      let productName = key === "nitro1m" ? "Nitro 1 mois" :
                        key === "nitro1y" ? "Nitro 1 an" :
                        key === "boost1m" ? "Nitro Boost 1 mois" :
                        "Nitro Boost 1 an";
      embed.addFields({
        name: productName,
        value: `Quantité : **${qty}**`,
        inline: true
      });
      embed.setThumbnail(PRODUCT_IMAGES[key]);
    }

    if (stockMessageId) {
      const msg = await channel.messages.fetch(stockMessageId).catch(() => null);
      if (msg) return await msg.edit({ embeds: [embed] });
    }

    const newMsg = await channel.send({ embeds: [embed] });
    stockMessageId = newMsg.id;
  } catch (err) {
    console.error("Erreur embed stock :", err);
  }
}

// === Admin Panel ===
async function sendAdminPanel() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

  const stock = getStock();
  const embed = new EmbedBuilder()
    .setTitle("🛠️ Panel Admin Stock")
    .setColor(0x0099ff)
    .setDescription("Gérez le stock des produits ici.")
    .setTimestamp();

  for (const [key, qty] of Object.entries(stock)) {
    let productName = key === "nitro1m" ? "Nitro 1 mois" :
                      key === "nitro1y" ? "Nitro 1 an" :
                      key === "boost1m" ? "Nitro Boost 1 mois" :
                      "Nitro Boost 1 an";
    embed.addFields({ name: productName, value: `Stock actuel : **${qty}**`, inline: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("stock_admin")
      .setPlaceholder("Sélectionnez une action")
      .addOptions([
        { label: "Ajouter Nitro 1 mois", value: "add_nitro1m" },
        { label: "Retirer Nitro 1 mois", value: "remove_nitro1m" },
        { label: "Ajouter Nitro 1 an", value: "add_nitro1y" },
        { label: "Retirer Nitro 1 an", value: "remove_nitro1y" },
        { label: "Ajouter Boost 1 mois", value: "add_boost1m" },
        { label: "Retirer Boost 1 mois", value: "remove_boost1m" },
        { label: "Ajouter Boost 1 an", value: "add_boost1y" },
        { label: "Retirer Boost 1 an", value: "remove_boost1y" }
      ])
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// === Interaction Admin ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  const stock = getStock();
  const value = interaction.values[0];

  if (value.startsWith("add_")) {
    const key = value.split("_")[1] + (value.endsWith("1y") ? "y" : "m");
    stock[key] = (stock[key] || 0) + 1;
    saveStock(stock);
    await interaction.reply({ content: `✅ Stock ajouté pour ${key}`, ephemeral: true });
  } else if (value.startsWith("remove_")) {
    const key = value.split("_")[1] + (value.endsWith("1y") ? "y" : "m");
    stock[key] = Math.max((stock[key] || 0) - 1, 0);
    saveStock(stock);
    await interaction.reply({ content: `⚠️ Stock retiré pour ${key}`, ephemeral: true });
  }

  await updateStockEmbed();
  await sendAdminPanel();
});

// === Serveur Web pour fetch stock ===
app.get("/stock.json", (req, res) => {
  res.json(getStock());
});

app.listen(3000, () => console.log("API bot en ligne sur port 3000"));

// === Bot Ready ===
client.once("ready", async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  await updateStockEmbed();
  await sendAdminPanel();
  setInterval(updateStockEmbed, 10 * 1000); // maj toutes les 30 sec
});

client.login(TOKEN);
