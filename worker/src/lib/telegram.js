/**
 * Telegram notification utilities
 */

const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

/**
 * Send a message via Telegram
 */
export async function sendTelegram(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('Telegram not configured, skipping notification');
    return { success: false, reason: 'not_configured' };
  }

  const url = `${TELEGRAM_API_URL}${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Telegram send failed:', error);
      return { success: false, reason: error };
    }

    return { success: true };
  } catch (error) {
    console.error('Telegram send error:', error);
    return { success: false, reason: error.message };
  }
}
