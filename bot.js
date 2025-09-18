const fs = require("fs"); 
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
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
const PRICES_FILE = path.join(__dirname, "prices.json");
const STATE_FILE = path.join(__dirname, "state.json");

// Création des fichiers si inexistants
if (!fs.existsSync(PRICES_FILE)) fs.writeFileSync(PRICES_FILE, JSON.stringify({ nitro1m:1.5, nitro1y:10, boost1m:3.5, boost1y:30, serv14b:14 }, null, 2));
if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, JSON.stringify({}, null, 2));

// --- State helpers ---
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch(e){ return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2), "utf8"); }
let state = loadState();
let stockMessageId = state.stockMessageId || null;
let adminMessageId = state.adminMessageId || null;

// --- Prices helpers ---
function getPrices(){ try { return JSON.parse(fs.readFileSync(PRICES_FILE,"utf8")); } catch(e){ return {}; } }
function savePrices(p){ fs.writeFileSync(PRICES_FILE, JSON.stringify(p,null,2),"utf8"); }

// --- Product meta ---
const PRODUCTS = {
  nitro1m: { name: "Nitro 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro1.png` },
  nitro1y: { name: "Nitro 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro2.png` },
  boost1m: { name: "Nitro Boost 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro3.png` },
  boost1y: { name: "Nitro Boost 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro4.png` },
  serv14b: { name: "Serv Discord 14 Boost", img: `${NETLIFY_ORIGIN}/Assets/boost.png` }
};

// --- Express ---
const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: NETLIFY_ORIGIN, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','x-api-key'] }));

// Ping route pour uptime robot
app.get("/", (req, res) => { res.send("Bot en ligne !"); });

// --- Prices route ---
app.get("/prices.json", (req,res) => res.json(getPrices()));

// --- Stock helpers & route ---
function getStock() {
  const s = loadState();
  const stockData = {};
  for (const key of Object.keys(PRODUCTS)) {
    stockData[key] = s[key]?.qty ?? 0;
  }
  return stockData;
}

app.get("/stock.json", (req,res) => {
  res.json(getStock());
});

// --- Order API ---
app.post("/order", async (req,res) => {
  if (API_SECRET) {
    const key = req.headers["x-api-key"];
    if (!key || key !== API_SECRET) return res.status(403).send("API key invalide");
  }
  const { username, discordId, cart } = req.body;
  if (!cart || !Array.isArray(cart) || cart.length === 0) return res.status(400).send("Panier vide");

  (async () => {
    try {
      if (ORDERS_CHANNEL_ID && client.isReady()) {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(()=>null);
        if (!member) return;
        const ticketChannel = await guild.channels.create({
          name: `commande-${username}`.replace(/\s+/g,'-'),
          type: 0,
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
  return res.send("Commande enregistrée (précommande)");
});

// --- Discord Bot ---
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers ],
  partials: [Partials.Channel]
});

// --- Stock embed ---
async function updateStockEmbed() {
  const prices = getPrices();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);
    if (!channel) throw new Error("Stock channel introuvable");

    const embed = new EmbedBuilder()
      .setTitle("📦 Produits disponibles (Précommande)")
      .setColor(0xff0000)
      .setFooter({ text: "ZIKO SHOP" })
      .setTimestamp();

    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      const qty = state[key]?.qty ?? 0;
      embed.addFields({
        name: p.name,
        value: `💰 ${prices[key] ?? "N/A"}€\n📦 ${qty <= 0 ? "Précommande" : `${qty} en stock`}`,
        inline: true
      });
      if (!embed.data.thumbnail) embed.setThumbnail(p.img);
    }

    let msg = null;
    if (stockMessageId) msg = await channel.messages.fetch(stockMessageId).catch(() => null);

    if (msg) await msg.edit({ embeds: [embed] });
    else {
      const m = await channel.send({ embeds: [embed] });
      stockMessageId = m.id;
      state.stockMessageId = stockMessageId;
      saveState(state);
    }

  } catch (e) { console.error("updateStockEmbed error", e); }
}

// --- Admin panel ---
async function ensureAdminPanel(){
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);
    if (!channel) throw new Error("Admin channel introuvable");

    const prices = getPrices();

    const embed = new EmbedBuilder()
      .setTitle("🔧 Panel Admin — Prix (Précommande)")
      .setColor(0xff9900)
      .setDescription(Object.keys(PRODUCTS).map(key => {
        return `**${PRODUCTS[key].name}** — Prix: **${prices[key] ?? "N/A"}€** (Précommande)`;
      }).join("\n"))
      .setTimestamp();

    const options = [];
    for (const key of Object.keys(PRODUCTS)) {
      options.push({ label: `Modifier prix ${PRODUCTS[key].name}`, value: `price_${key}` });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("admin_select_action")
      .setPlaceholder("Choisis une action...")
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    if (adminMessageId) {
      const existing = await channel.messages.fetch(adminMessageId).catch(()=>null);
      if (existing) await existing.edit({ embeds:[embed], components:[row] });
      else { const m = await channel.send({ embeds:[embed], components:[row] }); adminMessageId = m.id; }
    } else {
      const m = await channel.send({ embeds:[embed], components:[row] });
      adminMessageId = m.id;
    }

    state.adminMessageId = adminMessageId;
    saveState(state);

  } catch(e){ console.error("ensureAdminPanel", e); }
}

// --- Interaction ---
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "admin_select_action") {
      const value = interaction.values[0];
      const [action, ...rest] = value.split("_");
      const productId = rest.join("_");

      const modalTitle = `Modifier prix — ${PRODUCTS[productId]?.name || productId}`;
      const modal = new ModalBuilder()
        .setCustomId(`admin_modal_${action}_${productId}`)
        .setTitle(modalTitle);

      const input = new TextInputBuilder()
        .setCustomId("value_input")
        .setLabel("Nouveau prix (€)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Ex: 3.50");

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.showModal(modal);
      }
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit) {
      if (!interaction.customId.startsWith("admin_modal_")) return;

      const parts = interaction.customId.split("_");
      const productId = parts.slice(3).join("_");

      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      if (!member.roles.cache.has(STAFF_ROLE_ID) && !member.permissions.has("ManageGuild")) return;

      const value = interaction.fields.getTextInputValue("value_input").trim();
      const prices = getPrices();

      const num = parseFloat(value.replace(",", "."));
      if (isNaN(num) || num < 0) return;

      prices[productId] = num;
      savePrices(prices);
      await interaction.reply({ content: `Prix de ${PRODUCTS[productId].name} mis à ${num}€`, flags: 64 });
      await updateStockEmbed();
    }

  } catch (err) {
    console.error("interactionCreate error", err);
  }
});

// --- Notification commande ---
async function notifyOrder({ cart, discordId, username, ticketChannel }) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(discordId).catch(()=>null);
  const staffMention = `<@&${STAFF_ROLE_ID}>`;
  const userMention = member ? `<@${member.id}>` : username;

  let total = 0;
  const lines = cart.map(it => { 
    const lineTotal = (it.price ?? 0) * it.qty; 
    total += lineTotal; 
    return `• **${PRODUCTS[it.productId].name}** x${it.qty} — ${lineTotal}€`; 
  });

  const embed = new EmbedBuilder()
    .setTitle("🛒 Nouvelle précommande")
    .setDescription(`${userMention}, merci pour ta précommande !\n\n${lines.join("\n")}\n\n**Total : ${total}€**\n${staffMention} veuillez traiter la commande.`)
    .setColor(0x00cc66)
    .setTimestamp();

  await ticketChannel.send({ content: `${userMention}`, embeds: [embed] });
}

// --- Ready & interval ---
client.once("ready", async () => {
  console.log(`Bot prêt: ${client.user.tag}`);
  await updateStockEmbed();
  await ensureAdminPanel();
  setInterval(async ()=>{ await updateStockEmbed(); }, 60000);
});

// --- Serveur Express ---
app.listen(PORT, ()=> console.log(`API en ligne sur port ${PORT}`));

client.login(DISCORD_TOKEN).catch(err => {
  console.error("Erreur login Discord:", err);
  process.exit(1);
});
