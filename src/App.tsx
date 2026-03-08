/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Music, Plus, Check, Loader2, LogOut, Sparkles, Play, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

// Types
interface Track {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { images: { url: string }[] };
  uri: string;
  external_urls: { spotify: string };
}

interface YouTubeVideo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  videoId: string;
}

interface UserProfile {
  display_name: string;
  id: string;
  images: { url: string }[];
}

export default function App() {
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('youtube_access_token'));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeVideo[]>([]);
  const [selectedSeedTrack, setSelectedSeedTrack] = useState<YouTubeVideo | null>(null);
  const [recommendations, setRecommendations] = useState<YouTubeVideo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [createdPlaylistUrl, setCreatedPlaylistUrl] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [show403Modal, setShow403Modal] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'checking' | 'active' | 'error'>('checking');

  // Exponential Backoff Utility
  const fetchWithBackoff = async (url: string, options: RequestInit, maxRetries = 3): Promise<Response> => {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const response = await fetch(url, options);
        
        // If success or quota exceeded (403), return immediately
        // Quota exceeded is not a transient error, backoff won't help
        if (response.ok || response.status === 403) return response;
        
        // If rate limited (429) or server error (5xx), retry with backoff
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          retries++;
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.warn(`Rate limit or server error (${response.status}). Retrying in ${Math.round(delay)}ms... (Attempt ${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        return response;
      } catch (err) {
        retries++;
        if (retries >= maxRetries) throw err;
        const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return fetch(url, options);
  };

  // Initialize Gemini
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // Check Gemini Status
  useEffect(() => {
    const checkGemini = async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined') {
        console.error('Gemini API Key is missing or undefined in the browser.');
        setGeminiStatus('error');
        return;
      }
      try {
        const response = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Say 'ok'",
        });
        if (response.text) {
          setGeminiStatus('active');
          console.log('Gemini connection successful');
        } else {
          console.error('Gemini returned an empty response');
          setGeminiStatus('error');
        }
      } catch (err: any) {
        console.error('Gemini check failed:', err);
        // Check for specific error types if possible
        if (err.message?.includes('API_KEY_INVALID')) {
          console.error('The provided Gemini API Key is invalid.');
        }
        setGeminiStatus('error');
      }
    };
    checkGemini();
  }, []);

  // Check Configuration
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Received non-JSON response from server");
        }

        const data = await res.json();
        setIsConfigured(data.youtubeConfigured);
        if (data.clientId) setClientId(data.clientId);
        if (data.redirectUri) setRedirectUri(data.redirectUri);
      } catch (err) {
        console.error('Failed to check config:', err);
        // If it's a "Unexpected token" error, it's likely the platform's loading page
        setIsConfigured(false);
      }
    };
    
    // Small delay to ensure server is ready
    const timer = setTimeout(checkConfig, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Handle OAuth Success
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.endsWith('.vercel.app')) return;

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const { access_token } = event.data.payload;
        setAccessToken(access_token);
        localStorage.setItem('youtube_access_token', access_token);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fetch User Profile
  const fetchUserProfile = useCallback(async (token: string) => {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (res.status === 401) {
        handleLogout();
        return;
      }

      if (!res.ok) {
        throw new Error(`Google API error! status: ${res.status}`);
      }

      const data = await res.json();
      setUser({
        display_name: data.name || 'YouTube User',
        id: data.sub,
        images: [{ url: data.picture || '' }]
      });
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      fetchUserProfile(accessToken);
    }
  }, [accessToken, fetchUserProfile]);

  // Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2 && !selectedSeedTrack) {
        performSearch(searchQuery);
      } else if (searchQuery.length === 0) {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, accessToken, selectedSeedTrack]);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const { url } = await res.json();
      window.open(url, 'spotify_login', 'width=600,height=700');
    } catch (err) {
      setError('Failed to initiate login');
    }
  };

  const handleLogout = () => {
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('youtube_access_token');
  };

  const searchTracks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !accessToken) return;
    performSearch(searchQuery);
  };

  const performSearch = async (query: string) => {
    if (!accessToken) return;

    setIsSearching(true);
    setError(null);

    try {
      const res = await fetchWithBackoff(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=5&videoCategoryId=10`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (res.status === 401) {
        handleLogout();
        setError('Session expired. Please log in again.');
        return;
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || `Search failed (Status: ${res.status})`);
      }

      const data = await res.json();
      const videos: YouTubeVideo[] = data.items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium.url,
        videoId: item.id.videoId
      }));

      // Filter out duplicates by videoId
      const uniqueVideos = videos.filter((v, index, self) =>
        index === self.findIndex((t) => t.videoId === v.videoId)
      );
      
      setSearchResults(uniqueVideos);
    } catch (err: any) {
      console.error('Search error:', err);
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const generateRecommendations = async (video: YouTubeVideo) => {
    if (!accessToken) return;
    setSelectedSeedTrack(video);
    setIsGenerating(true);
    setCreatedPlaylistUrl(null);
    setError(null);

    try {
      // Step 1: Use Gemini to suggest similar tracks
      const model = genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Suggest 25 songs similar to "${video.title}" by "${video.channelTitle}". 
        Return only the song titles and artists.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                artist: { type: Type.STRING }
              },
              required: ["title", "artist"]
            }
          }
        }
      });

      const geminiResponse = await model;
      const suggestedTracks = JSON.parse(geminiResponse.text || "[]");

      // Step 2: Search for each suggested track on YouTube
      // We'll search for up to 18 suggestions to save quota
      const tracksToSearch = suggestedTracks.slice(0, 18);
      
      // Parallelize searches with Promise.all for speed
      const searchPromises = tracksToSearch.map(async (track: any) => {
        try {
          const searchQuery = `${track.title} ${track.artist}`;
          const searchRes = await fetchWithBackoff(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&maxResults=1&videoCategoryId=10`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.items && searchData.items.length > 0) {
              const item = searchData.items[0];
              return {
                id: item.id.videoId,
                title: item.snippet.title,
                channelTitle: item.snippet.channelTitle,
                thumbnail: item.snippet.thumbnails.medium.url,
                videoId: item.id.videoId
              };
            }
          }
        } catch (err) {
          console.warn(`Failed to search for ${track.title}`, err);
        }
        return null;
      });

      const results = await Promise.all(searchPromises);
      const recommendedVideos = results.filter((v): v is YouTubeVideo => v !== null);
      
      // Filter out duplicates by videoId
      const uniqueRecommendations = recommendedVideos.filter((v, index, self) =>
        index === self.findIndex((t) => t.videoId === v.videoId)
      );

      if (uniqueRecommendations.length === 0) {
        throw new Error("Could find any similar videos on YouTube.");
      }

      setRecommendations(uniqueRecommendations);
      setPlaylistName(`PlaylistMoto: Inspired by ${video.title}`);
    } catch (err: any) {
      console.error('Recommendation error:', err);
      setError(err.message || 'Failed to generate recommendations.');
    } finally {
      setIsGenerating(false);
    }
  };

  const createPlaylist = async () => {
    if (!accessToken || !user || recommendations.length === 0 || !selectedSeedTrack) return;

    setIsCreatingPlaylist(true);
    setError(null);

    try {
      // Create Playlist
      const createRes = await fetchWithBackoff(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title: playlistName || `PlaylistMoto: Inspired by ${selectedSeedTrack.title}`,
            description: `AI-generated playlist based on ${selectedSeedTrack.title}. Generated by PlaylistMoto.`,
          },
          status: {
            privacyStatus: 'private',
          },
        }),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json();
        throw new Error(errorData.error?.message || `Playlist creation failed (Status: ${createRes.status})`);
      }

      const playlist = await createRes.json();

      // Add Tracks (Parallelized for speed)
      const addPromises = recommendations.map(async (video) => {
        try {
          await fetchWithBackoff(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              snippet: {
                playlistId: playlist.id,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: video.videoId,
                },
              },
            }),
          });
        } catch (err) {
          console.warn(`Failed to add video ${video.title} to playlist`, err);
        }
      });

      await Promise.all(addPromises);

      setCreatedPlaylistUrl(`https://music.youtube.com/playlist?list=${playlist.id}`);
    } catch (err: any) {
      console.error('Playlist creation error:', err);
      setError(err.message || 'Failed to create playlist.');
    } finally {
      setIsCreatingPlaylist(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-red-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-600/20">
              <Music className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight font-display leading-none">PlaylistMoto</h1>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full ${
                  geminiStatus === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                  geminiStatus === 'error' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 
                  'bg-white/20 animate-pulse'
                }`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Gemini {geminiStatus === 'active' ? 'Active' : geminiStatus === 'error' ? 'Offline' : 'Checking...'}
                </span>
              </div>
            </div>
          </div>

          {accessToken ? (
            <div className="flex items-center gap-4">
              {user && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                  {user.images?.[0]?.url && (
                    <img src={user.images[0].url} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                  )}
                  <span className="text-sm font-medium">{user.display_name}</span>
                </div>
              )}
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full transition-all active:scale-95"
            >
              Connect YouTube
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        {isConfigured === false && (
          <div className="mb-12 p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-200">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              YouTube API Keys Missing
            </h3>
            <p className="text-sm opacity-80 mb-4">
              To use this app, you need to set your Google Client ID and Secret in your deployment environment variables (Vercel or AI Studio).
            </p>
            <div className="bg-black/20 p-4 rounded-xl font-mono text-xs space-y-1">
              <p className="flex justify-between"><span>GOOGLE_CLIENT_ID</span> <span className={clientId ? "text-emerald-500" : "text-red-500"}>{clientId ? "✅ Set" : "❌ Missing"}</span></p>
              <p className="flex justify-between"><span>GOOGLE_CLIENT_SECRET</span> <span className="text-white/40 italic">Hidden for security</span></p>
            </div>
            {window.location.hostname.includes('vercel.app') && (
              <p className="mt-4 text-xs text-amber-200/60 italic">
                Tip: Since you are on Vercel, make sure these are added in your Vercel Project Settings and that you have redeployed.
              </p>
            )}
          </div>
        )}

        {!accessToken ? (
          <div className="text-center py-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <h2 className="text-5xl sm:text-7xl font-bold tracking-tighter leading-none font-display">
                Your next favorite <br />
                <span className="text-red-600">playlist</span> starts here.
              </h2>
              <p className="text-xl text-white/60 max-w-xl mx-auto">
                Connect your YouTube account to generate AI-powered playlists based on the songs you love.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button 
                  onClick={handleLogin}
                  className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold text-lg rounded-full transition-all shadow-xl shadow-red-600/20 active:scale-95"
                >
                  Get Started with YouTube
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Search Section */}
            <section className="space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold tracking-tight font-display">What are you listening to?</h2>
                <p className="text-white/60">Type a song name to find similar tracks.</p>
              </div>

              <div className="relative max-w-2xl mx-auto">
                <form onSubmit={searchTracks} className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (selectedSeedTrack) setSelectedSeedTrack(null);
                    }}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                    placeholder="Search for a song..."
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 pl-14 text-lg focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                  />
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-white/40" />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {isSearching && <Loader2 className="w-5 h-5 animate-spin text-red-600" />}
                    <button 
                      type="submit"
                      disabled={isSearching}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                    >
                      Search
                    </button>
                  </div>
                </form>

                {/* Dropdown Search Results */}
                <AnimatePresence>
                  {isSearchFocused && searchResults.length > 0 && !selectedSeedTrack && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[60]"
                    >
                      <div className="p-2 grid gap-1">
                        {searchResults.map((video, idx) => (
                          <button
                            key={`${video.id}-${idx}`}
                            onClick={() => {
                              generateRecommendations(video);
                              setIsSearchFocused(false);
                            }}
                            className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-all group text-left"
                          >
                            <img src={video.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold truncate text-sm">{video.title}</h4>
                              <p className="text-xs text-white/40 truncate">{video.channelTitle}</p>
                            </div>
                            <Sparkles className="w-4 h-4 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* Recommendations Section */}
            <AnimatePresence>
              {(isGenerating || recommendations.length > 0) && (
                <motion.section
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-8"
                >
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-white/10 pt-12">
                    <div className="flex items-center gap-4 flex-1 w-full">
                      {selectedSeedTrack && (
                        <>
                          <img src={selectedSeedTrack.thumbnail} alt="" className="w-16 h-16 rounded-xl shadow-2xl" referrerPolicy="no-referrer" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-red-600 uppercase tracking-widest">Inspired by</p>
                            <input
                              type="text"
                              value={playlistName}
                              onChange={(e) => setPlaylistName(e.target.value)}
                              placeholder="Enter playlist name..."
                              className="w-full bg-transparent border-b border-white/10 text-xl font-bold font-display focus:border-red-600 focus:outline-none transition-colors py-1"
                            />
                            <p className="text-white/60 text-sm mt-1">{selectedSeedTrack.channelTitle}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {!createdPlaylistUrl ? (
                      <button
                        onClick={createPlaylist}
                        disabled={isCreatingPlaylist || recommendations.length === 0}
                        className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isCreatingPlaylist ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Plus className="w-5 h-5" />
                        )}
                        Save to YouTube
                      </button>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        <a
                          href={createdPlaylistUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-6 py-3 bg-white text-black font-bold rounded-full transition-all hover:bg-white/90 active:scale-95"
                        >
                          <ExternalLink className="w-5 h-5" />
                          Open in YouTube
                        </a>
                      </div>
                    )}
                  </div>

                  {isGenerating ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                      <Loader2 className="w-12 h-12 text-red-600 animate-spin" />
                      <p className="text-white/60 animate-pulse">Curating your PlaylistMoto...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {recommendations.map((video, idx) => (
                        <motion.div
                          key={`${video.id}-${idx}`}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="flex items-center gap-4 p-3 bg-white/5 border border-white/10 rounded-xl group"
                        >
                          <div className="relative">
                            <img src={video.thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover" referrerPolicy="no-referrer" />
                            <a 
                              href={`https://music.youtube.com/watch?v=${video.videoId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
                            >
                              <Play className="w-6 h-6 fill-white text-white" />
                            </a>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium truncate">{video.title}</h4>
                            <p className="text-sm text-white/60 truncate">{video.channelTitle}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        )}

        {error && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-4 bg-red-600 text-white font-bold rounded-2xl shadow-2xl flex items-center gap-4 z-[100] min-w-[300px] border border-white/10">
            <div className="flex-1">
              <p className="text-sm opacity-80 uppercase tracking-wider mb-1">Error</p>
              <p>{error}</p>
            </div>
            <div className="flex items-center gap-2">
              {show403Modal && (
                <button 
                  onClick={() => setShow403Modal(true)}
                  className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs transition-colors"
                >
                  How to fix?
                </button>
              )}
              <button 
                onClick={() => setError(null)} 
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 403 Modal */}
        <AnimatePresence>
          {show403Modal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-zinc-900 border border-white/10 rounded-3xl p-8 max-w-lg w-full shadow-2xl space-y-6"
              >
                <div className="flex items-center gap-4 text-red-600">
                  <div className="w-12 h-12 bg-red-600/10 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-bold font-display">Access Denied (403)</h3>
                </div>

                <div className="space-y-4 text-white/80">
                  <p>Google requires you to manually authorize users while your app is in "Testing" mode.</p>
                  
                  <div className="space-y-3 bg-black/40 p-6 rounded-2xl border border-white/5">
                    <p className="text-sm font-bold text-white uppercase tracking-widest">Step-by-Step Fix:</p>
                    <ol className="list-decimal list-inside space-y-2 text-sm">
                      <li>Open the <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer" className="text-red-500 underline">Google Cloud Console</a></li>
                      <li>Select your project</li>
                      <li>Go to <span className="text-white font-bold">"OAuth consent screen"</span></li>
                      <li>Under <span className="text-white font-bold">"Test users"</span>, click <span className="text-white font-bold">"Add Users"</span></li>
                      <li>Enter your Google <span className="text-white font-bold">Email</span></li>
                      <li>Click <span className="text-white font-bold">"Save"</span></li>
                    </ol>
                  </div>

                  <div className="space-y-3 bg-red-600/5 p-6 rounded-2xl border border-red-600/20">
                    <p className="text-sm font-bold text-red-500 uppercase tracking-widest">Still not working?</p>
                    <ul className="list-disc list-inside space-y-2 text-sm">
                      <li>Check if you are logged into the <span className="text-white font-bold">correct Google account</span> in this browser.</li>
                      <li>Verify the <span className="text-white font-bold">Client ID</span> matches your dashboard:
                        <div className="mt-1 p-2 bg-black/40 rounded font-mono text-[10px] break-all text-white/60">
                          {clientId || 'Loading...'}
                        </div>
                      </li>
                      <li>Verify the <span className="text-white font-bold">Redirect URI</span> is added to your dashboard:
                        <div className="mt-1 p-2 bg-black/40 rounded font-mono text-[10px] break-all text-white/60">
                          {redirectUri || 'Loading...'}
                        </div>
                      </li>
                      <li>Try <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-red-500 underline">Clearing App Cache</button> and logging in again.</li>
                    </ul>
                  </div>

                  <p className="text-xs italic">Once added, log out and log back in to PlaylistMoto.</p>
                </div>

                <button
                  onClick={() => {
                    localStorage.removeItem('youtube_access_token');
                    setAccessToken(null);
                    setShow403Modal(false);
                    handleLogin();
                  }}
                  className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-2xl transition-all active:scale-[0.98]"
                >
                  Try Re-connecting Account
                </button>
                <button
                  onClick={() => setShow403Modal(false)}
                  className="w-full py-2 text-white/40 hover:text-white/60 text-sm transition-all"
                >
                  Close
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-white/10 text-center space-y-4">
        <div className="pt-8 border-t border-white/5">
          <p className="text-white/20 text-[10px] uppercase tracking-[0.2em] mb-4">
            Built with Gemini AI & YouTube Data API
          </p>
          <div className="relative inline-block group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-600 via-orange-500 to-red-600 rounded-lg blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200 animate-gradient-x"></div>
            <p className="relative px-4 py-2 bg-black rounded-lg leading-none flex items-center">
              <span className="text-white/40 text-xs font-medium mr-2">Created by</span>
              <span className="font-accent text-xl font-extrabold bg-gradient-to-r from-red-500 to-red-800 bg-clip-text text-transparent animate-gradient-x tracking-tight">
                Gingersketchy
              </span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
