// bot.js (COMPLET – corrigé CORS pour Netlify)
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

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
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

// Crée les fichiers si inexistants
if (!fs.existsSync(STOCK_FILE)) fs.writeFileSync(STOCK_FILE, JSON.stringify({ nitro1m:10, nitro1y:5, boost1m:8, boost1y:3 }, null, 2));
if (!fs.existsSync(PRICES_FILE)) fs.writeFileSync(PRICES_FILE, JSON.stringify({ nitro1m:1.5, nitro1y:10, boost1m:3.5, boost1y:30 }, null, 2));

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
  nitro1m: { name: "Nitro 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro.png` },
  nitro1y: { name: "Nitro 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro.png` },
  boost1m: { name: "Nitro Boost 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitroboost.png` },
  boost1y: { name: "Nitro Boost 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitroboost.png` }
};

// --- Express ---
const app = express();
app.use(bodyParser.json());

// ⚡ CORS configuré pour Netlify
app.use(cors({ origin: NETLIFY_ORIGIN, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','x-api-key'] }));

// --- Routes publiques ---
app.get("/stock.json", (req,res) => res.json(getStock()));
app.get("/prices.json", (req,res) => res.json(getPrices()));

// --- OAuth Discord ---
app.get("/login", (req,res) => {
  if (!CLIENT_ID || !REDIRECT_URI) return res.status(500).send("OAuth non configuré");
  const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
  return res.redirect(url);
});

app.get("/callback", async (req,res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Code manquant");
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
    if (!tokenData.access_token) return res.status(500).send("Erreur OAuth");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(500).send("Impossible de récupérer l'utilisateur");

    const userJsonSafe = JSON.stringify(user).replace(/</g, '\\u003c');
    const redirectTo = NETLIFY_ORIGIN.endsWith("/") ? NETLIFY_ORIGIN.slice(0,-1) : NETLIFY_ORIGIN;
    return res.setHeader("Content-Type", "text/html").send(`
      <!doctype html><html><head><meta charset="utf-8"><title>Connexion Discord</title></head>
      <body>
        <script>
          try { localStorage.setItem("discordUser", ${userJsonSafe}); } catch(e) {}
          window.location.href = "${redirectTo}/shop.html";
        </script>
      </body></html>
    `);
  } catch (err) {
    console.error("Erreur /callback:", err);
    return res.status(500).send("Erreur OAuth");
  }
});

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

  // Notify orders channel
  (async () => {
    try {
      if (ORDERS_CHANNEL_ID && client.isReady()) {
        const ch = await client.channels.fetch(ORDERS_CHANNEL_ID).catch(()=>null);
        if (ch) {
          const embed = new EmbedBuilder()
            .setTitle("🛒 Nouvelle commande")
            .setColor(0xff0000)
            .setDescription(`Commande de ${username} (${discordId})`)
            .addFields(...cart.map(c => ({ name: PRODUCTS[c.productId]?.name || c.name, value: `Qty ${c.qty} — ${c.price*c.qty}€` })))
            .setTimestamp();
          ch.send({ embeds: [embed] }).catch(()=>{});
        }
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
      .setDescription("Produits disponibles (prix + stock)")
      .setTimestamp()
      .setFooter({ text: "ZIKO SHOP" });

    let firstImage = null;
    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      if (!firstImage) firstImage = p.img;
      embed.addFields({ name: p.name, value: `Prix: **${prices[key] ?? "N/A"}€**\nStock: **${stock[key] ?? 0}**`, inline: true });
    }
    if (firstImage) embed.setThumbnail(firstImage);

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
    for (const key of Object.keys(PRODUCTS)) {
      options.push({ label: `${PRODUCTS[key].name} • Ajouter`, value: `add_${key}` });
      options.push({ label: `${PRODUCTS[key].name} • Retirer`, value: `remove_${key}` });
      options.push({ label: `${PRODUCTS[key].name} • Modifier prix`, value: `price_${key}` });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("admin_select_action")
      .setPlaceholder("Choisis action...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);
    const embed = new EmbedBuilder()
      .setTitle("🔧 Panel Admin — Gestion Stock & Prix")
      .setColor(0xff0000)
      .setDescription("Sélectionne une action pour ouvrir un formulaire.")
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
      await interaction.reply({ content: "Ticket fermé.", ephemeral: true }).catch(()=>{});
      await interaction.channel.delete().catch(()=>{});
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "admin_select_action") {
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
      if (!member) { await interaction.reply({ content: "Erreur permissions.", ephemeral: true }); return; }
      if (!member.roles.cache.has(STAFF_ROLE_ID) && !member.permissions.has("ManageGuild")) {
        await interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true });
        return;
      }

      const value = interaction.fields.getTextInputValue("value_input").trim();
      if (action === "price") {
        const num = parseFloat(value.replace(",","."));
        if (isNaN(num) || num < 0) { await interaction.reply({ content: "Prix invalide.", ephemeral: true }); return; }
        const prices = getPrices(); prices[productId] = num; savePrices(prices);
        await interaction.reply({ content: `Prix de ${PRODUCTS[productId].name} mis à ${num}€`, ephemeral: true });
        await updateStockEmbed();
      } else if (action === "add" || action === "remove") {
        const qty = parseInt(value,10);
        if (isNaN(qty) || qty <= 0) { await interaction.reply({ content: "Quantité invalide.", ephemeral: true }); return; }
        const stock = getStock();
        stock[productId] = (stock[productId] || 0) + (action==="add"?qty:-qty);
        if (stock[productId] < 0) stock[productId] = 0;
        saveStock(stock);
        await interaction.reply({ content: `${action==="add"?"Ajouté":"Retiré"} ${qty} à ${PRODUCTS[productId].name}. Nouveau stock: ${stock[productId]}`, ephemeral: true });
        await updateStockEmbed();
      }
    }
  } catch (err) {
    console.error("interactionCreate error", err);
    try { if (!interaction.replied) await interaction.reply({ content: "Erreur interne.", ephemeral: true }); } catch(e){}
  }
});

// --- Ready & Start ---
client.once("ready", async () => {
  console.log(`Bot prêt: ${client.user.tag}`);
  await updateStockEmbed();
  await ensureAdminPanel();
  setInterval(async ()=>{ await updateStockEmbed(); await ensureAdminPanel(); }, 10000);
});

// --- Start serveur Express ---
app.listen(PORT, ()=> console.log(`API en ligne sur port ${PORT}`));
client.login(DISCORD_TOKEN).catch(err => { console.error("Erreur login Discord:", err); process.exit(1); });
