const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');
const cron = require('node-cron');

const CONFIG_FILE = path.resolve(__dirname, 'config.json');
let config = loadConfig();

const CHAT_NAMES_FILE = './whatsapp-backup/chat_names.json';
const BACKUP_PATH = './whatsapp-backup/chats';
const SCHEDULED_MESSAGES_FILE = './scheduled-messages.json';

// Configuração da API OpenAI
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// Função para carregar configurações
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    } catch (error) {
        console.error('Erro ao carregar o config.json:', error);
        return {};
    }
}

// Função para escolher o serviço de IA para resumo
async function generateSummary(text) {
    const service = config.service || "openai";
    const model = service === "openai" ? config.openai.model : config.ollama.model;
    const baseUrl = config.ollama?.base_url || "http://localhost:11434";

    if (service === "openai") {
        return await generateSummaryWithOpenAI(text, model);
    } else if (service === "ollama") {
        return await generateSummaryWithOllama(text, model, baseUrl);
    } else {
        console.error(`Serviço de IA inválido: ${service}`);
        return null;
    }
}

// Função para gerar resumo usando OpenAI
async function generateSummaryWithOpenAI(text, model) {
    try {
        const response = await openai.createChatCompletion({
            model,
            messages: [{ role: "user", content: `Faça um resumo estruturado das mensagens a seguir: ${text}` }],
            max_tokens: 800
        });
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error(`Erro ao gerar resumo com OpenAI: ${error.message}`);
        return null;
    }
}

// Função para gerar resumo usando Ollama
async function generateSummaryWithOllama(text, model, baseUrl) {
    try {
        const response = await axios.post(`${baseUrl}/api/generate`, {
            model,
            prompt: `Faça um resumo estruturado das mensagens a seguir: ${text}`,
            stream: false
        });
        return response.data?.response?.trim() || null;
    } catch (error) {
        console.error(`Erro ao gerar resumo com Ollama: ${error.message}`);
        return null;
    }
}

// Função para agendar resumos usando cron
function scheduleSummaries() {
    const summaryConfig = config.summaryConfig;

    // Agendar resumos para conversas privadas
    if (summaryConfig.analyzeAllPrivateChats.enabled) {
        cron.schedule(summaryConfig.analyzeAllPrivateChats.schedule, () => {
            analyzeChats('private', summaryConfig.analyzeAllPrivateChats);
        });
    }

    // Agendar resumos para grupos
    if (summaryConfig.analyzeAllGroups.enabled) {
        cron.schedule(summaryConfig.analyzeAllGroups.schedule, () => {
            analyzeChats('group', summaryConfig.analyzeAllGroups);
        });
    }

    // Agendar resumos para chats configurados individualmente
    Object.entries(summaryConfig.chats).forEach(([chatId, chatConfig]) => {
        cron.schedule(chatConfig.schedule, () => {
            analyzeChat(chatId, chatConfig);
        });
    });

    console.log('Agendamentos configurados com sucesso.');
}

// Função para analisar chats
function analyzeChats(type, config) {
    const chatNames = loadChatNames();
    Object.keys(chatNames).forEach(chatId => {
        const isGroup = chatId.includes('@g.us');
        if ((type === 'private' && !isGroup) || (type === 'group' && isGroup)) {
            analyzeChat(chatId, config);
        }
    });
}

// Função para analisar um chat específico
async function analyzeChat(chatId, chatConfig) {
    const chatPath = path.join(BACKUP_PATH, chatId, 'messages.json');
    if (!fs.existsSync(chatPath)) return;

    const messages = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
    const filteredMessages = filterMessagesByDate(messages, chatConfig.frequency);

    const results = [];
    if (chatConfig.types.includes('messageStats')) results.push(generateMessageStats(filteredMessages));
    if (chatConfig.types.includes('authorStats')) results.push(generateAuthorStats(filteredMessages));
    if (chatConfig.types.includes('themeSummary')) {
        const summary = await generateThemeSummary(filteredMessages);
        if (summary) results.push(summary);
    }
    if (chatConfig.types.includes('followUps')) {
        const followUps = await identifyFollowUps(filteredMessages);
        if (followUps) results.push(followUps);
    }

    chatConfig.recipients.forEach(recipient => {
        results.forEach(report => scheduleReport(chatId, report, recipient));
    });
}

// Função para gerar resumo de temas
async function generateThemeSummary(messages) {
    const text = messages.map(msg => msg.body).join('\n');
    return await generateSummary(text);
}

// Função para identificar follow-ups
async function identifyFollowUps(messages) {
    const text = messages.map(msg => msg.body).join('\n');
    const prompt = `Identifique possíveis follow-ups e tarefas não resolvidas nas mensagens a seguir: ${text}`;
    return await generateSummary(prompt);
}

// Funções auxiliares
// Função para gerar estatísticas de mensagens
function generateMessageStats(messages) {
    const totalMessages = messages.length;
    const totalLinks = messages.filter(msg => /https?:\/\//.test(msg.body)).length;
    const totalMedia = messages.filter(msg => msg.hasMedia).length;
    const totalText = messages.filter(msg => msg.type === 'chat').length;

    return `📊 *Estatísticas de Mensagens:*
- Total de mensagens: ${totalMessages}
- Total de links: ${totalLinks}
- Total de mídias: ${totalMedia}
- Total de mensagens de texto: ${totalText}`;
}

// Função para gerar estatísticas dos autores
function generateAuthorStats(messages) {
    const authorStats = {};
    messages.forEach(msg => {
        const author = msg.fromMe ? 'Você' : (msg.authorName || msg.from);
        if (!authorStats[author]) {
            authorStats[author] = { messages: 0, media: 0 };
        }
        authorStats[author].messages += 1;
        if (msg.hasMedia) authorStats[author].media += 1;
    });

    let statsReport = `👥 *Estatísticas dos Autores:*\n`;
    for (const [author, stats] of Object.entries(authorStats)) {
        statsReport += `- ${author}: ${stats.messages} mensagens, ${stats.media} mídias\n`;
    }

    return statsReport;
}

// Função para filtrar mensagens por data
function filterMessagesByDate(messages, frequency) {
    const now = new Date();
    let startDate;

    switch (frequency) {
        case 'last day':
            startDate = new Date(now.setDate(now.getDate() - 1));
            break;
        case 'last week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
        case 'last month':
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
        case 'last year':
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
        default:
            console.warn(`Frequência desconhecida: ${frequency}. Utilizando 'last week' como padrão.`);
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
    }

    return messages.filter(msg => new Date(msg.timestamp * 1000) >= startDate);
}

// Função para agendar envio de relatório
function scheduleReport(chatId, report, recipient) {
    const messages = loadScheduledMessages();
    messages.push({
        id: Date.now().toString(),
        recipient,
        message: report,
        scheduledAt: new Date().toISOString(),
        status: 'approved',
        sentAt: null
    });
    saveScheduledMessages(messages);
}

// Inicializar agendamentos
scheduleSummaries();