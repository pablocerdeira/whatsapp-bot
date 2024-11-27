const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const textract = require('textract');
const { exec } = require('child_process');
const { Configuration, OpenAIApi } = require('openai');
const axios = require('axios');

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

    // Iniciar o monitoramento de agendamentos
    watchScheduledMessages(client);
    checkScheduledMessagesPeriodically(client);
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

    // Verifica se é um grupo pelo ID do chat
    const isGroup = chatId.includes('@g.us');
    const isPrivateChat = !isGroup;

    // Verifica se é um áudio
    if (!['ptt', 'audio', 'ptv'].includes(msg.type) || !msg.hasMedia) {
        return;
    }

    // Para chats privados, sempre transcreve
    if (isPrivateChat) {
        console.log(`Transcrevendo áudio para chat privado ${chatId}`);
        await transcribeAndReply(msg, chatId, "same_chat");
        return;
    }

    // Para grupos, primeiro verifica se está configurado no config.json
    if (!config.chats || !config.chats[chatId]) {
        console.log(`Áudio ignorado: o grupo ${chatId} não está configurado no config.json`);
        return;
    }

    // Obtém a configuração do grupo
    const chatConfig = config.chats[chatId];

    // Processa o áudio de acordo com as configurações do grupo
    if (chatConfig.sendAudioToTranscriptGroup && config.transcriptionGroup) {
        console.log(`Encaminhando áudio do grupo ${chatId} para grupo de transcrição`);
        const media = await msg.downloadMedia();
        await client.sendMessage(config.transcriptionGroup, media, { caption: 'Áudio encaminhado automaticamente' });
    }

    if (chatConfig.transcribeAudio) {
        console.log(`Transcrevendo áudio para grupo ${chatId}`);
        await transcribeAndReply(msg, chatId, chatConfig.sendTranscriptionTo || "same_chat");
    }
}

// Função para transcrever áudio e responder com a transcrição
async function transcribeAndReply(msg, chatId, sendTranscriptionTo = "same_chat") {
    const mediaPath = path.join(BACKUP_PATH, chatId, 'media');
    const mediaFilePath = path.join(mediaPath, `${msg.id._serialized}.ogg`);

    // Caminho de saída da transcrição
    const transcriptPath = mediaFilePath.replace('.ogg', '.txt');

    // Obtém o caminho para o executável do Whisper a partir do config.json
    const whisperPath = config.whisperPath || 'whisper'; // Usa 'whisper' como padrão se não estiver configurado

    // Executa o Whisper com o caminho configurável
    exec(`${whisperPath} ${mediaFilePath} --language pt --output_format txt --output_dir ${mediaPath}`, (error) => {
        if (error) {
            console.error(`Erro na transcrição: ${error.message}`);
            return;
        }

        // Função para verificar a existência do arquivo de transcrição com limite de tentativas
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
            } else if (attempts < maxAttempts) {
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
    
    // Verifica se é um grupo pelo ID do chat (mais confiável que usar chat.isGroup)
    const isGroup = chatId.includes('@g.us');
    const isPrivateChat = !isGroup;

    // Log inicial para debug
    console.log(`Processando documento para ${isGroup ? 'grupo' : 'chat privado'} ${chatId}`);

    // Se for um grupo, verifica se está no config.json e se tem summarizeDocuments: true
    if (isGroup) {
        // Verifica se o grupo está configurado no config.json
        if (!config.chats[chatId]) {
            console.log(`Documento ignorado: o grupo ${chatId} não está configurado no config.json`);
            return;
        }

        // Verifica se summarizeDocuments está explicitamente configurado como true
        if (config.chats[chatId].summarizeDocuments !== true) {
            console.log(`Documento ignorado: summarizeDocuments não está habilitado para o grupo ${chatId}`);
            return;
        }
    }

    // Verifica se a mensagem contém um documento elegível
    if (msg.hasMedia && ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(msg._data.mimetype)) {
        console.log(`Iniciando processamento do documento`);
        
        const media = await msg.downloadMedia();
        const filePath = path.join(BACKUP_PATH, chatId, 'media', `${msg.id._serialized}.${media.mimetype.split('/')[1]}`);

        // Salva o documento temporariamente
        fs.writeFileSync(filePath, media.data, { encoding: 'base64' });

        let textContent;
        try {
            // Extração de texto com base no tipo de documento
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

            // Gera o resumo
            const summary = await generateSummary(textContent);
            if (summary) {
                console.log(`Enviando resumo para ${chatId}`);
                msg.reply(`*Resumo do documento (atenção, gerado por IA, pode conter erros):* ${summary}`);
            }
        } catch (error) {
            console.error(`Erro ao processar documento para ${chatId}: ${error.message}`);
        }
    }
}

// Função para gerar resumo
async function generateSummary(text) {
    const service = config.service || "openai";
    let attempts = 0;
    const maxAttempts = 5;
    const backoffDelay = 2000; // 2 segundos para começar, aumentando exponencialmente

    while (attempts < maxAttempts) {
        try {
            if (service === "openai") {
                const model = config.openai?.model || "gpt-4o-mini";
                return await generateSummaryWithOpenAI(text, model);
            } else if (service === "ollama") {
                const model = config.ollama?.model || "llama2";
                const baseUrl = config.ollama?.base_url || "http://localhost:11434";
                return await generateSummaryWithOllama(text, model, baseUrl);
            } else {
                console.error(`Serviço de IA inválido: ${service}`);
                return null;
            }
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.warn(`Rate limit exceeded. Tentativa ${attempts + 1} de ${maxAttempts}. Esperando ${backoffDelay / 1000} segundos antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay * (2 ** attempts))); // Exponential backoff
                attempts++;
            } else {
                console.error(`Erro ao gerar resumo com ${service}: ${error.message}`);
                return null;
            }
        }
    }
    console.error("Máximo de tentativas atingido. Não foi possível gerar o resumo.");
    return null;
}

async function generateSummaryWithOpenAI(text, model) {
    const response = await openai.createChatCompletion({
        model,
        messages: [{ role: "user", content: `Faça um resumo do texto a seguir, sem dizer que está fazendo um resumo. Tente se limitar a 800 palavras, sabendo que o público-alvo é formado por advogados experientes. Não faça nenhuma análise, apenas resuma o texto, sabendo que o resumo deve ser menor que o texto original: ${text}` }],
        max_tokens: 800
    });
    return response.data.choices[0].message.content.trim();
}

async function generateSummaryWithOllama(text, model, baseUrl) {
    const prompt = `Faça um resumo do texto a seguir, sem dizer que está fazendo um resumo. Tente se limitar a 800 palavras, sabendo que o público-alvo é formado por advogados experientes. Não faça nenhuma análise, apenas resuma o texto, sabendo que o resumo deve ser menor que o texto original: ${text}`;

    try {
        const response = await axios.post(`${baseUrl}/api/generate`, {
            model,
            prompt,
            stream: false // Certifique-se de que o streaming está desativado
        });

        // Verificação e extração da resposta correta
        if (response.data && typeof response.data.response === 'string') {
            return response.data.response.trim();
        } else {
            console.error("Erro ao obter resposta da API Ollama: Formato inesperado.");
            return null;
        }
    } catch (error) {
        console.error(`Erro ao se comunicar com Ollama: ${error.message}`);
        return null;
    }
}

// Função para carregar mensagens agendadas
function loadScheduledMessages() {
    try {
        const data = fs.readFileSync('./scheduled-messages.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao carregar o arquivo de mensagens agendadas:', error);
        return [];
    }
}

// Função para salvar mensagens agendadas
function saveScheduledMessages(messages) {
    try {
        // Desativa o monitoramento temporariamente
        fs.unwatchFile('./scheduled-messages.json');
        fs.writeFileSync('./scheduled-messages.json', JSON.stringify(messages, null, 2), 'utf8');
        console.log('Mensagens agendadas salvas com sucesso.');
    } catch (error) {
        console.error('Erro ao salvar o arquivo de mensagens agendadas:', error);
    } finally {
        // Reativa o monitoramento
        watchScheduledMessages(client);
    }
}

// Função para enviar mensagem
async function sendMessage(client, messageData) {
    try {
        const { recipient, message, attachment } = messageData;

        // Variável para armazenar o anexo (se houver)
        let media = null;

        // Carrega o anexo se o caminho for especificado
        if (attachment) {
            try {
                media = MessageMedia.fromFilePath(attachment);
                console.log(`Anexo carregado: ${attachment}`);
            } catch (error) {
                console.error(`Erro ao carregar o anexo: ${attachment}. Erro: ${error.message}`);
                return; // Interrompe o envio se houver erro ao carregar o anexo
            }
        }

        // Envia a mensagem com ou sem anexo
        if (media) {
            await client.sendMessage(recipient, media, { caption: message });
        } else {
            await client.sendMessage(recipient, message);
        }

        console.log(`Mensagem enviada para ${recipient}`);

        // Atualiza o status da mensagem para 'sent'
        messageData.status = 'sent';
        messageData.sentAt = new Date().toISOString();
    } catch (error) {
        console.error(`Erro ao enviar mensagem para ${messageData.recipient}: ${error.message}`);
    }
}

// Função para monitorar o arquivo de mensagens agendadas
let isScheduledMessageProcessing = false;

function watchScheduledMessages(client) {
    if (isScheduledMessageProcessing) return; // Impede múltiplas execuções

    console.log('Monitoramento de mensagens agendadas iniciado...');
    fs.watchFile('./scheduled-messages.json', async () => {
        console.log('Arquivo de mensagens agendadas atualizado. Verificando agendamentos...');

        const messages = loadScheduledMessages();
        const now = new Date();

        for (const messageData of messages) {
            const scheduledTime = new Date(messageData.scheduledAt);

            if (messageData.status === 'approved' && scheduledTime <= now && messageData.sentAt === null) {
                console.log(`Nova mensagem agendada encontrada:
- Destinatário: ${messageData.recipient}
- Hora agendada: ${messageData.scheduledAt}
- Mensagem: ${messageData.message}`);

                await sendMessage(client, messageData);

                messageData.status = 'sent';
                messageData.sentAt = new Date().toISOString();
            }
        }

        saveScheduledMessages(messages);
    });
}

function checkScheduledMessagesPeriodically(client) {
    setInterval(async () => {
        if (isScheduledMessageProcessing) return; // Evita múltiplas execuções simultâneas

        console.log('Verificação periódica de mensagens agendadas...');
        const messages = loadScheduledMessages();
        const now = new Date();

        for (const messageData of messages) {
            const scheduledTime = new Date(messageData.scheduledAt);

            if (messageData.status === 'approved' && scheduledTime <= now && messageData.sentAt === null) {
                console.log(`Mensagem agendada encontrada para envio:
- Destinatário: ${messageData.recipient}
- Hora agendada: ${messageData.scheduledAt}
- Mensagem: ${messageData.message}`);

                await sendMessage(client, messageData);

                messageData.status = 'sent';
                messageData.sentAt = new Date().toISOString();
            }
        }

        saveScheduledMessages(messages);
    }, 60000); // Verificação a cada minuto
}

// Captura todas as mensagens, realiza backup e, para áudios, executa funções extras se configuradas
client.on('message_create', async msg => {
    await backupMessage(msg);                       // Realiza o backup de todas as mensagens
    await handleAudioFeatures(msg);                 // Executa funções extras para áudios, se configuradas
    await handleDocumentFeatures(msg);              // Resumo de documentos
});

client.on('authenticated', () => {
    console.log('Sessão autenticada!');
});

client.on('auth_failure', () => {
    console.error('Falha na autenticação. Verifique o QR Code.');
});

client.initialize();