import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import cookieParser from "cookie-parser";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: "spotify-playlist-generator-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: true,
      sameSite: "none",
      httpOnly: true,
    },
  })
);

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${APP_URL.trim().replace(/\/$/, "")}/auth/callback`;

console.log("-----------------------------------------");
console.log("PlaylistMoto Server Starting (YouTube Mode)...");
console.log("- APP_URL:", APP_URL);
console.log("- REDIRECT_URI:", REDIRECT_URI);
console.log("- GOOGLE_CLIENT_ID:", GOOGLE_CLIENT_ID ? "✅ Set" : "❌ MISSING");
console.log("- GOOGLE_CLIENT_SECRET:", GOOGLE_CLIENT_SECRET ? "✅ Set" : "❌ MISSING");
console.log("-----------------------------------------");

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    youtubeConfigured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    clientId: GOOGLE_CLIENT_ID,
    redirectUri: REDIRECT_URI
  });
});

// Auth URL endpoint
app.get("/api/auth/url", (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: "Google Client ID not configured" });
  }
  const scope = "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.profile";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GOOGLE_CLIENT_ID,
    scope: scope,
    redirect_uri: REDIRECT_URI,
    access_type: "offline",
    prompt: "consent",
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

// Callback endpoint
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    return res.send("Error: No code provided");
  }

  try {
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token } = response.data;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS', 
                payload: { access_token: '${access_token}', refresh_token: '${refresh_token}' } 
              }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Token exchange error:", error.response?.data || error.message);
    res.status(500).send("Authentication failed");
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

// Only listen if not on Vercel
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
