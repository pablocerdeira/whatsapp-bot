const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

let config = loadConfig();  // Carrega a configuração inicial

const BACKUP_PATH = './whatsapp-backup/chats';

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one" })
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente pronto!');
    watchConfigFile();  // Monitora o arquivo de configuração
});

// Função para carregar configurações
function loadConfig() {
    try {
        const configData = fs.readFileSync('./config.json', 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('Erro ao carregar o arquivo de configuração:', error);
        return {};
    }
}

// Monitora o arquivo de configuração por alterações
function watchConfigFile() {
    fs.watchFile('./config.json', (curr, prev) => {
        console.log('Arquivo de configuração atualizado. Recarregando...');
        config = loadConfig();  // Recarrega as configurações
    });
}

// Função para salvar a mensagem no arquivo JSON do chat
function saveMessageToFile(chatPath, messageData) {
    const messagesFile = path.join(chatPath, 'messages.json');
    let messages = [];

    if (fs.existsSync(messagesFile)) {
        const messagesContent = fs.readFileSync(messagesFile, 'utf8');
        messages = JSON.parse(messagesContent);
    }

    messages.push(messageData);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
}

// Função para realizar o backup de todas as mensagens
async function backupMessage(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const chatPath = path.join(BACKUP_PATH, chatId);
    const mediaPath = path.join(chatPath, 'media');

    // Verifica e cria as pastas do chat e de mídia, se necessário
    if (!fs.existsSync(chatPath)) {
        fs.mkdirSync(chatPath, { recursive: true });
    }
    if (!fs.existsSync(mediaPath)) {
        fs.mkdirSync(mediaPath, { recursive: true });
    }

    // Cria o objeto de dados da mensagem
    const messageData = {
        id: msg.id._serialized,
        timestamp: msg.timestamp,
        from: msg.from,
        to: msg.to,
        author: msg.author || null,
        body: msg.body || null,
        type: msg.type,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia || false,
        mediaFileName: null  // Será atualizado se houver mídia associada
    };

    // Se a mensagem tiver mídia, salva a mídia no diretório correspondente
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const mimeExtension = media.mimetype.split('/')[1].split(';')[0];
        const mediaFileName = `${msg.id._serialized}.${mimeExtension}`;
        const mediaFilePath = path.join(mediaPath, mediaFileName);
        fs.writeFileSync(mediaFilePath, media.data, { encoding: 'base64' });
        console.log(`Mídia salva em ${mediaFilePath} do chat: ${msg.from}`);
        messageData.mediaFileName = mediaFileName;
    }

    // Salva os dados da mensagem no arquivo JSON do backup
    saveMessageToFile(chatPath, messageData);
}

// Função extra: encaminhamento e transcrição, se configurado
async function handleAudioFeatures(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const chatConfig = config.chats[chatId];
    if (!chatConfig || msg.type !== 'ptt' || !msg.hasMedia) {
        return;  // Apenas processa áudios (ptt) de chats com configuração extra
    }

    // Encaminha o áudio para o grupo de transcrição, se configurado
    if (chatConfig.sendAudioToTranscriptGroup) {
        const media = await msg.downloadMedia();
        client.sendMessage(config.transcriptionGroup, media, { caption: 'Áudio encaminhado automaticamente' });
    }

    // Transcrição do áudio, se configurado
    if (chatConfig.transcribeAudio) {
        const chatPath = path.join(BACKUP_PATH, chatId);
        const mediaPath = path.join(chatPath, 'media');
        const media = await msg.downloadMedia();
        const mimeExtension = media.mimetype.split('/')[1].split(';')[0];
        const mediaFileName = `${msg.id._serialized}.${mimeExtension}`;
        const mediaFilePath = path.join(mediaPath, mediaFileName);
        
        // Caminho de saída da transcrição
        const transcriptPath = mediaFilePath.replace(`.${mimeExtension}`, '.txt');
        
        // Executa o Whisper com o caminho completo e direciona o arquivo de saída
        exec(`/home/pablo.cerdeira/miniconda3/bin/whisper ${mediaFilePath} --language pt --output_format txt --output_dir ${mediaPath}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Erro na transcrição: ${error.message}`);
                return;
            }

            // Lê a transcrição gerada pelo Whisper
            const transcript = fs.readFileSync(transcriptPath, 'utf8');

            // Define o chat para enviar a transcrição
            const sendTo = chatConfig.sendTranscriptionTo === "same_chat" ? chatId : config.transcriptionGroup;

            // Envia a transcrição como resposta ao áudio, se "same_chat"; ou para o grupo privado
            if (chatConfig.sendTranscriptionTo === "same_chat") {
                msg.reply(`*Transcrição:* ${transcript}`);
            } else {
                client.sendMessage(sendTo, `*Transcrição do áudio do chat ${chatId}:* ${transcript}`);
            }
        });
    }
}

// Captura todas as mensagens, realiza backup e, para áudios, executa funções extras se configuradas
client.on('message_create', async msg => {
    await backupMessage(msg);        // Realiza o backup de todas as mensagens
    await handleAudioFeatures(msg);   // Executa funções extras para áudios, se configuradas
});

client.on('authenticated', () => {
    console.log('Sessão autenticada!');
});

client.on('auth_failure', () => {
    console.error('Falha na autenticação. Verifique o QR Code.');
});

client.initialize();