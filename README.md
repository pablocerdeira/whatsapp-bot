# WhatsApp Bot com Transcrição de Áudio e Resumo de Documentos

Este projeto é um bot para WhatsApp que realiza o backup de mensagens, transcrição automática de áudios, e resumo de documentos enviados para conversas privadas e grupos. A transcrição é realizada com o Whisper, enquanto o resumo de documentos utiliza a API da OpenAI.

## Funcionalidades

- **Backup de Mensagens**: Salva todas as mensagens recebidas, incluindo texto, áudios, imagens, e outros tipos de mídia.
- **Transcrição Automática de Áudios**:
  - Em **conversas privadas**, transcreve todos os áudios automaticamente e responde no mesmo chat.
  - Em **grupos**, transcreve apenas se configurado no arquivo `config.json`.
- **Resumo de Documentos (PDF, DOC, DOCX)**:
  - Em **conversas privadas**, resume automaticamente os documentos e responde com o resumo.
  - Em **grupos**, resume apenas se configurado em `config.json`.
- **Configuração Customizável**: Utilize `config.json` para definir configurações específicas para cada grupo.

## Requisitos

- Node.js (versão 16 ou superior)
- Conta de desenvolvedor na OpenAI para uso da API GPT-4
- Biblioteca Whisper instalada (para transcrição de áudios)
- Pacotes adicionais para manipulação de documentos e transcrição:
  ```bash
  npm install whatsapp-web.js qrcode-terminal fs path child_process pdf-parse mammoth textract openai

## Instalação

	1.	Clone o repositório:

```
git clone https://github.com/pablocerdeira/whatsapp-bot
cd whatsapp-bot
```

	2.	Instale as dependências:

```
npm install
```

	3.	Configure a chave da API da OpenAI:
	•	Crie um arquivo .env na raiz do projeto e adicione a chave da API da OpenAI:

```
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

	4.	Execute o bot:

```
node bot.js
```

	5.	Escaneie o QR Code exibido no terminal para autenticar o bot no WhatsApp Web.

## Estrutura de Diretórios

O bot cria uma estrutura de diretórios para armazenar as mensagens e mídias recebidas:
	•	whatsapp-backup: Diretório principal de backup.
	•	chats: Contém subpastas para cada chat ou grupo, organizadas por ID do chat.
	•	media: Dentro de cada chat, uma pasta media armazena todos os arquivos de mídia.

### Configuração (config.json)

Exemplo de um arquivo config.json:
```
{
    "chats": {
        "group-id-1": {
            "transcribeAudio": true,
            "sendAudioToTranscriptGroup": true,
            "sendTranscriptionTo": "same_chat",
            "summarizeDocuments": true
        },
        "group-id-2": {
            "summarizeDocuments": false
        }
    }
}
```
Opções de Configuração para Cada Chat

	•	transcribeAudio: Define se o áudio deve ser transcrito automaticamente.
	•	sendAudioToTranscriptGroup: Encaminha o áudio para um grupo específico para transcrições.
	•	sendTranscriptionTo: Define onde enviar a transcrição (same_chat para o mesmo chat, ou transcriptionGroup para o grupo de transcrições).
	•	summarizeDocuments: Define se os documentos devem ser resumidos.

## Funcionalidades do Código

### Backup de Mensagens

	•	Todas as mensagens recebidas são salvas em arquivos .json, mantendo um histórico de mensagens para cada chat ou grupo.
	•	Mídias são armazenadas em uma subpasta media.

### Transcrição Automática de Áudios

	•	Utiliza Whisper para realizar a transcrição de arquivos .ogg.
	•	Em chats privados, o áudio é transcrito e enviado de volta ao mesmo chat.
	•	Em grupos, o áudio só é transcrito se configurado no config.json.

### Resumo Automático de Documentos

	•	Suporta arquivos PDF, DOC e DOCX.
	•	Utiliza a API da OpenAI para gerar um resumo objetivo do conteúdo.
	•	Em chats privados, resume automaticamente todos os documentos.
	•	Em grupos, resume apenas se configurado.

### Tratamento de Erros

	•	Tentativas de Transcrição: Para garantir que o arquivo de transcrição foi gerado, o código verifica sua existência e limita o número de tentativas.
	•	Ignora Status do WhatsApp: O bot ignora automaticamente mensagens do status@broadcast para evitar transcrições desnecessárias.

## Contribuições

Contribuições são bem-vindas! Por favor, envie um pull request ou abra uma issue para discutir mudanças.

## Licença

Este projeto é distribuído sob a licença MIT.
