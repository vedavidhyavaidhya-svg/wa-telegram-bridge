import http from 'http'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import TelegramBot from 'node-telegram-bot-api'

// --- 1. HEALTH-CHECK SERVER FOR RENDER FREE TIER ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('WhatsApp-Telegram Bridge & Batch Queue is Running!')
}).listen(process.env.PORT || 3000)

// --- 2. CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'
const CHANNEL_ID = '120363428595746153@newsletter' // Replace with your WhatsApp Channel ID
const PHONE_NUMBER = '919962666671' // Replace with your WhatsApp phone number with country code (e.g., 919876543210)

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

// Global queue to hold incoming Telegram posts
let mediaQueue = []

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    })

    sock.ev.on('creds.update', saveCreds)

    // Automatically request a pairing code in Render logs if not logged in
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER)
                console.log(`========================================`)
                console.log(` YOUR WHATSAPP PAIRING CODE: ${code}`)
                console.log(`========================================`)
            } catch (err) {
                console.error('Failed to request pairing code:', err.message || err)
            }
        }, 5000)
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            console.log(' Connected to WhatsApp! Listening for Telegram messages...')
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    // --- 3. LISTEN & QUEUE TELEGRAM MESSAGES ---
    tgBot.on('message', async (msg) => {
        try {
            if (msg.photo) {
                const fileId = msg.photo[msg.photo.length - 1].file_id
                const photoUrl = await tgBot.getFileLink(fileId)
                
                mediaQueue.push({
                    type: 'image',
                    url: photoUrl,
                    caption: msg.caption || ''
                })
                console.log(`[Queue] Image added. Current queue count: ${mediaQueue.length}`)
            } else if (msg.text) {
                mediaQueue.push({
                    type: 'text',
                    text: msg.text
                })
                console.log(`[Queue] Text added. Current queue count: ${mediaQueue.length}`)
            }
        } catch (err) {
            console.error('Error queuing Telegram message:', err.message || err)
        }
    })

    // --- 4. BATCH PROCESSOR (EVERY 15 MINUTES, MAX 3 ITEMS) ---
    const FIFTEEN_MINUTES = 15 * 60 * 1000

    setInterval(async () => {
        if (mediaQueue.length === 0) {
            console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Queue empty. Nothing to post.`)
            return
        }

        // Extract up to 3 items from the front of the queue
        const batch = mediaQueue.splice(0, 3)
        console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Sending batch of ${batch.length} item(s)...`)

        for (let i = 0; i < batch.length; i++) {
            const item = batch[i]
            try {
                if (item.type === 'image') {
                    await sock.sendMessage(CHANNEL_ID, {
                        image: { url: item.url },
                        caption: item.caption
                    })
                    console.log(` -> Posted image ${i + 1} of ${batch.length} to WhatsApp Channel!`)
                } else if (item.type === 'text') {
                    await sock.sendMessage(CHANNEL_ID, { text: item.text })
                    console.log(` -> Posted text ${i + 1} of ${batch.length} to WhatsApp Channel!`)
                }

                // 2-second pause between posts to avoid rate limiting
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (err) {
                console.error(` -> Failed to post item ${i + 1}:`, err.message || err)
            }
        }

        console.log(`[Scheduler] Batch complete. Items remaining in queue: ${mediaQueue.length}`)
    }, FIFTEEN_MINUTES)
}

startBot()