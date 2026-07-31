import http from 'http'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import TelegramBot from 'node-telegram-bot-api'

// --- 1. HEALTH-CHECK SERVER FOR RENDER ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('WhatsApp-Telegram Bridge & Batch Queue Active')
}).listen(process.env.PORT || 3000)

// --- 2. CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'
const CHANNEL_ID = '120363428595746153@newsletter' // Replace with your WhatsApp Channel JID
const PHONE_NUMBER = '919962666671' // Replace with your WhatsApp phone number with country code

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })
let mediaQueue = []

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    })

    sock.ev.on('creds.update', saveCreds)

    // --- 3. WHATSAPP CONNECTION & PAIRING HANDLER ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'connecting' && !sock.authState.creds.registered) {
            console.log("--> Connecting to WhatsApp... Requesting pairing code in 3 seconds...")
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(PHONE_NUMBER)
                    console.log("\n========================================")
                    console.log(`  YOUR WHATSAPP PAIRING CODE: ${code}`)
                    console.log("========================================\n")
                } catch (err) {
                    console.error("--> Error requesting code:", err.message || err)
                }
            }, 3000)
        }

        if (connection === 'open') {
            console.log(' Connected to WhatsApp! Waiting for Telegram posts...')
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    // --- 4. WHATSAPP JID LOGGER (PRINT CHANNEL/CHAT ID IN RENDER LOGS) ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0]
        if (!msg || !msg.key) return

        const id = msg.key.remoteJid
        console.log(`\n========================================`)
        console.log(` RECEIVED MESSAGE FROM JID: ${id}`)
        console.log(`========================================\n`)
    })

    // --- 5. INCOMING TELEGRAM HANDLER (HANDLES CHATS, GROUPS & CHANNELS) ---
    const handleTelegramMsg = async (msg) => {
        console.log("--> Received update from Telegram!")
        try {
            if (msg.photo) {
                const fileId = msg.photo[msg.photo.length - 1].file_id
                const photoUrl = await tgBot.getFileLink(fileId)
                mediaQueue.push({
                    type: 'image',
                    url: photoUrl,
                    caption: msg.caption || ''
                })
                console.log(`[Queue] 📸 Image added! Queue size: ${mediaQueue.length}`)
            } else if (msg.text) {
                mediaQueue.push({
                    type: 'text',
                    text: msg.text
                })
                console.log(`[Queue] 💬 Text added! Queue size: ${mediaQueue.length}`)
            }
        } catch (err) {
            console.error('[Queue Error]:', err.message || err)
        }
    }

    // Listen to direct messages AND channel posts
    tgBot.on('message', handleTelegramMsg)
    tgBot.on('channel_post', handleTelegramMsg)

    // --- 6. 15-MINUTE BATCH QUEUE PROCESSOR ---
    const processQueueBatch = async () => {
        if (mediaQueue.length === 0) {
            console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Queue empty. Skipping execution.`)
            return
        }

        // Pull up to 3 items out of the queue
        const batch = mediaQueue.splice(0, 3)
        console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Processing batch of ${batch.length} item(s)...`)

        for (let i = 0; i < batch.length; i++) {
            const item = batch[i]
            try {
                if (item.type === 'image') {
                    await sock.sendMessage(CHANNEL_ID, {
                        image: { url: item.url },
                        caption: item.caption
                    })
                    console.log(` -> Posted image ${i + 1}/${batch.length}`)
                } else if (item.type === 'text') {
                    await sock.sendMessage(CHANNEL_ID, { text: item.text })
                    console.log(` -> Posted text ${i + 1}/${batch.length}`)
                }
                // 2-second rate limit delay between posts
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (err) {
                console.error(` -> Post failed for item ${i + 1}:`, err.message || err)
            }
        }
        console.log(`[Scheduler] Batch complete. Remaining items in queue: ${mediaQueue.length}`)
    }

    // Run every 15 minutes
    const FIFTEEN_MINUTES = 15 * 60 * 1000
    setInterval(processQueueBatch, FIFTEEN_MINUTES)
}

startBot()