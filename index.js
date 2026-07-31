import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import TelegramBot from 'node-telegram-bot-api'

// --- CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'
const CHANNEL_ID = '120363XXXXXXXXX@newsletter' // Paste your resolved WhatsApp Channel ID here

// Initialize Telegram Bot (Polling mode)
const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

async function startBot() {
    // Uses the saved session in auth_info
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const sock = makeWASocket({ auth: state, printQRInTerminal: false })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            console.log(' Connected to WhatsApp and listening for Telegram posts...')
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    // Listen for incoming messages/channel posts from Telegram
    tgBot.on('message', async (msg) => {
        try {
            // Case 1: Photo message
            if (msg.photo) {
                // Get highest resolution photo URL from Telegram
                const fileId = msg.photo[msg.photo.length - 1].file_id
                const photoUrl = await tgBot.getFileLink(fileId)

                await sock.sendMessage(CHANNEL_ID, {
                    image: { url: photoUrl },
                    caption: msg.caption || ''
                })
                console.log(' Forwarded photo + caption to WhatsApp Channel!')
            } 
            // Case 2: Plain text message
            else if (msg.text) {
                await sock.sendMessage(CHANNEL_ID, {
                    text: msg.text
                })
                console.log(' Forwarded text message to WhatsApp Channel!')
            }
        } catch (err) {
            console.error(' Failed to forward message:', err.message || err)
        }
    })
}

startBot()