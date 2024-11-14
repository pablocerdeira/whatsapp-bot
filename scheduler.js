const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Carregar o arquivo de configuração
const config = loadConfig();
const PORT = config.schedulerPort || 3000;
const SCHEDULED_MESSAGES_FILE = './scheduled-messages.json';
const CHAT_NAMES_FILE = './whatsapp-backup/chat_names.json';
const ATTACHMENTS_DIR = path.resolve(__dirname, 'attachments');

// Função para limpar e normalizar o nome do arquivo
function safeFilename(filename) {
    // Decodifica o nome do arquivo utilizando UTF-8
    const decodedFilename = Buffer.from(filename, 'latin1').toString('utf8');

    // Normaliza e substitui caracteres inválidos
    const normalizedFilename = decodedFilename.normalize('NFC');
    return normalizedFilename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

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

// Função para carregar mensagens agendadas
function loadScheduledMessages() {
    try {
        const data = fs.readFileSync(SCHEDULED_MESSAGES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao carregar mensagens agendadas:', error);
        return [];
    }
}

// Função para salvar mensagens agendadas
function saveScheduledMessages(messages) {
    fs.writeFileSync(SCHEDULED_MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Função para carregar nomes de chats
function loadChatNames() {
    try {
        const data = fs.readFileSync(CHAT_NAMES_FILE, 'utf8');
        return JSON.parse(data).chats;
    } catch (error) {
        console.error('Erro ao carregar nomes de chats:', error);
        return {};
    }
}

// Rota principal para listar agendamentos
app.get('/', (req, res) => {
    const messages = loadScheduledMessages();
    res.render('index', { messages });
});

// Rota para exibir o formulário de novo agendamento
app.get('/new', (req, res) => {
    const chatNames = loadChatNames();
    const chatList = Object.entries(chatNames).map(([id, name]) => ({
        id,
        name
    }));
    res.render('new', { chatList });
});

// Rota para buscar contatos para autocomplete
app.get('/api/contacts', (req, res) => {
    const chatNames = loadChatNames();
    const contacts = Object.entries(chatNames).map(([id, name]) => ({
        id,
        name
    }));
    res.json(contacts);
});

// Rota para adicionar novo agendamento
app.post('/schedule', async (req, res) => {
    const { recipient, message, scheduledAt } = req.body;
    const messages = loadScheduledMessages();
    let attachmentPath = null;

    // Processar o upload do anexo, se houver
    if (req.files && req.files.attachment) {
        const attachment = req.files.attachment;

        // Usa o nome original e aplica a função de normalização
        const safeName = safeFilename(attachment.name);

        // Caminho completo para salvar o anexo
        attachmentPath = path.join(ATTACHMENTS_DIR, safeName);

        try {
            // Salvar o anexo no diretório './attachments'
            await attachment.mv(attachmentPath);
            console.log(`Arquivo anexado salvo em: ${attachmentPath}`);
        } catch (error) {
            console.error(`Erro ao salvar o anexo: ${error.message}`);
            return res.status(500).send('Erro ao salvar o anexo.');
        }
    }

    const newMessage = {
        recipient,
        message,
        attachment: attachmentPath ? `./attachments/${path.basename(attachmentPath)}` : null,
        scheduledAt: `${scheduledAt}:00`,
        status: 'approved',
        sentAt: null
    };

    messages.push(newMessage);
    saveScheduledMessages(messages);

    console.log(`Novo agendamento criado:
- Destinatário: ${recipient}
- Mensagem: ${message}
- Anexo: ${attachmentPath || 'Nenhum'}
- Data e hora: ${newMessage.scheduledAt}`);

    res.redirect('/');
});

// Rotas da API REST para manipular agendamentos

// Endpoint para listar todas as mensagens agendadas
app.get('/api/scheduled-messages', (req, res) => {
    const messages = loadScheduledMessages();
    res.json(messages);
});

// Endpoint para criar um novo agendamento via API com suporte a upload de anexo
app.post('/api/schedule', async (req, res) => {
    const { recipient, message, scheduledAt } = req.body;
    const messages = loadScheduledMessages();
    let attachmentPath = null;

    // Processar o upload do anexo, se houver
    if (req.files && req.files.attachment) {
        const attachment = req.files.attachment;

        // Usa o nome original e aplica a função de normalização
        const safeName = safeFilename(attachment.name);
        attachmentPath = path.join(ATTACHMENTS_DIR, safeName);

        try {
            // Salvar o anexo no diretório './attachments'
            await attachment.mv(attachmentPath);
            console.log(`Arquivo anexado salvo em: ${attachmentPath}`);
        } catch (error) {
            console.error(`Erro ao salvar o anexo: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Erro ao salvar o anexo.' });
        }
    }

    // Função para adicionar segundos ao horário, se necessário
    function ensureSeconds(scheduledAt) {
        const hasSeconds = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(scheduledAt);
        return hasSeconds ? scheduledAt : `${scheduledAt}:00`;
    }

    // Novo agendamento
    const newMessage = {
        id: Date.now().toString(),
        recipient,
        message,
        attachment: attachmentPath ? `./attachments/${path.basename(attachmentPath)}` : null,
        scheduledAt: ensureSeconds(scheduledAt),
        status: 'approved',
        sentAt: null
    };

    messages.push(newMessage);
    saveScheduledMessages(messages);

    console.log(`Novo agendamento criado via API:
- Destinatário: ${recipient}
- Mensagem: ${message}
- Anexo: ${attachmentPath || 'Nenhum'}
- Data e hora: ${newMessage.scheduledAt}`);

    res.json({ success: true, message: 'Agendamento criado com sucesso!', data: newMessage });
});

// Endpoint para atualizar um agendamento
app.put('/api/schedule/:id', (req, res) => {
    const { id } = req.params;
    const { recipient, message, scheduledAt, status } = req.body;
    const messages = loadScheduledMessages();
    const messageIndex = messages.findIndex((msg) => msg.id === id);

    if (messageIndex === -1) {
        return res.status(404).json({ success: false, message: 'Agendamento não encontrado.' });
    }

    // Atualizar os campos permitidos
    messages[messageIndex] = {
        ...messages[messageIndex],
        recipient: recipient || messages[messageIndex].recipient,
        message: message || messages[messageIndex].message,
        scheduledAt: scheduledAt || messages[messageIndex].scheduledAt,
        status: status || messages[messageIndex].status
    };

    saveScheduledMessages(messages);
    console.log(`Agendamento atualizado via API: ${id}`);
    res.json({ success: true, message: 'Agendamento atualizado com sucesso!', data: messages[messageIndex] });
});

// Endpoint para deletar um agendamento
app.delete('/api/schedule/:id', (req, res) => {
    const { id } = req.params;
    const messages = loadScheduledMessages();
    const newMessages = messages.filter((msg) => msg.id !== id);

    if (newMessages.length === messages.length) {
        return res.status(404).json({ success: false, message: 'Agendamento não encontrado.' });
    }

    saveScheduledMessages(newMessages);
    console.log(`Agendamento removido via API: ${id}`);
    res.json({ success: true, message: 'Agendamento removido com sucesso!' });
});

// Iniciar o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scheduler rodando na porta ${PORT}`);
});