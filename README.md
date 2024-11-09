
# WhatsApp Bot with AI-Powered Transcription and Document Summarization

This project is an advanced WhatsApp bot that leverages artificial intelligence for automated audio transcription and document summarization. It uses Whisper for transcription and offers a choice between OpenAI's API and the Ollama local model for document summarization.

## Key Features

- **Message Backup**: Automatically saves all received messages, including text, audio, images, and other media.
- **AI-Powered Audio Transcription**:
  - In **private chats**, it transcribes all audio messages automatically and replies in the same chat.
  - In **groups**, transcription is performed only if enabled in the `config.json` file.
- **AI-Powered Document Summarization (PDF, DOC, DOCX)**:
  - In **private chats**, it summarizes documents automatically and replies with the summary.
  - In **groups**, summarization is performed only if enabled in the `config.json` file.
- **Configurable Options**: Use `config.json` to define specific settings for each group and choose between using OpenAI's API or the local Ollama model.

## Requirements

- Node.js (version 16 or higher)
- An OpenAI developer account for using the GPT-4 API
- Ollama installed locally for using the Llama model
- Whisper installed for audio transcription
- Additional packages for document processing and API requests:

```bash
npm install whatsapp-web.js qrcode-terminal fs path child_process pdf-parse mammoth textract openai axios
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

5. Run the bot:

```bash
node bot.js
```

6. Scan the QR Code displayed in the terminal to authenticate the bot with WhatsApp Web.

## Configuration (`config.json`)

Example configuration file (`config.json`):

```json
{
    "service": "openai",
    "openai": {
        "model": "gpt-4o-mini"
    },
    "ollama": {
        "model": "llama2",
        "base_url": "http://localhost:11434"
    },
    "whisperPath": "/path/to/whisper",
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

### Error Handling

- **Retry Mechanism**: Includes retry logic for API rate limits with exponential backoff.
- **Ignored Status Messages**: Automatically ignores messages from `status@broadcast` to prevent unnecessary processing.

## Contributions

Contributions are welcome! Please submit a pull request or open an issue to discuss any changes.

## License

This project is licensed under the MIT License.
