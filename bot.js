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

// Captura todas as mensagens, incluindo as enviadas pelo próprio usuário
client.on('message_create', async msg => {
    const chatId = msg.fromMe ? msg.to : msg.from;
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
        fromMe: msg.fromMe, // Identifica se a mensagem foi enviada pelo próprio usuário
        hasMedia: msg.hasMedia || false,
        mediaFileName: null // Campo para associar a mídia, caso exista
    };

    const messagesFile = path.join(chatPath, 'messages.json');
    let messages = [];

    if (fs.existsSync(messagesFile)) {
        const messagesContent = fs.readFileSync(messagesFile, 'utf8');
        messages = JSON.parse(messagesContent);
    }

    // Se a mensagem tiver mídia, faz o download e salva com o nome do ID
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        
        // Define a extensão de acordo com o tipo MIME da mídia, pegando apenas a primeira parte antes de ";"
        const mimeExtension = media.mimetype.split('/')[1].split(';')[0];
        const mediaFileName = `${msg.id._serialized}.${mimeExtension}`;
        const mediaFilePath = path.join(mediaPath, mediaFileName);

        // Salva a mídia no caminho correto
        fs.writeFileSync(mediaFilePath, media.data, { encoding: 'base64' });
        console.log(`Mídia salva em ${mediaFilePath} do chat: ${msg.from}`);

        // Atualiza o campo mediaFileName para associar com a mensagem
        messageData.mediaFileName = mediaFileName;
    }

    // Adiciona a mensagem ao arquivo JSON
    messages.push(messageData);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
});

client.on('authenticated', () => {
    console.log('Sessão autenticada!');
});

client.on('auth_failure', () => {
    console.error('Falha na autenticação. Verifique o QR Code.');
});

client.initialize();