// Global error handlers - Letakkan di bagian paling atas
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection:", reason);
});

// Fix crypto global untuk Baileys di Docker
global.crypto = require('crypto');

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const multer = require('multer');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@itsukichan/baileys');
const { Boom } = require('@hapi/boom');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3980;

app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'assets');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image and video files are allowed!'));
        }
    }
});

let sock = null;
let botRunning = false;
let shouldStop = false;
let currentQR = null;
let logs = [];
let isConnecting = false;
let isWhatsAppReady = false;


const CONFIG = {
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: true,
    browser: ['Ubuntu', 'Chrome', '110.0.0.0']
};

let MessagesConfig = {};
try {
    const messagesData = fs.readFileSync('messages.json', 'utf8');
    MessagesConfig = JSON.parse(messagesData);
} catch (error) {
    console.error('❌ Error loading messages.json:', error.message);
}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPhoneNumber(phone) {
    const cleanPhone = phone.replace(/\D/g, '');

    if (phone.includes('@s.whatsapp.net')) {
        return phone;
    }

    let formattedPhone = cleanPhone.startsWith('+') ? cleanPhone.substring(1) : cleanPhone;

    if (!formattedPhone.startsWith('55') && formattedPhone.length >= 10) {
        formattedPhone = '55' + formattedPhone;
    }

    return formattedPhone + '@s.whatsapp.net';
}

const getRandomDelay = (minSeconds, maxSeconds) => {
    const minMs = minSeconds * 1000;
    const maxMs = maxSeconds * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
};

const detectMediaType = (filePath) => {
    const extension = filePath.toLowerCase().split('.').pop();
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'webm', '3gp'];

    if (imageExtensions.includes(extension)) {
        return 'image';
    } else if (videoExtensions.includes(extension)) {
        return 'video';
    } else {
        throw new Error(`Unsupported file type: ${extension}`);
    }
};

const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const logEntry = { timestamp, message, type };
    logs.push(logEntry);

    // Console log with color
    const colors = {
        info: '\x1b[36m',    // Cyan
        success: '\x1b[32m', // Green
        warning: '\x1b[33m', // Yellow
        error: '\x1b[31m'    // Red
    };
    const reset = '\x1b[0m';
    console.log(`${colors[type] || colors.info}[${timestamp}] ${message}${reset}`);

    if (logs.length > 100) {
        logs = logs.slice(-100);
    }

    io.emit('log', logEntry);
};


async function iniciarConexaoWhatsApp() {
    if (isConnecting || sock) {
        addLog('⚠️ Connection already in progress or active', 'warning');
        return;
    }

    try {
        isConnecting = true;
        addLog('� Initializing WhatsApp Web connection...', 'info');

        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        sock = makeWASocket({ auth: state, ...CONFIG });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                addLog('📱 QR Code ready - Please scan with WhatsApp mobile app', 'info');
                qrcode.toDataURL(qr).then(qrDataURL => {
                    currentQR = qrDataURL;
                    io.emit('qr', qrDataURL);
                });
            }

            if (connection === 'close') {
                isConnecting = false;
                isWhatsAppReady = false;
                sock = null;
                io.emit('disconnected');
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    addLog('🔄 Connection lost - Attempting to reconnect in 5 seconds...', 'warning');
                    setTimeout(iniciarConexaoWhatsApp, 5000);
                }
            }

            if (connection === 'open') {
                isConnecting = false;
                isWhatsAppReady = true;
                currentQR = null;
                io.emit('qr', null);
                io.emit('ready');
                addLog('✅ WhatsApp Web connected successfully - Bot is ready!', 'success');
                // const jids = [
                //     '6287884717861@s.whatsapp.net',
                //     '62895337337339@s.whatsapp.net'
                // ]
                // sock.sendStatusMentions(
                //     {
                //         text: 'Hello Everyone :3',
                //         font: 2, // optional
                //         textColor: 'FF0000', // optional
                //         backgroundColor: '#000000' // optional
                //     },
                //     jids // Limit to 5 mentions per status
                // ).then(() => {
                //     addLog('✅ Status mention sent on connection!', 'success');
                // }).catch((err) => {
                //     addLog(`❌ Failed to send status mention: ${err.message}`, 'error');
                // });
            }
        });

        sock.ev.on('creds.update', saveCreds);
        await sock.waitForSocketOpen();

    } catch (error) {
        isConnecting = false;
        sock = null;
        addLog(`❌ Connection failed: ${error.message}`, 'error');
        addLog('🔄 Retrying connection in 5 seconds...', 'warning');
        setTimeout(iniciarConexaoWhatsApp, 5000);
    }
}
// === Rota nova para listar grupos da sessão ===
app.get('/api/groups', async (req, res) => {
    try {
        if (!sock) {
            return res.json({ success: false, message: 'No active session', groups: [] });
        }

        const chats = await sock.groupFetchAllParticipating();
        const groups = Object.values(chats).map(group => ({
            id: group.id,
            subject: group.subject,
            participants: group.participants.length
        }));

        res.json({ success: true, groups });
    } catch (error) {
        addLog(`❌ Error listing groups: ${error.message}`, 'error');
        res.status(500).json({ success: false, message: error.message, groups: [] });
    }
});
// ==============================================
async function iniciarBot() {
    try {
        if (!sock) {
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            sock = makeWASocket({ auth: state, ...CONFIG });

            sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    addLog('📱 QR Code generated, scan it in WhatsApp', 'info');
                    qrcode.toDataURL(qr).then(qrDataURL => {
                        currentQR = qrDataURL;
                        io.emit('qr', qrDataURL);
                    });
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                    if (shouldReconnect) setTimeout(iniciarBot, 5000);
                }

                if (connection === 'open') {
                    currentQR = null;
                    io.emit('qr', null);
                    enviarStatusMention(sock);
                }
            });

            sock.ev.on('creds.update', saveCreds);
            await sock.waitForSocketOpen();
        } else {
            enviarStatusMention(sock);
        }

    } catch (error) {
        setTimeout(iniciarBot, 5000);
    }
}

async function enviarStatusMention(sock) {
    if (shouldStop) {
        addLog('⏹️ Sending cancelled by user', 'info');
        return;
    }

    const messageSelection = MessagesConfig.settings.messageSelection;
    const mentionMode = MessagesConfig.settings.mentionMode || 'grouped';
    let activeMessageIndex;

    if (messageSelection.mode === "random") {
        activeMessageIndex = Math.floor(Math.random() * MessagesConfig.messages.length);
        addLog('🎲 Mode: Random', 'info');
    } else {
        activeMessageIndex = messageSelection.fixedIndex;
        addLog('📍 Mode: Fixed', 'info');
    }

    const message = MessagesConfig.messages[activeMessageIndex];

    let recipients = [];
    if (MessagesConfig.settings.useGroup && MessagesConfig.settings.groupJid) {
        try {
            const groupMetadata = await sock.groupMetadata(MessagesConfig.settings.groupJid);
            recipients = groupMetadata.participants.map(p => p.id);
            addLog(`👥 Found ${recipients.length} members in group "${groupMetadata.subject}"`, 'info');

            // 🔹 New behavior: mention inside the group
            if (MessagesConfig.settings.mentionInsideGroup) {
                let messageContent = {};

                if (message.media.enabled) {
                    let mediaPath = message.media.path;

                    if (mediaPath.startsWith('/assets/')) {
                        mediaPath = path.join(__dirname, 'public', 'assets', mediaPath.replace('/assets/', ''));
                    }

                    if (!fs.existsSync(mediaPath)) {
                        throw new Error(`Media file not found: ${mediaPath}`);
                    }

                    const mediaType = detectMediaType(mediaPath);

                    if (mediaType === "image") {
                        messageContent = {
                            image: { url: mediaPath },
                            caption: message.text,
                            mentions: recipients
                        };
                    } else if (mediaType === "video") {
                        messageContent = {
                            video: { url: mediaPath },
                            caption: message.text,
                            mentions: recipients
                        };
                    }
                } else {
                    messageContent = {
                        text: message.text,
                        mentions: recipients
                    };
                }

                addLog(`📢 Sending message with mentions to group "${groupMetadata.subject}"...`, 'info');
                await sock.sendMessage(MessagesConfig.settings.groupJid, messageContent);
                addLog(`✅ Message delivered successfully to group "${groupMetadata.subject}"`, 'success');
                return; // does not proceed to private status mentions
            }
        } catch (err) {
            addLog(`❌ Error loading group members: ${err.message}`, 'error');
            return;
        }
    } else {
        recipients = MessagesConfig.recipients.map(phone => formatPhoneNumber(phone));
    }

    addLog(`🚀 Preparing to send status mentions to ${recipients.length} recipient(s)`, 'info');
    addLog(`📋 Selected message: "${message.name}"`, 'info');
    addLog(`📱 Mode: ${mentionMode === 'grouped' ? 'Grouped (5 mentions per status)' : 'Single status (all mentions at once)'}`, 'info');

    try {
        io.emit('progress', {
            text: `📋 Preparing ${message.name} | 👥 ${recipients.length} recipients | 📱 Mode: ${mentionMode === 'grouped' ? 'Grouped' : 'Single'}`,
            percent: 10
        });

        let messageContent = {};

        if (message.media.enabled) {
            let mediaPath = message.media.path;

            if (mediaPath.startsWith('/assets/')) {
                mediaPath = path.join(__dirname, 'public', 'assets', mediaPath.replace('/assets/', ''));
            }

            if (!fs.existsSync(mediaPath)) {
                throw new Error(`Media file not found: ${mediaPath}`);
            }

            const mediaType = detectMediaType(mediaPath);

            if (mediaType === "image") {
                messageContent = {
                    image: { url: mediaPath },
                    caption: message.text
                };
            } else if (mediaType === "video") {
                messageContent = {
                    video: { url: mediaPath },
                    caption: message.text
                };
            }
        } else {
            messageContent = {
                text: message.text,
                font: Math.floor(Math.random() * 9),
                backgroundColor: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
            };
        }

        if (mentionMode === 'grouped') {
            await enviarStatusGrouped(sock, recipients);
        } else {
            await enviarStatusUnico(sock, messageContent, recipients);
        }

    } catch (error) {
        addLog(`❌ Error sending: ${error.message}`, 'error');
        io.emit('progress', { text: 'Error sending!', percent: 0, hide: true });
        setTimeout(() => {
            io.emit('progress', { text: '', percent: 0, hide: true });
        }, 2000);
    }
}




async function enviarStatusGrouped(sock, recipients) {
    const maxMentionsPerStory = 5;
    const totalRecipients = recipients.length;
    const totalStories = Math.ceil(totalRecipients / maxMentionsPerStory);

    addLog(`📊 Creating ${totalStories} status(es) for ${totalRecipients} recipient(s)`, 'info');
    addLog(`📝 Using ${maxMentionsPerStory} mentions per status (WhatsApp recommended limit)`, 'info');

    for (let storyIndex = 0; storyIndex < totalStories; storyIndex++) {
        if (shouldStop) {
            addLog('⏹️ Sending interrupted by user', 'info');
            io.emit('progress', { text: 'Sending interrupted!', percent: 0, hide: true });
            return;
        }

        const startIndex = storyIndex * maxMentionsPerStory;
        const endIndex = Math.min(startIndex + maxMentionsPerStory, totalRecipients);
        const storyRecipients = recipients.slice(startIndex, endIndex);

        addLog(`📱 Creating status ${storyIndex + 1} of ${totalStories}...`, 'info');
        addLog(`👥 This status will mention ${storyRecipients.length} people (recipients ${startIndex + 1}-${endIndex})`, 'info');

        // Draw message for this story (random mode) or use fixed
        let messageContent = {};
        const messageSelection = MessagesConfig.settings.messageSelection;
        let activeMessageIndex;

        if (messageSelection.mode === "random") {
            activeMessageIndex = Math.floor(Math.random() * MessagesConfig.messages.length);
            addLog(`🎲 Status ${storyIndex + 1}: Using random message selection`, 'info');
        } else {
            activeMessageIndex = messageSelection.fixedIndex;
            addLog(`📍 Status ${storyIndex + 1}: Using fixed message`, 'info');
        }

        const message = MessagesConfig.messages[activeMessageIndex];
        addLog(`📋 Status ${storyIndex + 1}: Message "${message.name}" selected`, 'info');

        // Preparar conteúdo da mensagem
        if (message.media.enabled) {
            let mediaPath = message.media.path;

            if (mediaPath.startsWith('/assets/')) {
                mediaPath = path.join(__dirname, 'public', 'assets', mediaPath.replace('/assets/', ''));
            }

            if (!fs.existsSync(mediaPath)) {
                throw new Error(`Media file not found: ${mediaPath}`);
            }

            const mediaType = detectMediaType(mediaPath);

            if (mediaType === "image") {
                messageContent = {
                    image: { url: mediaPath },
                    caption: message.text
                };
            } else if (mediaType === "video") {
                messageContent = {
                    video: { url: mediaPath },
                    caption: message.text
                };
            }
        } else {
            messageContent = {
                text: message.text,
                font: Math.floor(Math.random() * 9),
                backgroundColor: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
            };
        }

        const progressStart = Math.floor((storyIndex / totalStories) * 100);
        io.emit('progress', {
            text: `📱 Story ${storyIndex + 1}/${totalStories} | 👥 ${storyRecipients.length} recipients | 📋 ${message.name}`,
            percent: progressStart
        });

        // Send status with media
        io.emit('progress', {
            text: `📤 Creating story ${storyIndex + 1}/${totalStories} with media...`,
            percent: progressStart + 2
        });

        await sock.sendMessage(
            "status@broadcast",
            messageContent,
            {
                broadcast: true,
                statusJidList: storyRecipients
            }
        );

        addLog(`📤 Status ${storyIndex + 1} posted successfully`, 'success');

        // Send mentions for this story
        addLog(`📨 Sending ${storyRecipients.length} mention(s) for status ${storyIndex + 1}...`, 'info');

        // Send all mentions at once for this story (limit 5 per story)
        await sock.sendStatusMentions(messageContent, storyRecipients);

        addLog(`✅ All ${storyRecipients.length} mention(s) sent for status ${storyIndex + 1}`, 'success');

        // Update progress after all mentions sent
        const progressAfterMentions = progressStart + Math.floor((100 / totalStories));
        io.emit('progress', {
            text: `📱 Story ${storyIndex + 1}/${totalStories} | ✅ ${storyRecipients.length} mentions sent | 📋 ${message.name}`,
            percent: Math.min(95, progressAfterMentions)
        });

        addLog(`🎉 Status ${storyIndex + 1} of ${totalStories} completed successfully!`, 'success');

        // Delay between stories (except the last one)
        if (storyIndex < totalStories - 1) {
            const delayBetweenStories = getRandomDelay(MessagesConfig.settings.delay.min, MessagesConfig.settings.delay.max);
            addLog(`⏱️ Waiting ${delayBetweenStories / 1000} seconds before creating next status...`, 'info');

            io.emit('progress', {
                text: `⏱️ Waiting ${delayBetweenStories / 1000}s before Story ${storyIndex + 2}/${totalStories} | 🎉 Story ${storyIndex + 1} completed`,
                percent: Math.min(95, Math.floor(((storyIndex + 1) / totalStories) * 100))
            });

            await sleep(delayBetweenStories);
        }
    }

    addLog('🎊 All status mentions sent successfully! Campaign completed.', 'success');
    io.emit('progress', { text: 'Completed!', percent: 100 });

    setTimeout(() => {
        io.emit('progress', { text: '', percent: 0, hide: true });
    }, 3000);
}

async function enviarStatusUnico(sock, messageContent, recipients) {
    const totalRecipients = recipients.length;

    addLog(`📱 Creating single status for all ${totalRecipients} recipient(s)`, 'info');

    io.emit('progress', { text: `📱 Single story | 👥 ${totalRecipients} recipients | 📋 Preparing media...`, percent: 30 });

    // Send status with media
    io.emit('progress', { text: `📤 Creating single story with media... | 👥 ${totalRecipients} recipients`, percent: 35 });

    await sock.sendMessage(
        "status@broadcast",
        messageContent,
        {
            broadcast: true,
            statusJidList: recipients
        }
    );

    addLog('📤 Status posted successfully', 'success');
    io.emit('progress', { text: `📤 Status created! | 📨 Sending mentions... | 👥 ${totalRecipients} recipients`, percent: 50 });

    // Send mentions
    addLog(`📨 Sending all ${totalRecipients} mention(s) in single status...`, 'info');
    io.emit('progress', { text: `📨 Sending mentions... | 👥 ${totalRecipients} recipients`, percent: 55 });

    await sock.sendStatusMentions(messageContent, recipients);

    addLog(`✅ ${totalRecipients} mentions sent successfully!`, 'success');
    io.emit('progress', { text: `✅ Completed! | 👥 ${totalRecipients} mentions sent`, percent: 100 });

    setTimeout(() => {
        io.emit('progress', { text: '', percent: 0, hide: true });
    }, 3000);
}


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/config', (req, res) => {
    res.json(MessagesConfig);
});

app.post('/api/config', (req, res) => {
    try {
        MessagesConfig = req.body;
        fs.writeFileSync('messages.json', JSON.stringify(MessagesConfig, null, 4));
        addLog('💾 Configuration saved successfully', 'success');
        res.json({ success: true });
    } catch (error) {
        addLog(`❌ Failed to save configuration: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/start-connection', (req, res) => {
    if (sock || isConnecting) {
        return res.json({ success: false, message: 'WhatsApp connection is already active or in progress' });
    }

    iniciarConexaoWhatsApp();
    res.json({ success: true });
});

app.post('/api/start', (req, res) => {
    if (botRunning) {
        return res.json({ success: false, message: 'Bot is already running' });
    }

    botRunning = true;
    shouldStop = false;
    addLog('🚀 Bot started - Beginning to send status mentions...', 'info');
    iniciarBot();
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    if (!botRunning) {
        return res.json({ success: false, message: 'Bot is not running' });
    }

    shouldStop = true;
    botRunning = false;
    if (sock) {
        sock.end();
        sock = null;
        isWhatsAppReady = false;
    }
    addLog('⏹️ Bot stopped by user', 'warning');
    res.json({ success: true });
});

app.post('/api/disconnect', (req, res) => {
    if (sock) {
        sock.end();
        sock = null;
        isWhatsAppReady = false;
        isConnecting = false;
        currentQR = null;
        io.emit('qr', null);
        addLog('🔌 WhatsApp disconnected successfully', 'success');
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'No active connection' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        running: botRunning,
        hasSession: fs.existsSync('auth_info_baileys/creds.json'),
        isConnecting: isConnecting,
        isConnected: !!sock,
        shouldStop: shouldStop,
        qr: currentQR
    });
});

app.get('/api/logs', (req, res) => {
    res.json(logs);
});

app.post('/api/clear-logs', (req, res) => {
    try {
        logs = [];
        io.emit('logs-cleared');
        res.json({ success: true });
    } catch (error) {
        addLog(`❌ Error clearing logs: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/upload', upload.single('media'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });
        }

        const fileUrl = `/assets/${req.file.filename}`;
        addLog(`📁 Media uploaded: "${req.file.originalname}" (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`, 'success');

        res.json({
            success: true,
            message: 'File uploaded successfully',
            fileUrl: fileUrl,
            fileName: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        addLog(`❌ Error uploading file: ${error.message}`, 'error');
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/media', (req, res) => {
    try {
        const assetsDir = path.join(__dirname, 'public', 'assets');
        if (!fs.existsSync(assetsDir)) {
            return res.json({ success: true, files: [] });
        }

        const files = fs.readdirSync(assetsDir).map(file => {
            const filePath = path.join(assetsDir, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                url: `/assets/${file}`,
                size: stats.size,
                created: stats.birthtime
            };
        });

        res.json({ success: true, files: files });
    } catch (error) {
        addLog(`❌ Error listing media: ${error.message}`, 'error');
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/shutdown', (req, res) => {
    try {
        addLog('🔄 Shutting down application...', 'warning');

        if (botRunning) {
            shouldStop = true;
            botRunning = false;
            if (sock) {
                sock.end();
                sock = null;
            }
        }

        if (sock) {
            sock.logout();
        }

        res.json({ success: true, message: 'Application shut down successfully' });

        setTimeout(() => {
            addLog('✅ Application shut down', 'info');
            process.exit(0);
        }, 1000);

    } catch (error) {
        addLog(`❌ Error shutting down application: ${error.message}`, 'error');
        res.status(500).json({ success: false, message: error.message });
    }
});

// Test routes for simple status mention testing
app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get('/api/test/status', (req, res) => {
    res.json({
        connected: isWhatsAppReady && !!sock,
        isConnecting: isConnecting
    });
});

app.post('/api/test/connect', async (req, res) => {
    try {
        if (sock) {
            io.emit('test-log', { message: 'Already connected!', type: 'success' });
            return res.json({ success: true, message: 'Already connected' });
        }

        io.emit('test-log', { message: 'Starting WhatsApp connection...', type: 'info' });
        await iniciarConexaoWhatsApp();
        res.json({ success: true, message: 'Connection initiated' });
    } catch (error) {
        io.emit('test-log', { message: 'Connection error: ' + error.message, type: 'error' });
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/test/upload', upload.single('media'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const filePath = '/assets/' + req.file.filename;
        io.emit('test-log', { message: `Media uploaded: ${req.file.filename}`, type: 'success' });

        res.json({
            success: true,
            path: filePath,
            filename: req.file.filename,
            size: req.file.size
        });
    } catch (error) {
        io.emit('test-log', { message: 'Upload error: ' + error.message, type: 'error' });
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/test/send', async (req, res) => {
    try {
        const { jids, text, messageType = 'text', mediaPath } = req.body;

        if (!sock || !isWhatsAppReady) {
            return res.status(400).json({ success: false, message: 'WhatsApp not connected' });
        }

        if (!jids || !Array.isArray(jids) || jids.length === 0) {
            return res.status(400).json({ success: false, message: 'Phone numbers array is required' });
        }

        // Format phone numbers (remove spaces, special chars, add @s.whatsapp.net)
        const formattedJids = jids
            .map(phone => {
                // Clean the phone number
                let cleaned = phone.replace(/[^0-9]/g, '');

                // Skip if empty
                if (!cleaned) return null;

                // Return formatted JID for personal numbers only
                return cleaned + '@s.whatsapp.net';
            })
            .filter(jid => jid !== null);

        if (formattedJids.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid phone numbers provided' });
        }

        io.emit('test-log', { message: `Sending to ${formattedJids.length} targets...`, type: 'info' });

        let messageContent = {};

        // Prepare message content based on type
        if (messageType === 'text') {
            if (!text) {
                return res.status(400).json({ success: false, message: 'Text is required' });
            }
            messageContent = {
                text: text,
                font: Math.floor(Math.random() * 9),
                backgroundColor: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")
            };
        } else if (messageType === 'image') {
            if (!mediaPath) {
                return res.status(400).json({ success: false, message: 'Media path is required' });
            }
            const fullPath = path.join(__dirname, 'public', 'assets', mediaPath.replace('/assets/', ''));

            if (!fs.existsSync(fullPath)) {
                return res.status(400).json({ success: false, message: 'Media file not found' });
            }

            messageContent = {
                image: { url: fullPath },
                caption: text || ''
            };
        } else if (messageType === 'video') {
            if (!mediaPath) {
                return res.status(400).json({ success: false, message: 'Media path is required' });
            }
            const fullPath = path.join(__dirname, 'public', 'assets', mediaPath.replace('/assets/', ''));

            if (!fs.existsSync(fullPath)) {
                return res.status(400).json({ success: false, message: 'Media file not found' });
            }

            messageContent = {
                video: { url: fullPath },
                caption: text || ''
            };
        }

        io.emit('test-log', { message: 'Calling sendStatusMentions...', type: 'info' });

        // Call sendStatusMentions with correct API (use formattedJids)
        const result = await sock.sendStatusMentions(messageContent, formattedJids);

        io.emit('test-log', { message: 'Status mention sent successfully!', type: 'success' });
        io.emit('test-log', { message: `Result: ${JSON.stringify(result)}`, type: 'info' });

        res.json({
            success: true,
            message: `Status mention sent to ${formattedJids.length} targets!`,
            details: `Type: ${messageType}${messageType === 'text' ? `, Font: ${messageContent.font}, BG: ${messageContent.backgroundColor}` : ''}`
        });

    } catch (error) {
        io.emit('test-log', { message: 'Error: ' + error.message, type: 'error' });
        io.emit('test-log', { message: 'Stack: ' + error.stack, type: 'error' });
        res.status(500).json({ success: false, message: error.message });
    }
});


io.on('connection', (socket) => {
    socket.emit('logs', logs);

    if (currentQR) {
        socket.emit('qr', currentQR);
    }

    socket.on('disconnect', () => {
    });
});

iniciarConexaoWhatsApp();
server.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🌐 Story Mentions Bot - Server Started`);
    console.log(`📍 Local: http://localhost:${PORT}`);
    console.log(`⏰ Time: ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(50)}\n`);
    addLog(`🌐 Server started successfully on port ${PORT}`, 'success');
});
