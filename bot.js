// === Modules ===
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, 
  PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder
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

// === Middleware ===
app.use(cors()); // Autorise toutes origines
app.use(bodyParser.json());

// === CONFIG ===
const TOKEN = process.env.DISCORD_TOKEN; 
const GUILD_ID = "1416496222419550412";     
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 
const ADMIN_CHANNEL_ID = "1416904307428691978";

// === Chemin vers le JSON ===
const DATA_FILE = path.join(__dirname, "products.json");

// === Fonction pour récupérer le JSON ===
function getData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  const data = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(data);
}

// === Fonction pour sauvegarder le JSON ===
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// === PRODUITS + IMAGES ===
const PRODUCT_IMAGES = {
  "nitro1m": "https://zikoshop.netlify.app/shopAssets/nitro.png",
  "nitro1y": "https://zikoshop.netlify.app/shopAssets/nitro.png",
  "boost1m": "https://zikoshop.netlify.app/shopAssets/nitroboost.png",
  "boost1y": "https://zikoshop.netlify.app/shopAssets/nitroboost.png"
};

// === Variable pour stock message ===
let stockMessageId = null;
let adminPanelMessageId = null;

// === Fonction pour mettre à jour l'embed stock ===
async function updateStockEmbed() {
  const data = getData();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel")
      .setColor(0xff0000) // rouge
      .setDescription("Voici les produits disponibles sur le site :")
      .setTimestamp()
      .setFooter({ text: "ZIKO SHOP - Stock mis à jour automatiquement" });

    for (const [key, value] of Object.entries(data)) {
      embed.addFields({
        name: `${key} • ${value.price}€`,
        value: `Quantité : **${value.qty}**`,
        inline: true
      });
      embed.setThumbnail(PRODUCT_IMAGES[key] || "");
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
    console.error("Erreur mise à jour stock embed :", err);
  }
}

// === Panel Admin ===
async function updateAdminPanel() {
  const data = getData();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ADMIN_PANEL_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("🛠️ Panel Admin - Gestion Stock")
      .setColor(0xff0000)
      .setDescription("Sélectionnez un produit et une action pour modifier le stock ou le prix :")
      .setTimestamp();

    for (const [key, value] of Object.entries(data)) {
      embed.addFields({
        name: `${key} • ${value.price}€`,
        value: `Quantité : **${value.qty}**`,
        inline: true
      });
      embed.setThumbnail(PRODUCT_IMAGES[key] || "");
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("admin_stock_menu")
      .setPlaceholder("Sélectionner un produit et une action")
      .addOptions([
        { label: "Ajouter Nitro 1 mois", value: "add_nitro1m" },
        { label: "Retirer Nitro 1 mois", value: "remove_nitro1m" },
        { label: "Ajouter Nitro 1 an", value: "add_nitro1y" },
        { label: "Retirer Nitro 1 an", value: "remove_nitro1y" },
        { label: "Ajouter Nitro Boost 1 mois", value: "add_boost1m" },
        { label: "Retirer Nitro Boost 1 mois", value: "remove_boost1m" },
        { label: "Ajouter Nitro Boost 1 an", value: "add_boost1y" },
        { label: "Retirer Nitro Boost 1 an", value: "remove_boost1y" }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    if (adminPanelMessageId) {
      const msg = await channel.messages.fetch(adminPanelMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components: [row] });
        return;
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    adminPanelMessageId = newMsg.id;

  } catch (err) {
    console.error("Erreur mise à jour admin panel :", err);
  }
}

// === Gestion interaction Admin ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  if (!interaction.customId.startsWith("admin_stock")) return;
  if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
    return interaction.reply({ content: "Vous n'avez pas la permission.", ephemeral: true });
  }

  const data = getData();
  const value = interaction.values[0];

  const [action, product] = value.split("_"); // add_nitro1m ou remove_boost1y

  if (!data[product]) return;

  if (action === "add") data[product].qty++;
  else if (action === "remove" && data[product].qty > 0) data[product].qty--;

  saveData(data);

  await updateStockEmbed();
  await updateAdminPanel();

  interaction.reply({ content: "✅ Modification effectuée.", ephemeral: true });
});

// === API : réception d'une commande ===
app.post("/order", async (req, res) => {
  const { username, discordId, cart } = req.body;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return res.status(404).send("Utilisateur introuvable sur le serveur.");

    const data = getData();

    // Vérifier stock
    for (const item of cart) {
      if (!data[item.productId] || data[item.productId].qty < item.qty) {
        return res.status(400).send(`Stock insuffisant pour ${item.name}`);
      }
    }

    // Décrémenter le stock
    cart.forEach(item => {
      data[item.productId].qty -= item.qty;
    });
    saveData(data);

    // Créer le salon ticket
    const channel = await guild.channels.create({
      name: `ticket-${username}`,
      type: 0,
      parent: CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    // Embed résumé commande
    const embed = new EmbedBuilder()
      .setTitle("🛒 Nouvelle commande")
      .setColor(0xff0000)
      .setDescription(`Merci ${member} pour ta commande ! 🎉`)
      .addFields(
        ...cart.map(item => ({
          name: item.name,
          value: `Quantité : **${item.qty}** — Total : **${item.price * item.qty}€**`,
          inline: true
        })),
        { name: "Pseudo Discord", value: username, inline: true },
        { name: "Discord ID", value: discordId, inline: true }
      )
      .setThumbnail(cart[0] ? PRODUCT_IMAGES[cart[0].productId] : "")
      .setFooter({ text: "ZIKO SHOP - Merci pour ta confiance !" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Fermer la commande")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: `${member}`, embeds: [embed], components: [row] });

    await updateStockEmbed();
    await updateAdminPanel();

    res.send("Commande envoyée !");

  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur côté bot.");
  }
});

// === Bouton fermer ticket ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "close_ticket") {
    await interaction.channel.delete();
  }
});

// === Bot prêt ===
client.once("ready", async () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  await updateStockEmbed();
  await updateAdminPanel();
});

// === Lancer serveur web + bot ===
app.listen(3000, () => console.log("API du bot en ligne sur port 3000"));
client.login(TOKEN);
