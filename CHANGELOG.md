Changelog for WhatsApp Bot
========================

## [Unreleased] - 2025-04-23

### Changed
- Added global error handlers (unhandledRejection and uncaughtException) in bot.js for Node v22 compatibility.
- Switched to puppeteer-core referencing system Chrome/Chromium (via PUPPETEER_EXECUTABLE_PATH) to reduce memory usage.
- Adjusted Puppeteer headless flags for stability with whatsapp-web.js on Node v22.
- Implemented dynamic summary service selection using config.service (OpenAI vs Ollama).
- Introduced retry and exponential backoff logic in summary generation to handle rate limits.
- Enabled auto-reload of configuration on config.json changes via fs.watchFile.

### Fixed
- Resolved ProtocolError: Page.navigate: Target closed by refining Puppeteer launch options.