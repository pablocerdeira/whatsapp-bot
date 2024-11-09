# WhatsApp Bot with AI-Powered Transcription and Document Summarization

This project is an advanced WhatsApp bot that brings Artificial Intelligence capabilities to your chats. It automatically backs up messages, transcribes audio files using Whisper, and summarizes documents with the OpenAI API, making your WhatsApp experience more efficient and productive.

## Features

- **Message Backup**: Stores all received messages, including text, audio, images, and other media types.
- **AI-Powered Audio Transcription**:
  - In **private chats**, automatically transcribes all audio messages and replies in the same chat.
  - In **groups**, transcribes only if configured in the `config.json` file.
- **AI-Powered Document Summarization (PDF, DOC, DOCX)**:
  - In **private chats**, summarizes documents automatically and replies with the summary.
  - In **groups**, summarizes documents only if configured in `config.json`.
- **Customizable Configuration**: Use `config.json` to define specific settings for each group or chat.

## Requirements

- Node.js (version 16 or higher)
- OpenAI developer account for GPT-4 API access
- Whisper library installed (for audio transcription)
- Additional packages for document processing and transcription:

```
npm install whatsapp-web.js qrcode-terminal fs path child_process pdf-parse mammoth textract openai dotenv
```

## Installation

1. Clone the repository:

```
git clone https://github.com/pablocerdeira/whatsapp-bot
cd whatsapp-bot
```

2. Install dependencies:

```
npm install
```

3. Configure your OpenAI API key:

- Create a `.env` file in the root of the project and add your OpenAI API key:

```
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

4. Run the bot:

```
node bot.js
```

5. Scan the QR Code displayed in the terminal to authenticate the bot with WhatsApp Web.

## Directory Structure

The bot creates a directory structure to store received messages and media files:

- `whatsapp-backup`: Main backup directory.
- `chats`: Contains subfolders for each chat or group, organized by chat ID.
- `media`: Stores all media files within each chat's folder.

### Configuration (`config.json`)

Example of a `config.json` file:

```json
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
    },
    "whisperPath": "/path/to/whisper"
}
```

#### Configuration Options

- **transcribeAudio**: Automatically transcribe audio messages.
- **sendAudioToTranscriptGroup**: Forwards audio messages to a specific transcription group.
- **sendTranscriptionTo**: Specifies where to send the transcription (`same_chat` for the same chat, or `transcriptionGroup` for a dedicated group).
- **summarizeDocuments**: Automatically summarizes documents.
- **whisperPath**: Path to the Whisper executable for transcription.

## Code Functionality

### Message Backup

- All received messages are saved in `.json` files, maintaining a history for each chat or group.
- Media files are stored in a `media` subfolder.

### AI-Powered Audio Transcription

- Uses Whisper to transcribe `.ogg` audio files.
- In private chats, transcribes and replies with the transcription.
- In groups, transcribes only if configured in `config.json`.

### AI-Powered Document Summarization

- Supports PDF, DOC, and DOCX files.
- Uses OpenAI API to generate concise summaries of document content.
- Automatically summarizes documents in private chats; in groups, only if configured.

### Error Handling

- **Retry Mechanism**: Ensures transcription is completed by checking for the existence of the output file, with a limit on the number of attempts.
- **Broadcast Messages Ignored**: Automatically ignores messages from `status@broadcast` to prevent unnecessary processing.

## AI Integration

This bot leverages state-of-the-art AI models for text processing and understanding, including:
- **OpenAI's GPT-4** for generating concise and accurate document summaries.
- **Whisper AI** for high-quality transcription of audio messages, enabling seamless understanding of voice notes.

## Contributions

Contributions are welcome! Feel free to open a pull request or issue to discuss changes and improvements.

## License

This project is licensed under the MIT License.