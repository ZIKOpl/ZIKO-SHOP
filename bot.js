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
const STOCK_FILE = path.join(__dirname, "stock.json");
const PRICES_FILE = path.join(__dirname, "prices.json");
const STATE_FILE = path.join(__dirname, "state.json");

// Création des fichiers si inexistants
if (!fs.existsSync(STOCK_FILE)) fs.writeFileSync(STOCK_FILE, JSON.stringify({ nitro1m:0, nitro1y:0, boost1m:0, boost1y:0, serv14b:0 }, null, 2));
if (!fs.existsSync(PRICES_FILE)) fs.writeFileSync(PRICES_FILE, JSON.stringify({ nitro1m:1.5, nitro1y:10, boost1m:3.5, boost1y:30, serv14b:14 }, null, 2));

// --- State helpers ---
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch(e){ return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2), "utf8"); }
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
  boost1m: { name: "Nitro Boost 1 mois", img: `${NETLIFY_ORIGIN}/Assets/nitro3.png` },
  boost1y: { name: "Nitro Boost 1 an", img: `${NETLIFY_ORIGIN}/Assets/nitro4.png` },
  serv14b: { name: "Serv Discord 14 Boost", img: `${NETLIFY_ORIGIN}/Assets/boost.png` }
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
  return res.send("Commande traitée");
});

// --- Discord Bot ---
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers ],
  partials: [Partials.Channel]
});

// --- Embeds ---
async function updateStockEmbed() {
  const stock = getStock();
  const prices = getPrices();
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);
    if (!channel) throw new Error("Stock channel introuvable");

    const embed = new EmbedBuilder()
      .setTitle("📦 Stock actuel")
      .setColor(0x0099ff)
      .setFooter({ text: "ZIKO SHOP" })
      .setTimestamp();

    for (const key of Object.keys(PRODUCTS)) {
      const p = PRODUCTS[key];
      embed.addFields({
        name: p.name,
        value: `💰 ${prices[key] ?? "N/A"}€\n📦 ${stock[key] ?? 0}`,
        inline: true
      });
      if (!embed.data.thumbnail) embed.setThumbnail(p.img);
    }

    let msg = null;
    if (stockMessageId) msg = await channel.messages.fetch(stockMessageId).catch(() => null);
    if (!msg) {
      const messages = await channel.messages.fetch({ limit: 50 });
      msg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0);
    }
    if (msg) await msg.edit({ embeds: [embed] });
    else { const m = await channel.send({ embeds: [embed] }); stockMessageId = m.id; }

    state.stockMessageId = stockMessageId;
    saveState(state);
  } catch (e) { console.error("updateStockEmbed error", e); }
}

async function sendRestockNotification(productId, qty) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(STOCK_CHANNEL_ID);
    if (!channel) return;

    const product = PRODUCTS[productId];
    const stock = getStock();

    const embed = new EmbedBuilder()
      .setTitle("🚨 Restock effectué !")
      .setDescription(`**${product.name}** a été restock.\n📦 Nouveau stock : **${stock[productId]}**\n➕ Quantité ajoutée : **${qty}**`)
      .setColor(0x00ff00)
      .setThumbnail(product.img)
      .setTimestamp();

    const message = await channel.send({ content: "@everyone", embeds: [embed] });
    setTimeout(() => { message.delete().catch(() => {}); }, 3600000);
  } catch (err) { console.error("sendRestockNotification error", err); }
}

async function ensureAdminPanel(){
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);
    if (!channel) throw new Error("Admin channel introuvable");

    const stock = getStock();
    const prices = getPrices();

    const embed = new EmbedBuilder()
      .setTitle("🔧 Panel Admin — Stock & Prix")
      .setColor(0xff9900)
      .setDescription(
        Object.keys(PRODUCTS).map(key => {
          return `**${PRODUCTS[key].name}** — Stock: **${stock[key] ?? 0}** — Prix: **${prices[key] ?? "N/A"}€**`;
        }).join("\n")
      )
      .setTimestamp();

    const options = [];
    for (const key of Object.keys(PRODUCTS)) {
      options.push({ label: `Ajouter ${PRODUCTS[key].name}`, value: `add_${key}` });
      options.push({ label: `Retirer ${PRODUCTS[key].name}`, value: `remove_${key}` });
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
    // Fermeture ticket
    if (interaction.isButton() && interaction.customId === "close_ticket") {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Ticket fermé.", flags: 64 });
      }
      await interaction.channel.delete().catch(()=>{});
      return;
    }

    // Menu admin
    if (interaction.isStringSelectMenu() && interaction.customId === "admin_select_action") {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }

      const value = interaction.values[0];
      const [action, ...rest] = value.split("_");
      const productId = rest.join("_");

      let titleText = action === "price" ? "Modifier prix" : action === "add" ? "Ajouter stock" : "Retirer stock";
      const productName = PRODUCTS[productId]?.name || productId;
      const modalTitle = `${titleText} — ${productName}`;

      const modal = new ModalBuilder()
        .setCustomId(`admin_modal_${action}_${productId}`)
        .setTitle(modalTitle)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("value_input")
              .setLabel(action === "price" ? "Nouveau prix" : "Quantité (entier)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

      return interaction.showModal(modal);
    }

    // Modal submit
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("admin_modal_")) {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      const parts = interaction.customId.split("_");
      const action = parts[2];
      const productId = parts.slice(3).join("_");

      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: "Erreur permissions." });
      if (!member.roles.cache.has(STAFF_ROLE_ID) && !member.permissions.has("ManageGuild")) {
        return interaction.editReply({ content: "Tu n'as pas la permission." });
      }

      const value = interaction.fields.getTextInputValue("value_input").trim();
      const stock = getStock();
      const prices = getPrices();

      if (action === "price") {
        const num = parseFloat(value.replace(",", "."));
        if (isNaN(num) || num < 0) {
          return interaction.editReply({ content: "Prix invalide." });
        }
        prices[productId] = num;
        savePrices(prices);
        await interaction.editReply({ content: `Prix de ${PRODUCTS[productId].name} mis à ${num}€` });
        await updateStockEmbed();

      } else if (action === "add" || action === "remove") {
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty <= 0) {
          return interaction.editReply({ content: "Quantité invalide." });
        }
        stock[productId] = (stock[productId] || 0) + (action === "add" ? qty : -qty);
        if (stock[productId] < 0) stock[productId] = 0;
        saveStock(stock);

        await interaction.editReply({ content: `${action === "add" ? "Ajouté" : "Retiré"} ${qty} à ${PRODUCTS[productId].name}. Nouveau stock: ${stock[productId]}` });
        await updateStockEmbed();
        if (action === "add") {
          await sendRestockNotification(productId, qty);
        }
      }
    }
  } catch (err) {
    console.error("interactionCreate error", err);
    try {
      if (!interaction.replied) await interaction.reply({ content: "Erreur interne.", flags: 64 });
    } catch {}
  }
});

// --- Notifications commandes ---
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
    .setTitle("🛒 Nouvelle commande")
    .setDescription(`${userMention}, merci pour ta commande !\n\n${lines.join("\n")}\n\n**Total : ${total}€**\n${staffMention} veuillez traiter la commande.`)
    .setColor(0x00cc66)
    .setTimestamp();

  await ticketChannel.send({ content: `${userMention}`, embeds: [embed] });
}

// --- Ready ---
client.once("ready", async () => {
  console.log(`Bot prêt: ${client.user.tag}`);
  await updateStockEmbed();
  await ensureAdminPanel();
  setInterval(async ()=>{ await updateStockEmbed(); }, 10000);
});

// --- Serveur Express ---
app.listen(PORT, ()=> console.log(`API en ligne sur port ${PORT}`));
client.login(DISCORD_TOKEN).catch(err => {
  console.error("Erreur login Discord:", err);
  process.exit(1);
});
