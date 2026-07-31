import http from 'http'
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import TelegramBot from 'node-telegram-bot-api'

// Health Check Server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Bridge Diagnostic Mode')
}).listen(process.env.PORT || 3000)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN'
const PHONE_NUMBER = '919962666671' // Your phone number

const tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true })

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            console.log('\n========================================')
            console.log(' CONNECTED TO WHATSAPP!')
            console.log(' Action needed: Post ANYTHING inside your WhatsApp Channel now.')
            console.log('========================================\n')
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) startBot()
        }
    })

    // RAW EVENT LISTENER - CAPTURES ALL MESSAGES & NEWSLETTER UPDATES
    sock.ev.on('messages.upsert', (m) => {
        m.messages.forEach((msg) => {
            if (msg.key && msg.key.remoteJid) {
                console.log('\n========================================')
                console.log(` DETECTED INCOMING MESSAGE / POST`)
                console.log(` TARGET JID: ${msg.key.remoteJid}`)
                console.log('========================================\n')
            }
        })
    })
}

startBot()