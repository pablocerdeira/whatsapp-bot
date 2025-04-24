const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
// Choose Puppeteer implementation: prefer puppeteer-core + system Chrome to reduce memory,
// fallback to full puppeteer if no external Chrome path is provided.
// Puppeteer-core with system Chrome for low memory usage
const puppeteer = require('puppeteer-core');
// Chrome executable (env overrides default path)
const browserExecPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
console.log(`${new Date().toISOString()} [init] Puppeteer executable: ${browserExecPath}`);
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const { exec } = require('child_process');
const { Configuration, OpenAIApi } = require('openai');
const axios = require('axios');
const _ = require('lodash');

// Global error handlers to surface unhandled errors, especially on newer Node versions
process.on('unhandledRejection', (reason, promise) => {
    console.error(`${new Date().toISOString()} [unhandledRejection]`, reason);
});
process.on('uncaughtException', (error) => {
    console.error(`${new Date().toISOString()} [uncaughtException]`, error.stack || error);
});
require('dotenv').config();

let config = loadConfig();
const BACKUP_PATH = './whatsapp-backup/chats';
const CHAT_NAMES_FILE = './whatsapp-backup/chat_names.json';

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// Initialize WhatsApp client, explicitly pointing to Puppeteer's Chromium for Node22 compatibility
// Initialize WhatsApp client with puppeteer-core
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'client-one' }),
    puppeteer: {
        executablePath: browserExecPath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ],
        timeout: 120000
    }
});

client.on('qr', qr => {
    console.log(`${new Date().toISOString()} [auth] QR Code gerado. Escaneie para autenticar.`);
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log(`${new Date().toISOString()} [init] Cliente pronto!`);
    watchConfigFile();
    loadChatNames();
    watchScheduledMessages(client);
    checkScheduledMessagesPeriodically(client);
});

function loadConfig() {
    try {
        const configData = fs.readFileSync('./config.json', 'utf8');
        console.log(`${new Date().toISOString()} [config] Configuração carregada com sucesso.`);
        return JSON.parse(configData);
    } catch (error) {
        console.error(`${new Date().toISOString()} [config] Erro ao carregar config.json: ${error.message}`);
        return {};
    }
}

function watchConfigFile() {
    fs.watchFile('./config.json', (curr, prev) => {
        console.log(`${new Date().toISOString()} [config] Arquivo config.json alterado. Recarregando configurações...`);
        config = loadConfig();
    });
}

function loadChatNames() {
    if (!fs.existsSync(CHAT_NAMES_FILE)) {
        fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify({ chats: {}, users: {} }), 'utf8');
        console.log(`${new Date().toISOString()} [config] Arquivo chat_names.json criado.`);
    } else {
        console.log(`${new Date().toISOString()} [config] Arquivo chat_names.json carregado.`);
    }
}

async function updateChatName(chatId) {
    const chatNames = JSON.parse(fs.readFileSync(CHAT_NAMES_FILE, 'utf8'));
    const chat = await client.getChatById(chatId);
    const currentChatName = chat.isGroup ? chat.name : (chat.contact?.pushname || chat.contact?.name || chatId);

    if (chatNames.chats[chatId] !== currentChatName) {
        chatNames.chats[chatId] = currentChatName;
        fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify(chatNames, null, 2), 'utf8');
        console.log(`${new Date().toISOString()} [config] Nome do chat atualizado: ${currentChatName} (ID: ${chatId})`);
    }
}

async function updateUserName(userId) {
    const chatNames = JSON.parse(fs.readFileSync(CHAT_NAMES_FILE, 'utf8'));
    if (!chatNames.users[userId]) {
        try {
            const contact = await client.getContactById(userId);
            const userName = contact.pushname || contact.name || userId;
            chatNames.users[userId] = userName;
            fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify(chatNames, null, 2), 'utf8');
            console.log(`${new Date().toISOString()} [config] Nome do usuário atualizado: ${userName} (ID: ${userId})`);
        } catch {
            console.error(`${new Date().toISOString()} [config] Não foi possível obter o nome do usuário: ${userId}`);
        }
    }
}

function saveMessageToFile(chatPath, messageData) {
    const messagesFile = path.join(chatPath, 'messages.json');
    let messages = [];

    if (fs.existsSync(messagesFile)) {
        const messagesContent = fs.readFileSync(messagesFile, 'utf8');
        messages = JSON.parse(messagesContent);
    }

    messages.push(messageData);
    fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
    console.log(`${new Date().toISOString()} [backup] Mensagem salva em ${messagesFile}`);
}

async function backupMessage(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const chatPath = path.join(BACKUP_PATH, chatId);
    const mediaPath = path.join(chatPath, 'media');

    console.log(`${new Date().toISOString()} [backup] Iniciando backup da mensagem ${msg.id._serialized} do chat ${chatId}`);

    // Atualiza os nomes do chat e do autor
    await updateChatName(chatId);
    if (msg.author) await updateUserName(msg.author);

    // Criação das pastas
    if (!fs.existsSync(chatPath)) {
        fs.mkdirSync(chatPath, { recursive: true });
        console.log(`${new Date().toISOString()} [backup] Diretório criado: ${chatPath}`);
    }
    if (!fs.existsSync(mediaPath)) {
        fs.mkdirSync(mediaPath, { recursive: true });
        console.log(`${new Date().toISOString()} [backup] Diretório de mídia criado: ${mediaPath}`);
    }

    const authorName = msg.author ? (await client.getContactById(msg.author)).pushname || msg.author : null;

    const messageData = {
        id: msg.id._serialized,
        timestamp: msg.timestamp,
        from: msg.from,
        to: msg.to,
        author: msg.author || null,
        authorName: authorName,
        body: msg.body || null,
        type: msg.type,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia || false,
        mediaFileName: null
    };

    if (msg.hasMedia) {
        console.log(`${new Date().toISOString()} [backup] Mensagem ${msg.id._serialized} possui mídia. Iniciando download...`);
        try {
            const media = await msg.downloadMedia();
            if (media && media.mimetype) {
                const mimeExtension = media.mimetype.split('/')[1].split(';')[0];
                const mediaFileName = `${msg.id._serialized}.${mimeExtension}`;
                const mediaFilePath = path.join(mediaPath, mediaFileName);
                fs.writeFileSync(mediaFilePath, media.data, { encoding: 'base64' });
                console.log(`${new Date().toISOString()} [backup] Mídia salva em ${mediaFilePath}`);
                messageData.mediaFileName = mediaFileName;
            } else {
                console.warn(`${new Date().toISOString()} [backup] Falha ao baixar mídia para mensagem ${msg.id._serialized}`);
            }
        } catch (error) {
            console.error(`${new Date().toISOString()} [backup] Erro ao fazer download da mídia: ${error.message}`);
        }
    }

    saveMessageToFile(chatPath, messageData);
    console.log(`${new Date().toISOString()} [backup] Backup finalizado da mensagem ${msg.id._serialized}`);
}

async function handleAudioFeatures(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;

    if (chatId === 'status@broadcast') {
        console.log(`${new Date().toISOString()} [audio] Ignorando status@broadcast`);
        return;
    }

    const isGroup = chatId.includes('@g.us');
    const isPrivateChat = !isGroup;

    if (!['ptt', 'audio', 'ptv'].includes(msg.type) || !msg.hasMedia) {
        console.log(`${new Date().toISOString()} [audio] Mensagem ${msg.id._serialized} não é um áudio processável`);
        return;
    }

    if (isPrivateChat) {
        console.log(`${new Date().toISOString()} [audio] Transcrevendo áudio privado do chat ${chatId}`);
        await transcribeAndReply(msg, chatId, "same_chat");
        return;
    }

    if (!config.chats || !config.chats[chatId]) {
        console.log(`${new Date().toISOString()} [audio] Grupo ${chatId} não configurado no config.json. Ignorando.`);
        return;
    }

    const chatConfig = config.chats[chatId];

    if (chatConfig.sendAudioToTranscriptGroup && config.transcriptionGroup) {
        try {
            const media = await msg.downloadMedia();
            await client.sendMessage(config.transcriptionGroup, media, { caption: 'Áudio encaminhado automaticamente' });
            console.log(`${new Date().toISOString()} [audio] Áudio do grupo ${chatId} encaminhado para grupo de transcrição`);
        } catch (err) {
            console.error(`${new Date().toISOString()} [audio] Erro ao encaminhar áudio do grupo ${chatId}: ${err.message}`);
        }
    }

    if (chatConfig.transcribeAudio) {
        console.log(`${new Date().toISOString()} [audio] Transcrevendo áudio do grupo ${chatId}`);
        await transcribeAndReply(msg, chatId, chatConfig.sendTranscriptionTo || "same_chat");
    }
}

async function transcribeAndReply(msg, chatId, sendTranscriptionTo = "same_chat") {
    const mediaPath = path.join(BACKUP_PATH, chatId, 'media');
    const mediaFilePath = path.join(mediaPath, `${msg.id._serialized}.ogg`);
    const transcriptPath = mediaFilePath.replace('.ogg', '.txt');
    const whisperPath = config.whisperPath || 'whisper';

    console.log(`${new Date().toISOString()} [audio] Executando Whisper: ${whisperPath} ${mediaFilePath}`);

    exec(`${whisperPath} ${mediaFilePath} --language pt --output_format txt --output_dir ${mediaPath}`, (error) => {
        if (error) {
            console.error(`${new Date().toISOString()} [audio] Erro na transcrição com Whisper: ${error.message}`);
            return;
        }

        let attempts = 0;
        const maxAttempts = 15;
        const checkInterval = 700;

        function checkFileExists() {
            if (fs.existsSync(transcriptPath)) {
                const transcript = fs.readFileSync(transcriptPath, 'utf8');
                const sendTo = sendTranscriptionTo === "same_chat" ? chatId : config.transcriptionGroup;

                if (sendTranscriptionTo === "same_chat") {
                    msg.reply(`*Transcrição:* ${transcript}`);
                } else {
                    client.sendMessage(sendTo, `*Transcrição do áudio do chat ${chatId}:* ${transcript}`);
                }

                console.log(`${new Date().toISOString()} [audio] Transcrição enviada com sucesso para ${sendTranscriptionTo}`);
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(checkFileExists, checkInterval);
            } else {
                console.error(`${new Date().toISOString()} [audio] Falha ao localizar a transcrição após ${maxAttempts} tentativas.`);
            }
        }

        checkFileExists();
    });
}

async function handleDocumentFeatures(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const isGroup = chatId.includes('@g.us');
    const isPrivateChat = !isGroup;

    console.log(`${new Date().toISOString()} [doc] Início do processamento de documento para ${chatId}`);

    // Processar documentos para chats privados sempre
    if (isPrivateChat) {
        console.log(`${new Date().toISOString()} [doc] Processando documento para chat privado ${chatId}`);
    } else if (isGroup) {
        // Verificar configuração para grupos
        if (!config.chats[chatId]) {
            console.log(`${new Date().toISOString()} [doc] Grupo ${chatId} não configurado no config.json`);
            return;
        }

        if (config.chats[chatId].summarizeDocuments !== true) {
            console.log(`${new Date().toISOString()} [doc] summarizeDocuments não habilitado para o grupo ${chatId}`);
            return;
        }
    }

    if (msg.hasMedia && ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(msg._data.mimetype)) {
        console.log(`${new Date().toISOString()} [doc] Documento recebido. Tentando baixar e salvar.`);

        const media = await msg.downloadMedia();
        const filePath = path.join(BACKUP_PATH, chatId, 'media', `${msg.id._serialized}.${media.mimetype.split('/')[1]}`);
        fs.writeFileSync(filePath, media.data, { encoding: 'base64' });

        let textContent;
        try {
            if (media.mimetype === 'application/pdf') {
                const data = await pdfParse(fs.readFileSync(filePath));
                textContent = data.text;
            } else if (media.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                const result = await mammoth.extractRawText({ path: filePath });
                textContent = result.value;
            } else if (media.mimetype === 'application/msword') {
                textContent = await new Promise((resolve, reject) => {
                    textract.fromFileWithPath(filePath, (error, text) => {
                        if (error) reject(error);
                        else resolve(text);
                    });
                });
            }

            const summary = await generateSummary(textContent);
            if (summary) {
                console.log(`${new Date().toISOString()} [doc] Enviando resumo para ${chatId}`);
                msg.reply(`*Resumo do documento (atenção, gerado por IA, pode conter erros):* ${summary}`);
            }
        } catch (error) {
            console.error(`${new Date().toISOString()} [doc] Erro ao processar documento: ${error.message}`);
        }
    }
}

// Recursively render templates in strings within objects/arrays
function renderTemplate(str, context) {
  return str.replace(/{{\s*(\w+)\s*}}/g, (_, key) => context[key] || '');
}
function renderObject(obj, context) {
  if (typeof obj === 'string') return renderTemplate(obj, context);
  if (Array.isArray(obj)) return obj.map(item => renderObject(item, context));
    if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      let val = renderObject(v, context);
      // convert numeric strings to numbers
      if (typeof val === 'string') {
        if (/^\d+$/.test(val)) val = Number(val);
        else if (/^\d+\.\d+$/.test(val)) val = parseFloat(val);
      }
      out[k] = val;
    }
    return out;
  }
  return obj;
}

/**
 * Generate summary for given text using configured generic HTTP provider in config.services
 */
async function generateSummary(text) {
  const svcName = config.service;
  const svc = _.get(config, ['services', svcName]);
  if (!svc || !svc.request) {
    console.error(`${new Date().toISOString()} [doc] Service not configured: ${svcName}`);
    return null;
  }
  const req = svc.request;
  const attempts = svc.maxAttempts || 3;
  const backoff = svc.backoffDelay || 1000;
  console.log(`${new Date().toISOString()} [doc] Summarizing via '${svcName}'`);
  for (let i = 0; i < attempts; i++) {
    try {
      // Build context for template rendering
      const context = {
        text,
        model: svc.model || '',
        apiKey: svc.apiKeyEnv ? process.env[svc.apiKeyEnv] : (svc.apiKey || process.env.OPENAI_API_KEY || ''),
        max_tokens: svc.max_tokens || svc.maxTokens || ''
      };
      const url = renderTemplate(req.url, context);
      const headers = renderObject(req.headers || {}, context);
      const data = renderObject(req.bodyTemplate || {}, context);
      const method = (req.method || 'post').toLowerCase();
      console.log(`${new Date().toISOString()} [doc] Summary request to URL: ${url}`);
      console.log(`${new Date().toISOString()} [doc] Headers: ${JSON.stringify(headers)}`);
      console.log(`${new Date().toISOString()} [doc] Body: ${JSON.stringify(data).slice(0,200)}`);
      const resp = await axios({ method, url, headers, data });
      console.log(`${new Date().toISOString()} [doc] Raw summary response: ${JSON.stringify(resp.data).slice(0,200)}`);
      const result = svc.responseKey ? _.get(resp.data, svc.responseKey) : resp.data;
      return typeof result === 'string' ? result.trim() : result;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && i < attempts - 1) {
        console.warn(`${new Date().toISOString()} [doc] Rate limited, retrying ${i + 1}`);
        await new Promise(r => setTimeout(r, backoff * Math.pow(2, i)));
        continue;
      }
      console.error(`${new Date().toISOString()} [doc] Error generating summary: ${err.message}`);
      return null;
    }
  }
  console.error(`${new Date().toISOString()} [doc] All ${attempts} summary attempts failed for '${svcName}'`);
  return null;
}


// Função para carregar mensagens agendadas
function loadScheduledMessages() {
    try {
        const data = fs.readFileSync('./scheduled-messages.json', 'utf8');
        console.log(`${new Date().toISOString()} [schedule] Mensagens agendadas carregadas com sucesso.`);
        return JSON.parse(data);
    } catch (error) {
        console.error(`${new Date().toISOString()} [schedule] Erro ao carregar mensagens agendadas: ${error.message}`);
        return [];
    }
}

// Função para salvar mensagens agendadas
function saveScheduledMessages(messages) {
    try {
        fs.unwatchFile('./scheduled-messages.json');
        fs.writeFileSync('./scheduled-messages.json', JSON.stringify(messages, null, 2), 'utf8');
        console.log(`${new Date().toISOString()} [schedule] Mensagens agendadas salvas com sucesso.`);
    } catch (error) {
        console.error(`${new Date().toISOString()} [schedule] Erro ao salvar mensagens agendadas: ${error.message}`);
    } finally {
        watchScheduledMessages(client);
    }
}

// Função para enviar mensagem
async function sendMessage(client, messageData) {
    try {
        const { recipient, message, attachment } = messageData;
        let media = null;

        if (attachment) {
            try {
                media = MessageMedia.fromFilePath(attachment);
                console.log(`${new Date().toISOString()} [send] Anexo carregado com sucesso: ${attachment}`);
            } catch (error) {
                console.error(`${new Date().toISOString()} [send] Falha ao carregar anexo: ${attachment} | ${error.message}`);
                return;
            }
        }

        if (media) {
            await client.sendMessage(recipient, media, { caption: message });
        } else {
            await client.sendMessage(recipient, message);
        }

        console.log(`${new Date().toISOString()} [send] Mensagem enviada para ${recipient}`);
        messageData.status = 'sent';
        messageData.sentAt = new Date().toISOString();
    } catch (error) {
        console.error(`${new Date().toISOString()} [send] Erro ao enviar mensagem para ${messageData.recipient}: ${error.message}`);
    }
}

// Monitoramento do arquivo de mensagens agendadas
let isScheduledMessageProcessing = false;

function watchScheduledMessages(client) {
    if (isScheduledMessageProcessing) return;

    isScheduledMessageProcessing = true;
    console.log(`${new Date().toISOString()} [schedule] Monitoramento de mensagens agendadas iniciado.`);

    fs.watchFile('./scheduled-messages.json', async () => {
        console.log(`${new Date().toISOString()} [schedule] Arquivo de mensagens agendadas atualizado. Verificando...`);
        const messages = loadScheduledMessages();
        const now = new Date();

        for (const messageData of messages) {
            const scheduledTime = new Date(messageData.scheduledAt);

            if (messageData.status === 'approved' && scheduledTime <= now && messageData.sentAt === null) {
                console.log(`${new Date().toISOString()} [schedule] Enviando mensagem agendada:
- Para: ${messageData.recipient}
- Agendada para: ${messageData.scheduledAt}
- Conteúdo: ${messageData.message}`);

                await sendMessage(client, messageData);
                messageData.status = 'sent';
                messageData.sentAt = new Date().toISOString();
            }
        }

        saveScheduledMessages(messages);
    });
}

// Verificação periódica (fallback)
function checkScheduledMessagesPeriodically(client) {
    setInterval(async () => {
        if (isScheduledMessageProcessing) return;

        isScheduledMessageProcessing = true;
        console.log(`${new Date().toISOString()} [schedule] Verificação periódica de mensagens agendadas...`);

        const messages = loadScheduledMessages();
        const now = new Date();

        for (const messageData of messages) {
            const scheduledTime = new Date(messageData.scheduledAt);

            if (messageData.status === 'approved' && scheduledTime <= now && messageData.sentAt === null) {
                console.log(`${new Date().toISOString()} [schedule] Mensagem agendada pronta para envio:
- Para: ${messageData.recipient}
- Agendada para: ${messageData.scheduledAt}
- Conteúdo: ${messageData.message}`);

                await sendMessage(client, messageData);
                messageData.status = 'sent';
                messageData.sentAt = new Date().toISOString();
            }
        }

        saveScheduledMessages(messages);
        isScheduledMessageProcessing = false;
    }, 60000);
}

client.on('qr', qr => {
    console.log(`${new Date().toISOString()} [auth] QR code gerado. Escaneie para autenticar.`);
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log(`${new Date().toISOString()} [auth] Sessão autenticada com sucesso.`);
});

client.on('auth_failure', () => {
    console.error(`${new Date().toISOString()} [auth] Falha na autenticação. Verifique o QR Code.`);
});

client.on('ready', async () => {
    console.log(`${new Date().toISOString()} [init] Cliente WhatsApp pronto.`);
    
    watchConfigFile();
    loadChatNames();

    console.log(`${new Date().toISOString()} [config] Monitoramento de alterações em config.json iniciado.`);
    console.log(`${new Date().toISOString()} [config] Carregamento de nomes de chats e usuários concluído.`);

    // Inicia monitoramento e verificação de mensagens agendadas
    watchScheduledMessages(client);
    checkScheduledMessagesPeriodically(client);
});

// Captura todas as mensagens, realiza backup e executa ações adicionais
client.on('message_create', async msg => {
    console.log(`${new Date().toISOString()} [msg] Mensagem recebida - ID: ${msg.id._serialized} | Tipo: ${msg.type} | De: ${msg.from}`);
    
    await backupMessage(msg);                       // Backup
    await handleAudioFeatures(msg);                 // Processamento de áudio
    await handleDocumentFeatures(msg);              // Processamento de documentos
});

// Inicializa o cliente
console.log(`${new Date().toISOString()} [init] Inicializando o cliente WhatsApp...`);
client.initialize();
