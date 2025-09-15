// === Modules ===
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, 
  PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder 
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
app.use(cors({ origin: "*" })); // Autorise toutes origines
app.use(bodyParser.json());

// === CONFIG ===
const TOKEN = process.env.DISCORD_TOKEN; 
const GUILD_ID = "1416496222419550412";     
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 
const ADMIN_CHANNEL_ID = "1416904307428691978"; // Salon Admin panel

// === Stock local ===
const STOCK_FILE = path.join(__dirname, "stock.json");

// === Embeds messages ID ===
let stockMessageId = null;
let adminMessageId = null;

// === Produits + images ===
const PRODUCT_IMAGES = {
  "nitro1m": "https://zikoshop.netlify.app/shopAssets/nitro.png",
  "nitro1y": "https://zikoshop.netlify.app/shopAssets/nitro.png",
  "boost1m": "https://zikoshop.netlify.app/shopAssets/nitroboost.png",
  "boost1y": "https://zikoshop.netlify.app/shopAssets/nitroboost.png"
};

// === Fonctions stock ===
function getStock() {
    if (!fs.existsSync(STOCK_FILE)) return {};
    const data = fs.readFileSync(STOCK_FILE, "utf8");
    return JSON.parse(data);
}

function saveStock(stock) {
    fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

// === Mettre à jour embed stock public ===
async function updateStockEmbed() {
    const stock = getStock();
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle("📦 Stock actuel des produits")
            .setColor(0xff0000)
            .setDescription("Voici les produits actuellement disponibles sur le site :")
            .setTimestamp()
            .setFooter({ text: "ZIKO SHOP - Stock mis à jour automatiquement" });

        for (const [key, value] of Object.entries(stock)) {
            let productName = key === "nitro1m" ? "Nitro 1 mois" :
                              key === "nitro1y" ? "Nitro 1 an" :
                              key === "boost1m" ? "Nitro Boost 1 mois" :
                              "Nitro Boost 1 an";
            embed.addFields({
                name: productName,
                value: `Quantité disponible : **${value}**`,
                inline: true
            });
            embed.setThumbnail(PRODUCT_IMAGES[key]); // Image à côté
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
        console.error("Erreur mise à jour embed stock :", err);
    }
}

// === Mettre à jour panel admin ===
async function updateAdminPanel() {
    const stock = getStock();
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle("⚙️ Panel Admin - Gestion Stock")
            .setColor(0x00ff00)
            .setDescription("Sélectionnez un produit et choisissez Ajouter ou Retirer")
            .setTimestamp();

        for (const [key, value] of Object.entries(stock)) {
            let productName = key === "nitro1m" ? "Nitro 1 mois" :
                              key === "nitro1y" ? "Nitro 1 an" :
                              key === "boost1m" ? "Nitro Boost 1 mois" :
                              "Nitro Boost 1 an";
            embed.addFields({
                name: productName,
                value: `Stock actuel : **${value}**`,
                inline: true
            });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId("admin_stock_select")
            .setPlaceholder("Choisissez une action et un produit")
            .addOptions([
                { label: "Ajouter Nitro 1 mois", value: "add_nitro1m" },
                { label: "Retirer Nitro 1 mois", value: "remove_nitro1m" },
                { label: "Ajouter Nitro 1 an", value: "add_nitro1y" },
                { label: "Retirer Nitro 1 an", value: "remove_nitro1y" },
                { label: "Ajouter Nitro Boost 1 mois", value: "add_boost1m" },
                { label: "Retirer Nitro Boost 1 mois", value: "remove_boost1m" },
                { label: "Ajouter Nitro Boost 1 an", value: "add_boost1y" },
                { label: "Retirer Nitro Boost 1 an", value: "remove_boost1y" },
            ]);

        const row = new ActionRowBuilder().addComponents(select);

        if (adminMessageId) {
            const msg = await channel.messages.fetch(adminMessageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds: [embed], components: [row] });
                return;
            }
        }

        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        adminMessageId = newMsg.id;

    } catch (err) {
        console.error("Erreur panel admin :", err);
    }
}

// === Interaction admin panel ===
client.on("interactionCreate", async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === "admin_stock_select") {
        const value = interaction.values[0];
        const stock = getStock();

        const [action, productId] = value.split("_");
        if (action === "add") stock[productId] = (stock[productId] || 0) + 1;
        if (action === "remove") stock[productId] = Math.max((stock[productId] || 0) - 1, 0);

        saveStock(stock);
        await updateStockEmbed();
        await updateAdminPanel();
        await interaction.reply({ content: "Stock mis à jour ✅", ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
        await interaction.channel.delete();
    }
});

// === API pour site ===
app.get("/stock.json", (req,res) => {
    const stock = getStock();
    res.json(stock);
});

app.post("/order", async (req,res) => {
    const { username, discordId, cart } = req.body;
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) return res.status(404).send("Utilisateur introuvable");

        const stock = getStock();
        for (const item of cart) {
            if (!stock[item.productId] || stock[item.productId] < item.qty)
                return res.status(400).send(`Stock insuffisant pour ${item.name}`);
        }
        cart.forEach(item => stock[item.productId] -= item.qty);
        saveStock(stock);

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

        const summary = {};
        let total = 0;
        cart.forEach(item => {
            if (summary[item.name]) {
                summary[item.name].qty += item.qty;
                summary[item.name].price += item.price * item.qty;
            } else summary[item.name] = { qty: item.qty, price: item.price * item.qty };
            total += item.price * item.qty;
        });

        const embed = new EmbedBuilder()
            .setTitle("🛒 Nouvelle commande")
            .setColor(0xff0000)
            .setDescription(`Merci ${member} pour ta commande ! 🎉`)
            .addFields(
                ...Object.entries(summary).map(([name, info]) => ({
                    name,
                    value: `Quantité : **${info.qty}** — Total : **${info.price}€**`,
                    inline: false
                })),
                { name: "Total général", value: `**${total}€**`, inline: false },
                { name: "Pseudo Discord", value: username, inline: true },
                { name: "Discord ID", value: discordId, inline: true }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("close_ticket")
                .setLabel("Fermer la commande")
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
        await updateStockEmbed();

        res.send("Commande envoyée !");
    } catch(err) {
        console.error(err);
        res.status(500).send("Erreur côté bot");
    }
});

// === Ready ===
client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    await updateStockEmbed();
    await updateAdminPanel();
    setInterval(updateStockEmbed, 10*1000);
});

// === Lancer serveur + bot ===
app.listen(3000, () => console.log("API en ligne sur port 3000"));
client.login(TOKEN);
