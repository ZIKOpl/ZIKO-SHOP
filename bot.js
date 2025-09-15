// bot.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // si Node <18
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType
} = require("discord.js");

// --- ENV ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const STOCK_CHANNEL_ID = process.env.STOCK_CHANNEL_ID;
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID || null;

const NETLIFY_ORIGIN = process.env.NETLIFY_ORIGIN || "https://zikoshop.netlify.app";
const API_SECRET = process.env.API_SECRET || null;
const PORT = process.env.PORT || 3000;

// --- Vérification ENV ---
if (!DISCORD_TOKEN || !GUILD_ID || !STAFF_ROLE_ID || !CATEGORY_ID || !STOCK_CHANNEL_ID || !ADMIN_CHANNEL_ID) {
  console.error("❌ Variables d'environnement manquantes !");
  process.exit(1);
}

// --- Files ---
const STOCK_FILE = path.join(__dirname, "stock.json");
const PRICES_FILE = path.join(__dirname, "prices.json");
const STATE_FILE = path.join(__dirname, "state.json");

// --- State helpers ---
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch(e){ return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2), "utf8");
}
let state = loadState();
let stockMessageId = state.stockMessageId || null;
let adminMessageId = state.adminMessageId || null;

// --- Stock & Prices helpers ---
function getStock(){ try { return JSON.parse(fs.readFileSync(STOCK_FILE,"utf8")); } catch(e){ return {}; } }
function saveStock(s){ fs.writeFileSync(STOCK_FILE, JSON.stringify(s,null,2),"utf8"); }
function getPrices(){ try { return JSON.parse(fs.readFileSync(PRICES_FILE,"utf8")); } catch(e){ return {}; } }
function savePrices(p){ fs.writeFileSync(PRICES_FILE, JSON.stringify(p,null,2),"utf8"); }

// --- Product meta ---
const PRODUCTS = {
  nitro1m: { name: "Nitro 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro1.png` },
  nitro1y: { name: "Nitro 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro2.png` },
  boost1m: { name: "Nitro Boost 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro3t.png` },
  boost1y: { name: "Nitro Boost 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro4.png` }
};

// --- Express ---
const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: NETLIFY_ORIGIN, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','x-api-key'] }));

app.get("/stock.json", (req,res) => res.json(getStock()));
app.get("/prices.json", (req,res) => res.json(getPrices()));

// --- Order API ---
app.post("/order", async (req,res) => {
  if (API_SECRET) {
    const key = req.headers["x-api-key"];
    if (!key || key !== API_SECRET) return res.status(403).send("API key invalide");
  }
  const { username, discordId, cart } = req.body;
  if (!cart || !Array.isArray(cart) || cart.length === 0) return res.status(400).send("Panier vide");

  const stock = getStock();
  for (const it of cart) {
    if (!stock[it.productId] || stock[it.productId] < it.qty) {
      return res.status(400).send(`Stock insuffisant pour ${it.name}`);
    }
  }
  cart.forEach(it => stock[it.productId] -= it.qty);
  saveStock(stock);

  // Notify orders channel & create ticket
  (async () => {
    try {
      if (ORDERS_CHANNEL_ID && client.isReady()) {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(()=>null);
        if (!member) return;

        // Crée le ticket
        const ticketChannel = await guild.channels.create({
          name: `commande-${username}`.replace(/\s+/g,'-'),
          type: 0, // text channel
          parent: CATEGORY_ID,
          permissionOverwrites: [
            { id: member.id, allow: ['ViewChannel', 'SendMessages'] },
            { id: STAFF_ROLE_ID, allow: ['ViewChannel','SendMessages'] },
            { id: guild.roles.everyone, deny: ['ViewChannel'] }
          ]
        });

        await notifyOrder({ cart, discordId, username, ticketChannel });
      }
    } catch(e){ console.error("notify orders failed", e); }
  })();

  updateStockEmbed().catch(()=>{});
  return res.send("Commande traitée");
});

// --- Discord Bot ---
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers ],
  partials: [Partials.Channel]
});

// --- Fonctions bot ---

async function updateStockEmbed(){
  const stock = getStock();
  const prices = getPrices();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);
    if (!channel) throw new Error("Stock channel introuvable");

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel des produits")
      .setColor(0xff0000)
      .setTimestamp()
      .setFooter({ text: "ZIKO SHOP" });

    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      embed.addFields({
        name: `${p.name}`,
        value: `Prix: **${prices[key] ?? "N/A"}€**\nStock: **${stock[key] ?? 0}**`,
        inline: true
      });
      if (!embed.data.thumbnail) embed.setThumbnail(p.img); // image du premier produit
    }

    if (stockMessageId) {
      const msg = await channel.messages.fetch(stockMessageId).catch(()=>null);
      if (msg) { await msg.edit({ embeds:[embed] }); return; }
    }
    const m = await channel.send({ embeds:[embed] });
    stockMessageId = m.id;
    state.stockMessageId = stockMessageId;
    saveState(state);

  } catch(e){ console.error("updateStockEmbed error", e); }
}

async function ensureAdminPanel(){
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);
    if (!channel) throw new Error("Admin channel introuvable");

    const options = [];
    const stock = getStock();
    const prices = getPrices();

    let desc = "Sélectionne une action pour gérer le stock et les prix.\n\n";
    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      desc += `**${p.name}** — Stock: **${stock[key] ?? 0}** — Prix: **${prices[key] ?? "N/A"}€**\n`;
      options.push({ label: `${p.name} • Ajouter`, value: `add_${key}` });
      options.push({ label: `${p.name} • Retirer`, value: `remove_${key}` });
      options.push({ label: `${p.name} • Modifier prix`, value: `price_${key}` });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("admin_select_action")
      .setPlaceholder("Choisis action...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setTitle("🔧 Panel Admin — Gestion Stock & Prix")
      .setDescription(desc)
      .setColor(0xff0000)
      .setTimestamp();

    if (adminMessageId) {
      const existing = await channel.messages.fetch(adminMessageId).catch(()=>null);
      if (existing) { await existing.edit({ embeds:[embed], components:[row] }).catch(()=>{}); return; }
    }
    const m = await channel.send({ embeds:[embed], components:[row] });
    adminMessageId = m.id;
    state.adminMessageId = adminMessageId;
    saveState(state);

  } catch(e){ console.error("ensureAdminPanel", e); }
}

// --- Interactions ---
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === "close_ticket") {
      if (!interaction.replied && !interaction.deferred)
        await interaction.reply({ content: "Ticket fermé.", flags: 64 });
      await interaction.channel.delete().catch(()=>{});
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "admin_select_action") {
      await interaction.deferUpdate(); // ⚠️ Acknowledge interaction before showing modal
      const value = interaction.values[0];
      const [action, ...rest] = value.split("_");
      const productId = rest.join("_");
      const modal = new ModalBuilder()
        .setCustomId(`admin_modal_${action}_${productId}`)
        .setTitle(`${action==="price"?"Modifier le prix": (action==="add"?"Ajouter au stock":"Retirer du stock")} — ${PRODUCTS[productId]?.name || productId}`);
      const input = new TextInputBuilder()
        .setCustomId("value_input")
        .setLabel(action==="price"?"Nouveau prix":"Quantité (entier)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(action==="price"?"Ex: 3.50":"Ex: 1");
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit) {
      const id = interaction.customId;
      if (!id.startsWith("admin_modal_")) return;
      const parts = id.split("_");
      const action = parts[2];
      const productId = parts.slice(3).join("_");
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(()=>null);
      if (!member) { if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Erreur permissions.", flags: 64 }); return; }
      if (!member.roles.cache.has(STAFF_ROLE_ID) && !member.permissions.has("ManageGuild")) {
        if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Tu n'as pas la permission.", flags: 64 });
        return;
      }

      const value = interaction.fields.getTextInputValue("value_input").trim();
      if (action === "price") {
        const num = parseFloat(value.replace(",",".")) ;
        if (isNaN(num) || num < 0) { if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Prix invalide.", flags: 64 }); return; }
        const prices = getPrices(); prices[productId] = num; savePrices(prices);
        if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: `Prix de ${PRODUCTS[productId].name} mis à ${num}€`, flags: 64 });
        await updateStockEmbed();
      } else if (action === "add" || action === "remove") {
        const qty = parseInt(value,10);
        if (isNaN(qty) || qty <= 0) { if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Quantité invalide.", flags: 64 }); return; }
        const stock = getStock();
        stock[productId] = (stock[productId] || 0) + (action==="add"?qty:-qty);
        if (stock[productId] < 0) stock[productId] = 0;
        saveStock(stock);
        if(!interaction.replied && !interaction.deferred) await interaction.reply({ content: `${action==="add"?"Ajouté":"Retiré"} ${qty} à ${PRODUCTS[productId].name}. Nouveau stock: ${stock[productId]}`, flags: 64 });
        await updateStockEmbed();
      }
    }
  } catch (err) {
    console.error("interactionCreate error", err);
    try { 
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Erreur interne.", flags: 64 }); 
    } catch(e){}
  }
});

// --- Commande embed ---
const STAFF_MENTION = `<@&${STAFF_ROLE_ID}>`;

async function notifyOrder(order){
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(order.discordId).catch(()=>null);
    if (!member) return;
    if (!ORDERS_CHANNEL_ID) return;

    const channel = await guild.channels.fetch(ORDERS_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setTitle("🛒 Nouvelle commande")
      .setDescription(`Commande de ${member}\n${STAFF_MENTION}`)
      .setColor(0x00ff00)
      .setTimestamp();

    let total = 0;
    const lines = order.cart.map(it=>{
      const price = it.price * it.qty;
      total += price;
      return `${PRODUCTS[it.productId]?.name || it.productId} x${it.qty} — **${price.toFixed(2)}€**`;
    });

    embed.addFields(
      { name: "Détails de la commande", value: lines.join("\n") },
      { name: "Total", value: `**${total.toFixed(2)}€**` },
      { name: "Étapes suivantes", value: `Merci pour votre commande ! Un membre du staff va vous contacter pour finaliser le paiement et la livraison.` }
    );

    await channel.send({ embeds:[embed] });
  } catch(e){ console.error("notifyOrder error", e); }
}

// --- Ready & Start ---
client.once("ready", async () => {
  console.log(`Bot prêt: ${client.user.tag}`);
  await updateStockEmbed();
  await ensureAdminPanel();
  setInterval(async ()=>{ await updateStockEmbed(); }, 10000);
});

// --- Start serveur Express ---
app.listen(PORT, ()=> console.log(`API en ligne sur port ${PORT}`));
client.login(DISCORD_TOKEN).catch(err => { console.error("Erreur login Discord:", err); process.exit(1); });
