# WhatsApp Bot with AI-Powered Transcription, Document Summarization, and Advanced Scheduling

This project is an advanced WhatsApp bot that leverages artificial intelligence for automated audio transcription, document summarization, and scheduling of future messages. It uses Whisper for transcription and offers a choice between OpenAI's API and the Ollama local model for document summarization.

## Key Features

- **Message Backup**: Automatically saves all received messages, including text, audio, images, and other media.
- **AI-Powered Audio Transcription**:
  - In **private chats**, it transcribes all audio messages automatically and replies in the same chat.
  - In **groups**, transcription is performed only if enabled in the `config.json` file.
- **AI-Powered Document Summarization (PDF, DOC, DOCX)**:
  - In **private chats**, it summarizes documents automatically and replies with the summary.
  - In **groups**, summarization is performed only if enabled in the `config.json` file.
- **Configurable Options**: Use `config.json` to define specific settings for each group and choose between using OpenAI's API or the local Ollama model.
- **Advanced Message Scheduling**: Schedule messages to be sent at a future date and time using:
  - Direct JSON file updates (`scheduled-messages.json`).
  - Web interface with form submission and autocomplete for contacts.
  - REST API for integration with external applications.

## Requirements

- Node.js (version 16 or higher)
- An OpenAI developer account for using the GPT-4 API
- Ollama installed locally for using the Llama model
- Whisper installed for audio transcription
- Additional packages for document processing and API requests:

```bash
npm install whatsapp-web.js qrcode-terminal fs path child_process pdf-parse mammoth textract openai axios express express-fileupload ejs
```

## Installation

1. Clone the repository:

```bash
git clone https://github.com/pablocerdeira/whatsapp-bot
cd whatsapp-bot
```

2. Install the dependencies:

```bash
npm install
```

3. Configure your API keys:

Create a `.env` file in the project root and add your OpenAI API key:

```bash
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

4. Set up the configuration file:

Refer to the `config.json.example` for setting your preferences:

- Choose between OpenAI (`service: "openai"`) or Ollama (`service: "ollama"`) for document summarization.
- Set the model and base URL for Ollama if using it locally.

## Running the Bot as a Service

You can use `pm2` to run the bot as a service for better reliability and easier management.

### Install `pm2`:

```bash
npm install -g pm2
```

### Start the bot with `pm2`:

```bash
pm2 start bot.js --name whatsapp-bot
```

### Save the process list and enable startup on system boot:

```bash
pm2 save
pm2 startup
```

### View logs:

```bash
pm2 logs whatsapp-bot
```

## Advanced Message Scheduling

### JSON File

You can directly add new scheduled messages to `scheduled-messages.json` with the following format:

```json
{
    "id": "1731530653175",
    "recipient": "5521979327997@c.us",
    "message": "Scheduled message example",
    "attachment": "./attachments/sample.pdf",
    "scheduledAt": "2024-11-13T17:30:00",
    "status": "approved",
    "sentAt": null
}
```

### Web Interface

Access the web interface at `http://localhost:3000/` (or the port specified in your `config.json`). It allows you to:

- View all scheduled messages.
- Create new scheduled messages with autocomplete for contacts.
- Upload attachments directly from the web form.

### REST API

You can also schedule messages via the REST API, enabling integration with other applications.

#### API Endpoint: Create a Scheduled Message

- **URL**: `/api/schedule`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Body Parameters**:
  - `recipient`: WhatsApp ID of the recipient (e.g., "5521979327997@c.us").
  - `message`: The message text.
  - `scheduledAt`: Date and time for the message to be sent (e.g., "2024-11-13T17:30:00").
  - `attachment` (optional): File attachment.

**Example using `curl`**:

```bash
curl -X POST http://localhost:3000/api/schedule \
  -F "recipient=5521979327997@c.us" \
  -F "message=This is a test message with an attachment" \
  -F "scheduledAt=2024-11-13T17:30:00" \
  -F "attachment=@/path/to/file.pdf"
```

#### API Endpoint: List Scheduled Messages

- **URL**: `/api/scheduled-messages`
- **Method**: `GET`

```bash
curl http://localhost:3000/api/scheduled-messages
```

#### API Endpoint: Update a Scheduled Message

- **URL**: `/api/schedule/:id`
- **Method**: `PUT`
- **Body Parameters**:
  - `recipient`, `message`, `scheduledAt`, `status` (optional).

```bash
curl -X PUT http://localhost:3000/api/schedule/1731530653175 \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'
```

#### API Endpoint: Delete a Scheduled Message

- **URL**: `/api/schedule/:id`
- **Method**: `DELETE`

```bash
curl -X DELETE http://localhost:3000/api/schedule/1731530653175
```

## Configuration (`config.json`)

Example configuration file (`config.json`):

```json
{
    "service": "openai",
    "schedulerPort": 3000,
    "openai": {
        "model": "gpt-4o-mini"
    },
    "ollama": {
        "model": "llama2",
        "base_url": "http://localhost:11434"
    },
    "whisperPath": "/path/to/whisper",
    "chats": {
        "transcriptionGroup": "[your-user-or-grupo-to-send-transcriptions-if-not-same_chat]",
        "group-id-1": {
            "transcribeAudio": true,
            "sendAudioToTranscriptGroup": false,
            "sendTranscriptionTo": "same_chat",
            "summarizeDocuments": true
        }        },
        "group-id-2": {
            "transcribeAudio": true,
            "sendAudioToTranscriptGroup": true,
            "sendTranscriptionTo": "transcription_group",
            "summarizeDocuments": false
        }
    }
}
```
## Features Overview

### Message Backup

- Saves all received messages in `.json` files, creating a history for each chat or group.
- Media files are stored in a dedicated `media` folder within each chat's directory.

### AI-Powered Transcription

- Uses Whisper to transcribe `.ogg` audio files.
- Automatically transcribes audio in private chats and responds with the text.
- In groups, transcription is enabled based on the `config.json` settings.

### AI-Powered Document Summarization

- Supports PDF, DOC, and DOCX files.
- Offers a choice between using OpenAI's GPT model or the local Ollama model for summarization.
- In private chats, documents are summarized automatically.
- In groups, summarization is performed only if configured.

### Advanced Message Scheduling
**Flexible Scheduling Options:**
- Schedule messages for a specific date and time, with support for different time formats.**
- Supports both private chats and group messages.

**Multiple Scheduling Methods:**
- JSON File: Directly add or edit scheduled messages in the scheduled-messages.json file for quick manual entries.
- Web Interface: A user-friendly web interface with search and autocomplete features for selecting contacts, and file upload for attachments. Easily create, edit, and delete scheduled messages.
- API Integration: An API endpoint for programmatically scheduling messages. Ideal for integrating with external applications, task automation, or other bots.

**Attachment Support:**
- Upload and send attachments such as PDF, DOC, or image files along with the scheduled message.
- Automatically saves attachments to a dedicated attachments folder.

**Real-Time Monitoring:**
- Watches for updates in the scheduled-messages.json file and immediately processes changes.
- Performs periodic checks to ensure scheduled messages are sent on time, even if the file was edited manually or by an external tool.

### Error Handling and Logging

- **Retry Mechanism**: Includes retry logic for API rate limits with exponential backoff.
- **Ignored Status Messages**: Automatically ignores messages from `status@broadcast` to prevent unnecessary processing.
- **Verification**: Verifies scheduled time format and adjusts if necessary.
- **Logging**: Provides detailed logs for each scheduled action, including message creation, attachment handling, and errors during scheduling or sending.

## Contributions

Contributions are welcome! Please submit a pull request or open an issue to discuss any changes.

## License

This project is licensed under the MIT License.