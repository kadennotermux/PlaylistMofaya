# 🎵 PlaylistMoto: AI-Powered Playlist Generator

**PlaylistMoto** is a smart, AI-driven web application that helps you discover new music and instantly create custom YouTube playlists. Simply search for a song you love, and our AI will build a perfectly curated playlist based on that "seed" track.

---

## ✨ Key Features

- 🔍 **Smart Search**: Find any song, artist, or music video directly from YouTube's massive library.
- 🤖 **AI-Powered Recommendations**: Uses **Google Gemini** to analyze your selected song and suggest similar tracks that match the vibe and genre.
- 📝 **One-Click Playlist Creation**: Automatically creates a new, private playlist in your YouTube account with all the recommended songs.
- 🎨 **Modern & Responsive UI**: A sleek, dark-themed interface built with **Tailwind CSS** and smooth animations powered by **Motion**.
- 🛡️ **Secure Authentication**: Uses official **Google OAuth 2.0** to securely connect to your YouTube account without ever seeing your password.
- ⚡ **Optimized Performance**: Features built-in **Exponential Backoff** to handle API rate limits gracefully and ensure a smooth experience.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons, Motion.
- **Backend**: Node.js, Express.
- **AI Engine**: Google Gemini API (`gemini-3-flash-preview`).
- **Music API**: YouTube Data API v3.
- **Deployment**: Fully prepared for hosting on **Render.com**.

---

## 🚀 Getting Started

### 1. Prerequisites
- A **Google Cloud Project** with the YouTube Data API v3 enabled.
- An **OAuth 2.0 Client ID** and Secret from the Google Cloud Console.
- A **Google AI Studio** API key for Gemini.

### 2. Environment Variables
Create a `.env` file in the root directory and add the following:
```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLIENT_ID=your_youtube_client_id
GOOGLE_CLIENT_SECRET=your_youtube_client_secret
APP_URL=http://localhost:3000
NODE_ENV=development
```

### 3. Installation
```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

---

## ☁️ Deployment (Render.com)

This project is optimized for **Render.com**. 

1. Connect your GitHub repository to Render.
2. Set the **Build Command** to: `npm install && npm run build`
3. Set the **Start Command** to: `npm start`
4. Add your environment variables in the Render dashboard.
5. Update your **Authorized Redirect URIs** in the Google Cloud Console to match your Render URL (e.g., `https://your-app.onrender.com/auth/callback`).

---

## 👤 Author

**Gingersketchy**
- [GitHub](https://github.com/gingersketchy)

---

*Made with ❤️ and AI.*
