// === Modules ===
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, 
  PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle 
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
const TOKEN = "MTQxNjc0ODMxNjg3NTU1ODkxMw.GrZNfH.IdQEh4kkeGSwA1YW7UEJuIeAvO8Li32mNoTwZA";  
const GUILD_ID = "1416496222419550412"; 
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 

// === Variable pour stock message ===
let stockMessageId = null;

// === Chemin vers le stock local ===
const STOCK_FILE = path.join(__dirname, "stock.json");

// === Fonction pour récupérer le stock local ===
function getStock() {
    if (!fs.existsSync(STOCK_FILE)) return {};
    const data = fs.readFileSync(STOCK_FILE, "utf8");
    return JSON.parse(data);
}

// === Fonction pour sauvegarder le stock local ===
function saveStock(stock) {
    fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

// === Fonction pour mettre à jour le stock Discord ===
async function updateStockEmbed() {
    const stock = getStock();

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle("📦 Stock actuel des produits")
            .setColor(0x00ff99)
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

// === API : réception d'une commande ===
app.post("/order", async (req, res) => {
    const { username, discordId, cart } = req.body;

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) return res.status(404).send("Utilisateur introuvable sur le serveur.");

        const stock = getStock();

        // Vérifier stock
        for (const item of cart) {
            if (!stock[item.productId] || stock[item.productId] < item.qty) {
                return res.status(400).send(`Stock insuffisant pour ${item.name}`);
            }
        }

        // Décrémenter le stock
        cart.forEach(item => {
            stock[item.productId] -= item.qty;
        });
        saveStock(stock);

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

        // Fusion des commandes identiques
        const summary = {};
        let total = 0;
        cart.forEach(item => {
            if (summary[item.name]) {
                summary[item.name].qty += item.qty;
                summary[item.name].price += item.price * item.qty;
            } else {
                summary[item.name] = { qty: item.qty, price: item.price * item.qty };
            }
            total += item.price * item.qty;
        });

        // Embed résumé commande
        const embed = new EmbedBuilder()
            .setTitle("🛒 Nouvelle commande")
            .setColor(0xff4500)
            .setDescription(`Merci ${member} pour ta commande ! 🎉\nVoici le résumé :`)
            .addFields(
                ...Object.entries(summary).map(([name, info]) => ({
                    name,
                    value: `Quantité : **${info.qty}** — Total : **${info.price}€**`,
                    inline: false
                })),
                { name: "Total général", value: `**${total}€**`, inline: false },
                { name: "Pseudo Discord", value: username, inline: true },
                { name: "Discord ID", value: discordId, inline: true },
                { name: "Déroulement", value: "Un membre du staff va prendre en charge ta commande rapidement.", inline: false }
            )
            .setFooter({ text: "ZIKO SHOP - Merci pour ta confiance !" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("close_ticket")
                .setLabel("Fermer la commande")
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `${member}`, embeds: [embed], components: [row] });

        // Mise à jour embed stock
        await updateStockEmbed();

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

// === Mettre à jour le stock toutes les 10 secondes ===
client.once("ready", async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    await updateStockEmbed();
    setInterval(updateStockEmbed, 10 * 1000);
});

// === Lancer serveur web + bot ===
app.listen(3000, () => console.log("API du bot en ligne sur port 3000"));
client.login(TOKEN);

