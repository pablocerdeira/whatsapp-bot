const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const { exec } = require('child_process');
const { Configuration, OpenAIApi } = require('openai');

require('dotenv').config();

let config = loadConfig();
const BACKUP_PATH = './whatsapp-backup/chats';
const CHAT_NAMES_FILE = './whatsapp-backup/chat_names.json';

// Configuração correta da instância OpenAI
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one" }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        timeout: 60000
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Cliente pronto!');
    watchConfigFile();
    loadChatNames();
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

// Função para carregar ou inicializar o dicionário de nomes de chats e usuários
function loadChatNames() {
    if (!fs.existsSync(CHAT_NAMES_FILE)) {
        fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify({ chats: {}, users: {} }), 'utf8');
    }
}

// Função para atualizar o nome do chat no dicionário, verificando se o nome mudou
async function updateChatName(chatId) {
    const chatNames = JSON.parse(fs.readFileSync(CHAT_NAMES_FILE, 'utf8'));
    const chat = await client.getChatById(chatId);
    const currentChatName = chat.isGroup ? chat.name : (chat.contact?.pushname || chat.contact?.name || chatId);

    // Atualiza o nome apenas se ele mudou
    if (chatNames.chats[chatId] !== currentChatName) {
        chatNames.chats[chatId] = currentChatName;
        fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify(chatNames, null, 2), 'utf8');
        console.log(`Nome do chat atualizado no dicionário: ${currentChatName} (ID: ${chatId})`);
    }
}

// Função para atualizar o nome do usuário no dicionário
async function updateUserName(userId) {
    const chatNames = JSON.parse(fs.readFileSync(CHAT_NAMES_FILE, 'utf8'));
    if (!chatNames.users[userId]) {
        try {
            const contact = await client.getContactById(userId);
            const userName = contact.pushname || contact.name || userId;
            chatNames.users[userId] = userName;
            fs.writeFileSync(CHAT_NAMES_FILE, JSON.stringify(chatNames, null, 2), 'utf8');
        } catch {
            console.error(`Não foi possível obter o nome do usuário para ID: ${userId}`);
        }
    }
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

    // Atualiza o dicionário de nomes de chats e usuários
    await updateChatName(chatId);
    if (msg.author) await updateUserName(msg.author);

    // Verifica e cria as pastas do chat e de mídia, se necessário
    if (!fs.existsSync(chatPath)) {
        fs.mkdirSync(chatPath, { recursive: true });
    }
    if (!fs.existsSync(mediaPath)) {
        fs.mkdirSync(mediaPath, { recursive: true });
    }

    // Obtém o nome do autor
    const authorName = msg.author ? (await client.getContactById(msg.author)).pushname || msg.author : null;

    // Cria o objeto de dados da mensagem
    const messageData = {
        id: msg.id._serialized,
        timestamp: msg.timestamp,
        from: msg.from,
        to: msg.to,
        author: msg.author || null,
        authorName: authorName,  // Adiciona o nome do autor
        body: msg.body || null,
        type: msg.type,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia || false,
        mediaFileName: null  // Será atualizado se houver mídia associada
    };

    // Se a mensagem tiver mídia, tenta fazer o download e salvar
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.mimetype) {  // Verifica se media e mimetype estão definidos
                const mimeExtension = media.mimetype.split('/')[1].split(';')[0];
                const mediaFileName = `${msg.id._serialized}.${mimeExtension}`;
                const mediaFilePath = path.join(mediaPath, mediaFileName);
                fs.writeFileSync(mediaFilePath, media.data, { encoding: 'base64' });
                console.log(`Mídia salva em ${mediaFilePath} do chat: ${chatId}`);
                messageData.mediaFileName = mediaFileName;
            } else {
                console.warn(`Falha ao baixar mídia para a mensagem: ${msg.id._serialized}`);
            }
        } catch (error) {
            console.error(`Erro ao fazer download da mídia: ${error.message}`);
        }
    }

    // Salva os dados da mensagem no arquivo JSON do backup
    saveMessageToFile(chatPath, messageData);
}

// Função extra: encaminhamento e transcrição, com regras diferentes para chats privados e grupos
async function handleAudioFeatures(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;

    // Ignora mensagens do status@broadcast
    if (chatId === 'status@broadcast') {
        return;
    }

    const chat = await client.getChatById(chatId);
    const isPrivateChat = !chat.isGroup;  // Verifica se é um chat privado (1:1)
    const chatConfig = config.chats[chatId];

    // Transcrição automática para todos os chats privados
    if (isPrivateChat && msg.type === 'ptt' && msg.hasMedia) {
        await transcribeAndReply(msg, chatId, "same_chat");  // Transcreve e responde no mesmo chat
        return;
    }

    // Para grupos, verifica configurações extras para áudios recebidos de outros (apenas se o grupo tiver configuração específica)
    if (!isPrivateChat && (!chatConfig || msg.type !== 'ptt' || !msg.hasMedia)) {
        return;  // Apenas processa áudios (ptt) de grupos com configuração extra
    }

    // Encaminha o áudio para o grupo de transcrição, se configurado no config.json (para grupos apenas)
    if (chatConfig && chatConfig.sendAudioToTranscriptGroup && msg.type === 'ptt') {
        const media = await msg.downloadMedia();
        client.sendMessage(config.transcriptionGroup, media, { caption: 'Áudio encaminhado automaticamente' });
    }

    // Transcrição do áudio para grupos, se configurado no config.json
    if (chatConfig && chatConfig.transcribeAudio) {
        await transcribeAndReply(msg, chatId, chatConfig.sendTranscriptionTo);
    }
}

// Função para transcrever áudio e responder com a transcrição
async function transcribeAndReply(msg, chatId, sendTranscriptionTo = "same_chat") {
    const mediaPath = path.join(BACKUP_PATH, chatId, 'media');
    const mediaFilePath = path.join(mediaPath, `${msg.id._serialized}.ogg`);

    // Caminho de saída da transcrição
    const transcriptPath = mediaFilePath.replace('.ogg', '.txt');

    // Executa o Whisper com o caminho completo e direciona o arquivo de saída
    exec(`/home/pablo.cerdeira/miniconda3/bin/whisper ${mediaFilePath} --language pt --output_format txt --output_dir ${mediaPath}`, (error) => {
        if (error) {
            console.error(`Erro na transcrição: ${error.message}`);
            return;
        }

        // Função para verificar a existência do arquivo de transcrição com limite de tentativas
        let attempts = 0;
        const maxAttempts = 15; // Aumentado o limite de tentativas
        const checkInterval = 700; // Intervalo ajustado para 700ms

        function checkFileExists() {
            if (fs.existsSync(transcriptPath)) {
                // Lê a transcrição gerada pelo Whisper
                const transcript = fs.readFileSync(transcriptPath, 'utf8');

                // Define o chat para enviar a transcrição
                const sendTo = sendTranscriptionTo === "same_chat" ? chatId : config.transcriptionGroup;

                // Envia a transcrição como resposta ao áudio, se "same_chat"; ou para o grupo privado
                if (sendTranscriptionTo === "same_chat") {
                    msg.reply(`*Transcrição:* ${transcript}`);
                } else {
                    client.sendMessage(sendTo, `*Transcrição do áudio do chat ${chatId}:* ${transcript}`);
                }
            } else if (attempts < maxAttempts) {
                // Aguarda e tenta novamente, aumentando o contador de tentativas
                attempts++;
                setTimeout(checkFileExists, checkInterval);
            } else {
                console.error(`Falha ao localizar o arquivo de transcrição após ${maxAttempts} tentativas.`);
            }
        }

        // Inicia a verificação da existência do arquivo
        checkFileExists();
    });
}

// Função para processar documentos e gerar resumo
async function handleDocumentFeatures(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    const chat = await client.getChatById(chatId);
    const isPrivateChat = !chat.isGroup;
    const chatConfig = config.chats[chatId];

    // Verifica se é um documento PDF, DOC ou DOCX
    if (msg.hasMedia && ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(msg._data.mimetype)) {
        const media = await msg.downloadMedia();
        const filePath = path.join(BACKUP_PATH, chatId, 'media', `${msg.id._serialized}.${media.mimetype.split('/')[1]}`);
        
        // Salva o documento temporariamente
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
        } catch (error) {
            console.error(`Erro ao extrair texto do documento: ${error.message}`);
            return;
        }

        // Configurações para resumos em conversas privadas e grupos
        const shouldSummarize = isPrivateChat || (chatConfig && chatConfig.summarizeDocuments);
        if (shouldSummarize) {
            const summary = await generateSummary(textContent);
            if (summary) {
                msg.reply(`*Resumo do documento:* ${summary}`);
            }
        }
    }
}

// Função para gerar resumo usando OpenAI
async function generateSummary(text) {
    let attempts = 0;
    const maxAttempts = 5;
    const backoffDelay = 2000; // 2 segundos para começar, aumentando exponencialmente

    while (attempts < maxAttempts) {
        try {
            const response = await openai.createChatCompletion({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: `Faça um resumo breve e objetivo do seguinte texto, com no máximo 800 palavras, indicando também do que se trata e seus objetivos. Nunca use a palavra RESUMO em sua resposta: ${text}` }],
                max_tokens: 800
            });
            return response.data.choices[0].message.content.trim();
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.warn(`Rate limit exceeded. Tentativa ${attempts + 1} de ${maxAttempts}. Esperando ${backoffDelay / 1000} segundos antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay * (2 ** attempts))); // Exponential backoff
                attempts++;
            } else {
                console.error(`Erro ao gerar resumo com OpenAI: ${error.message}`);
                return null;
            }
        }
    }
    console.error("Máximo de tentativas atingido. Não foi possível gerar o resumo.");
    return null;
}

// Captura todas as mensagens, realiza backup e, para áudios, executa funções extras se configuradas
client.on('message_create', async msg => {
    await backupMessage(msg);        // Realiza o backup de todas as mensagens
    await handleAudioFeatures(msg);   // Executa funções extras para áudios, se configuradas
    await handleDocumentFeatures(msg); // Resumo de documentos
});

client.on('authenticated', () => {
    console.log('Sessão autenticada!');
});

client.on('auth_failure', () => {
    console.error('Falha na autenticação. Verifique o QR Code.');
});

client.initialize();