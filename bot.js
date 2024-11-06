const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const BACKUP_PATH = './whatsapp-backup/chats';

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one" }) // Gerenciamento de sessão local
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente pronto!');
});

client.on('message', async msg => {
    const chatId = msg.from;
    const chatPath = path.join(BACKUP_PATH, chatId);
    const mediaPath = path.join(chatPath, 'media');

    // Verifica e cria a pasta do chat e subpasta de mídia, se necessário
    if (!fs.existsSync(chatPath)) {
        fs.mkdirSync(chatPath, { recursive: true });
    }
    if (!fs.existsSync(mediaPath)) {
        fs.mkdirSync(mediaPath, { recursive: true });
    }

    // Salva a mensagem no arquivo messages.json
    const messageData = {
        id: msg.id._serialized,
        timestamp: msg.timestamp,
        from: msg.from,
        to: msg.to,
        author: msg.author || null,
        body: msg.body,
        type: msg.type,
        hasMedia: msg.hasMedia || false
    };

    const messagesFile = path.join(chatPath, 'messages.json');
    let messages = [];

    if (fs.existsSync(messagesFile)) {
        const messagesContent = fs.readFileSync(messagesFile, 'utf8');
        messages = JSON.parse(messagesContent);
    }

    messages.push(messageData);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));

    // Se a mensagem tiver mídia, faz o download e salva na pasta correspondente
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const timestamp = Date.now();

        let mediaFileName;
        switch (msg.type) {
            case 'image':
                mediaFileName = `image_${timestamp}.jpg`;
                break;
            case 'video':
                mediaFileName = `video_${timestamp}.mp4`;
                break;
            case 'audio':
                mediaFileName = `audio_${timestamp}.ogg`;
                break;
            case 'document':
                mediaFileName = `document_${timestamp}.${media.mimetype.split('/')[1]}`;
                break;
            default:
                mediaFileName = `file_${timestamp}`;
        }

        const mediaFilePath = path.join(mediaPath, mediaFileName);
        fs.writeFileSync(mediaFilePath, media.data, { encoding: 'base64' });
        console.log(`Mídia salva em ${mediaFilePath} do chat: ${msg.from}`);
    }
});

client.on('authenticated', (session) => {
    console.log('Sessão autenticada!');
});

client.on('auth_failure', () => {
    console.error('Falha na autenticação. Verifique o QR Code.');
});

client.initialize();