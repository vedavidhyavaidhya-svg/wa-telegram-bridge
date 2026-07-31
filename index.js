import http from 'http'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import TelegramBot from 'node-telegram-bot-api'

// --- 1. HEALTH-CHECK SERVER FOR RENDER ---
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('WhatsApp-Telegram Bridge & Batch Queue is Running!')
}).listen(process.env.PORT || 3000)

// --- 2. CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'
const CHANNEL_ID = '120363428595746153@newsletter' // Your WhatsApp Channel ID
const PHONE_NUMBER = '919962666671' // Your WhatsApp phone number (e.g. 919876543210)

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })
let mediaQueue = []

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    })

    sock.ev.on('creds.update', saveCreds)

    // LISTEN FOR CONNECTION STATUS
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // Request Pairing Code ONLY when socket gives connecting signal and isn't registered
        if (connection === 'connecting' && !sock.authState.creds.registered) {
            console.log("--> Socket connecting... Requesting pairing code in 3 seconds...")
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
            console.log(' Connected to WhatsApp! Listening for Telegram posts...')
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    // --- 3. QUEUE TELEGRAM POSTS ---
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
                console.log(`[Queue] Image added. Count: ${mediaQueue.length}`)
            } else if (msg.text) {
                mediaQueue.push({
                    type: 'text',
                    text: msg.text
                })
                console.log(`[Queue] Text added. Count: ${mediaQueue.length}`)
            }
        } catch (err) {
            console.error('Queue error:', err.message || err)
        }
    })

    // --- 4. 15-MINUTE BATCH PROCESSOR (MAX 3 ITEMS) ---
    const FIFTEEN_MINUTES = 15 * 60 * 1000

    setInterval(async () => {
        if (mediaQueue.length === 0) {
            console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Queue empty.`)
            return
        }

        const batch = mediaQueue.splice(0, 3)
        console.log(`[Scheduler] ${new Date().toLocaleTimeString()} - Processing ${batch.length} item(s)...`)

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
                await new Promise((resolve) => setTimeout(resolve, 2000))
            } catch (err) {
                console.error(` -> Post error item ${i + 1}:`, err.message || err)
            }
        }
    }, FIFTEEN_MINUTES)
}

startBot()