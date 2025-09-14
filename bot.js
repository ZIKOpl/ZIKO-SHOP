// === Modules ===
const { 
  Client, GatewayIntentBits, Partials, EmbedBuilder, 
  PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
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

// === CONFIG ===
const TOKEN = "MTQxNjc0ODMxNjg3NTU1ODkxMw.GUWV7c.JkNAZvzEmXpouFRoRzTEQKTkYusbXPudZc5t0M";  
const GUILD_ID = "1416496222419550412"; 
const STAFF_ROLE_ID = "1416528620750372944"; 
const CATEGORY_ID = "1416528820428869793"; 
const STOCK_CHANNEL_ID = "1416528608775901194"; 
const ADMIN_PANEL_CHANNEL_ID = "1416904307428691978";

// === Stock File ===
const STOCK_FILE = path.join(__dirname, "stock.json");

// === Images produits ===
const PRODUCT_IMAGES = {
  nitro1m: "https://zikoshop.netlify.app/Assets/nitro.png",
  nitro1y: "https://zikoshop.netlify.app/Assets/nitro.png",
  boost1m: "https://zikoshop.netlify.app/Assets/nitroboost.png",
  boost1y: "https://zikoshop.netlify.app/Assets/nitroboost.png"
};

// === Fonctions stock ===
function getStock() {
  if (!fs.existsSync(STOCK_FILE)) return { nitro1m:0,nitro1y:0,boost1m:0,boost1y:0 };
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
      .setColor(0xff0000)
      .setDescription("Voici les produits disponibles :")
      .setTimestamp();

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
      const msg = await channel.messages.fetch(stockMessageId).catch(()=>null);
      if (msg) return await msg.edit({ embeds: [embed] });
    }

    const newMsg = await channel.send({ embeds: [embed] });
    stockMessageId = newMsg.id;
  } catch (err) {
    console.error("Erreur updateStockEmbed :", err);
  }
}

// === Admin Panel ===
async function sendAdminPanel() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(ADMIN_PANEL_CHANNEL_ID);

  const stock = getStock();
  const embed = new EmbedBuilder()
    .setTitle("🛠 Panel Admin Stock")
    .setColor(0xff0000)
    .setDescription("Gérez le stock ci-dessous :")
    .setTimestamp();

  for (const [key, qty] of Object.entries(stock)) {
    let productName = key === "nitro1m" ? "Nitro 1 mois" :
                      key === "nitro1y" ? "Nitro 1 an" :
                      key === "boost1m" ? "Nitro Boost 1 mois" :
                      "Nitro Boost 1 an";
    embed.addFields({ 
      name: productName, 
      value: `Stock actuel : **${qty}**`,
      inline: true 
    });
    embed.setThumbnail(PRODUCT_IMAGES[key]);
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

  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find(m => m.author.id === client.user.id && m.embeds.length>0 && m.embeds[0].title==="🛠 Panel Admin Stock");
  if (existing) await existing.edit({ embeds: [embed], components: [row] });
  else await channel.send({ embeds: [embed], components: [row] });
}

// === Interaction Admin ===
client.on("interactionCreate", async interaction => {
  if (interaction.isStringSelectMenu() && interaction.customId === "stock_admin") {
    const stock = getStock();
    const value = interaction.values[0];

    let key = value.split("_")[1] + (value.endsWith("1y") ? "y" : "m");
    if (value.startsWith("add_")) stock[key] = (stock[key]||0)+1;
    else if (value.startsWith("remove_")) stock[key] = Math.max((stock[key]||0)-1,0);

    saveStock(stock);
    await interaction.reply({ content: `✅ Stock mis à jour : ${key} = ${stock[key]}`, ephemeral: true });
    await updateStockEmbed();
    await sendAdminPanel();
  }

  if (interaction.isButton() && interaction.customId.startsWith("close_ticket")) {
    await interaction.channel.delete();
  }
});

// === API pour le site ===
app.post("/order", async (req,res)=>{
  const { username, discordId, cart } = req.body;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(()=>null);
    if (!member) return res.status(404).send("Utilisateur introuvable sur le serveur.");

    const stock = getStock();
    for (const item of cart) if (!stock[item.productId] || stock[item.productId]<item.qty)
      return res.status(400).send(`Stock insuffisant pour ${item.name}`);

    cart.forEach(item => { stock[item.productId]-=item.qty; });
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

    // Embed résumé commande
    let summaryText = cart.map(i=>`${i.name} x${i.qty} — ${i.price*i.qty}€`).join("\n");
    const total = cart.reduce((acc,i)=>acc+i.price*i.qty,0);
    const embed = new EmbedBuilder()
      .setTitle("🛒 Nouvelle commande")
      .setColor(0xff0000)
      .setDescription(`Merci ${member} pour ta commande !\n\n${summaryText}\n**Total : ${total}€**`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Fermer la commande").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content:`${member}`, embeds:[embed], components:[row]});
    await updateStockEmbed();
    await sendAdminPanel();

    res.send("Commande envoyée !");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur côté bot");
  }
});

app.get("/stock.json",(req,res)=>res.json(getStock()));

// === Serveur Web ===
app.listen(3000,()=>console.log("API en ligne sur port 3000"));

// === Bot ready ===
client.once("ready", async ()=>{
  console.log(`Bot connecté : ${client.user.tag}`);
  await updateStockEmbed();
  await sendAdminPanel();
});

client.login(TOKEN);


