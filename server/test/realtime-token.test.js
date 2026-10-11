/**
 * Live test: requires OPENAI_API_KEY in repo .env (no mocks).
 * Run: cd server && npm test
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { createEphemeralRealtimeToken, CURSOR_VOICE_TOOLS } = require('../realtime-token');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('SKIP: set OPENAI_API_KEY in cursor-voice/.env');
    process.exit(0);
  }
  if (CURSOR_VOICE_TOOLS.length !== 5) {
    throw new Error(`expected 5 tools, got ${CURSOR_VOICE_TOOLS.length}`);
  }
  const token = await createEphemeralRealtimeToken();
  if (token.status !== 'success' || !token.client_secret?.value) {
    throw new Error('token shape invalid');
  }
  console.log('OK ephemeral token', token.id, 'expires', token.client_secret.expires_at);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
