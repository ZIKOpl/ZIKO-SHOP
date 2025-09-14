// === Modules ===
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
app.use(cors()); // autorise toutes les origines (tu peux restreindre plus tard)
app.use(bodyParser.json());

// === CONFIG ===
const TOKEN = "MTQxNjc0ODMxNjg3NTU1ODkxMw.GrZNfH.IdQEh4kkeGSwA1YW7UEJuIeAvO8Li32mNoTwZA";  
const GUILD_ID = "1416496222419550412"; 
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 

// === Stock file ===
const STOCK_FILE = path.join(__dirname, "stock.json");

// === Utils stock ===
function getStock() {
    if (!fs.existsSync(STOCK_FILE)) return {};
    return JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
}

function saveStock(stock) {
    fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2), "utf8");
}

// === Update stock embed Discord ===
async function updateStockEmbed() {
    const stock = getStock();
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setTitle("📦 Stock actuel")
            .setColor(0x00ff99)
            .setDescription("Voici le stock disponible :")
            .setTimestamp()
            .setFooter({ text: "ZIKO SHOP - Stock mis à jour" });

        for (const [key, value] of Object.entries(stock)) {
            let productName = key === "nitro1m" ? "Nitro 1 mois" :
                              key === "nitro1y" ? "Nitro 1 an" :
                              key === "boost1m" ? "Nitro Boost 1 mois" :
                              "Nitro Boost 1 an";
            embed.addFields({ name: productName, value: `Quantité disponible : **${value}**`, inline: true });
        }

        const messages = await channel.messages.fetch({ limit: 10 });
        const msg = messages.find(m => m.author.id === client.user.id);
        if (msg) await msg.edit({ embeds: [embed] });
        else await channel.send({ embeds: [embed] });

    } catch (err) {
        console.error("Erreur mise à jour embed stock :", err);
    }
}

// === API pour le site ===
app.get("/stock.json", (req, res) => {
    const stock = getStock();
    res.json(stock);
});

app.post("/order", async (req, res) => {
    const { username, discordId, cart } = req.body;
    if (!username || !discordId || !cart) return res.status(400).send("Données manquantes");

    const stock = getStock();

    // Vérification stock
    for (const item of cart) {
        if (!stock[item.productId] || stock[item.productId] < item.qty) {
            return res.status(400).send(`Stock insuffisant pour ${item.name}`);
        }
    }

    // Décrémenter le stock
    cart.forEach(item => stock[item.productId] -= item.qty);
    saveStock(stock);

    // Créer un ticket Discord
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId);
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
            } else {
                summary[item.name] = { qty: item.qty, price: item.price * item.qty };
            }
            total += item.price * item.qty;
        });

        const embed = new EmbedBuilder()
            .setTitle("🛒 Nouvelle commande")
            .setColor(0xff4500)
            .setDescription(`Merci ${member} pour ta commande ! 🎉`)
            .addFields(
                ...Object.entries(summary).map(([name, info]) => ({ name, value: `Quantité : **${info.qty}** — Total : **${info.price}€**` })),
                { name: "Total général", value: `**${total}€**` },
                { name: "Pseudo Discord", value: username },
                { name: "Discord ID", value: discordId }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("close_ticket").setLabel("Fermer la commande").setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `${member}`, embeds: [embed], components: [row] });

        await updateStockEmbed();
        res.send("Commande envoyée !");

    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur côté bot");
    }
});

// === Interaction bouton ===
client.on("interactionCreate", async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === "close_ticket") await interaction.channel.delete();
});

// === Bot ready ===
client.once("ready", async () => {
    console.log(`Bot connecté : ${client.user.tag}`);
    await updateStockEmbed();
    setInterval(updateStockEmbed, 10000);
});

// === Lancer serveur + bot ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API du bot en ligne sur port ${PORT}`));
client.login(TOKEN);
