const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info"); // updated
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["Ubuntu", "Chrome", "22.04.4"],
    printQRInTerminal: true, // QR auto-prints in terminal
  });

  // Save session credentials
  sock.ev.on("creds.update", saveCreds);

  // Handle connection status
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
        qr
      )}`;
      console.log("🔗 Scan the QR code using this link: ", qrImageUrl);
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log(
        "Connection closed due to",
        lastDisconnect?.error,
        ", reconnecting:",
        shouldReconnect
      );
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ BOT is online");
    }
  });

  // Welcome message for new group members
  sock.ev.on("group-participants.update", async (update) => {
    if (update.action === "add") {
      for (let participant of update.participants) {
        const name = participant.split("@")[0];
        await sock.sendMessage(update.id, {
          text: `👋 Welcome @${name} to the group!`,
          mentions: [participant],
        });
      }
    }
  });

  // Handle messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const groupId = msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!groupId.endsWith("@g.us") || !text) return;

    if (text === "!hello") {
      await sock.sendMessage(groupId, {
        text: `👋 Hello @${sender.split("@")[0]}!`,
        mentions: [sender],
      });
    } else if (text === "!help") {
      const helpMsg = `🛠 *Available Commands*:\n!hello\n!help\n!admin\n@all\n!download <url>\n!remove <number>`;
      await sock.sendMessage(groupId, { text: helpMsg });
    } else if (text === "!admin") {
      const groupMetadata = await sock.groupMetadata(groupId);
      const isAdmin = groupMetadata.participants.find(
        (p) => p.id === sender && p.admin
      );
      if (isAdmin) {
        await sock.sendMessage(groupId, {
          text: `🫡 Hello Admin @${sender.split("@")[0]}`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(groupId, {
          text: `🚫 You must be an admin to use this command.`,
        });
      }
    } else if (text === "@all") {
      const groupMetadata = await sock.groupMetadata(groupId);
      const mentions = groupMetadata.participants.map((p) => p.id);
      let msgText = "📢 @all\n";
      for (let p of mentions) {
        msgText += `@${p.split("@")[0]} `;
      }
      await sock.sendMessage(groupId, {
        text: msgText,
        mentions,
      });
    } else if (text.startsWith("!download ")) {
      const url = text.split(" ")[1];
      if (!url) return;
      try {
        const res = await axios.get(
          `https://api.snaptik.link/api/tiktok?url=${encodeURIComponent(url)}`
        );
        if (res.data && res.data.status === "ok" && res.data.data?.video?.url) {
          const fileUrl = res.data.data.video.url;
          await sock.sendMessage(groupId, {
            video: { url: fileUrl },
            caption: "📥 Downloaded media:",
          });
        } else {
          await sock.sendMessage(groupId, {
            text: "❌ Failed to download media.",
          });
        }
      } catch (err) {
        console.error("Download error:", err.message);
        await sock.sendMessage(groupId, {
          text: "❌ Error downloading media.",
        });
      }
    } else if (text.startsWith("!remove ")) {
      const groupMetadata = await sock.groupMetadata(groupId);
      const isAdmin = groupMetadata.participants.find(
        (p) => p.id === sender && p.admin
      );
      if (!isAdmin) {
        await sock.sendMessage(groupId, {
          text: "🚫 Only admins can use this command.",
        });
        return;
      }
      const targetNumber = text.split(" ")[1].replace(/[^0-9]/g, "");
      if (!targetNumber) return;
      const participantId = `${targetNumber}@s.whatsapp.net`;
      await sock.groupParticipantsUpdate(groupId, [participantId], "remove");
    }
  });
}

startBot();
