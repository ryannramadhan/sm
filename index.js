const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

const CONFIG = {
    printQRInTerminal: true,
    markOnlineOnConnect: false,
    syncFullHistory: true,
    browser: ['Ubuntu', 'Chrome', '110.0.0.0']
};

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({ auth: state, ...CONFIG });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'open') {
            console.log('✅ Device connected! Sending status mention...');
            try {
                await sock.sendStatusMentions(
                    {
                        text: 'Hello',
                    },
                    [
                        '6287884717861@s.whatsapp.net',
                    ]
                );
                console.log('✅ Status mention sent!');
            } catch (err) {
                console.error('❌ Failed to send status mention:', err.message);
            }
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                start();
            } else {
                console.log('❌ Connection closed. Not reconnecting.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

start();
