/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Upload, 
  History, 
  Star, 
  Video,
  Play, 
  Download, 
  Share2,
  Copy,
  Cross, 
  BookOpen,
  ChevronRight,
  Trash2,
  Bookmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { GoogleGenAI } from "@google/genai";

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initialize Gemini
const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is missing. Please set it in your environment variables.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

const genAI = getGenAI();

interface Verse {
  reference: string;
  text: string;
}

interface HistoryItem {
  id: string;
  keyword: string;
  timestamp: number;
  verse?: Verse;
  videoId?: string; // ID for IndexedDB storage
}

// IndexedDB helper for video storage
const DB_NAME = 'PalavraDiariaDB';
const STORE_NAME = 'videos';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveVideoToDB = async (id: string, file: File): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getVideoFromDB = async (id: string): Promise<File | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const deleteVideoFromDB = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export default function App() {
  const [keyword, setKeyword] = useState('');
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVerse, setSelectedVerse] = useState<Verse | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favorites, setFavorites] = useState<Verse[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'favorites'>('search');
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedBlob, setRenderedBlob] = useState<Blob | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load data from LocalStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('ccb_history');
    const savedFavorites = localStorage.getItem('ccb_favorites');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
    
    // Check share capability
    setCanNativeShare(!!(navigator.share && navigator.canShare));
  }, []);

  // Save data to LocalStorage
  useEffect(() => {
    localStorage.setItem('ccb_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('ccb_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const handleSearch = async (e?: React.FormEvent, searchKeyword?: string) => {
    if (e) e.preventDefault();
    const term = searchKeyword || keyword;
    if (!term.trim()) return;

    setLoading(true);
    setVerses([]);
    
    if (!genAI) {
      setLoading(false);
      showToast("Erro: Chave API não configurada.");
      return;
    }
    
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Encontre 5 versículos bíblicos (versão Almeida Corrigida Fiel) relacionados à palavra-chave: "${term}". 
        Retorne APENAS um array JSON de objetos com as propriedades: "reference" (ex: João 3:16) e "text" (o conteúdo do versículo). 
        Não inclua explicações, apenas o JSON puro.`,
        config: {
          responseMimeType: "application/json",
        }
      });

      const data = JSON.parse(response.text || "[]");
      setVerses(data);
      
      // Add to history if it's a new search
      if (!searchKeyword) {
        const newHistoryItem: HistoryItem = {
          id: Date.now().toString(),
          keyword: term,
          timestamp: Date.now(),
          verse: data[0] // Save the first result as reference
        };
        setHistory(prev => [newHistoryItem, ...prev.slice(0, 19)]);
      }
    } catch (error) {
      console.error("Search failed", error);
    } finally {
      setLoading(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      
      // If there's a selected verse, update history with this video
      if (selectedVerse) {
        const videoId = `vid_${Date.now()}`;
        await saveVideoToDB(videoId, file);
        
        const newHistoryItem: HistoryItem = {
          id: Date.now().toString(),
          keyword: selectedVerse.reference,
          timestamp: Date.now(),
          verse: selectedVerse,
          videoId: videoId
        };
        setHistory(prev => [newHistoryItem, ...prev.slice(0, 19)]);
        showToast('Vídeo salvo no histórico!');
      }
    }
  };

  const toggleFavorite = (verse: Verse) => {
    const isFav = favorites.some(f => f.reference === verse.reference);
    if (isFav) {
      setFavorites(prev => prev.filter(f => f.reference !== verse.reference));
    } else {
      setFavorites(prev => [...prev, verse]);
    }
  };

  const clearHistory = async () => {
    // Clear videos from DB too
    for (const item of history) {
      if (item.videoId) {
        await deleteVideoFromDB(item.videoId);
      }
    }
    setHistory([]);
  };

  const handleRender = async () => {
    if (!selectedVerse || !videoRef.current || !videoUrl) return;
    
    setIsRendering(true);
    setRenderedBlob(null);
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      setIsRendering(false);
      return;
    }

    canvas.width = 720;
    canvas.height = 1280;

    const stream = canvas.captureStream(30);
    
    // Try to find a supported mime type, prioritizing mp4 for better mobile compatibility if available
    const types = ['video/mp4', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    
    const recorder = new MediaRecorder(stream, { 
      mimeType,
      videoBitsPerSecond: 5000000 // 5 Mbps for high quality
    });
    
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      setRenderedBlob(blob);
      setIsRendering(false);
      setRenderProgress(0);
      video.pause();
      video.muted = true;
    };

    video.muted = true;
    await video.play();
    
    // Start recording ONLY after video is playing to avoid capturing the play icon
    recorder.start();

    const maxDuration = Math.min(video.duration, 30);

    // Pre-calculate text layout once
    const fontSize = 42;
    ctx.font = `italic ${fontSize}px "Libre Baskerville"`;
    const maxWidth = canvas.width - 120;
    const words = selectedVerse.text.split(' ');
    let line = '';
    const lines: string[] = [];
    
    for (let n = 0; n < words.length; n++) {
      let testLine = line + words[n] + ' ';
      let metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        lines.push(line);
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    const lineHeight = fontSize * 1.4;
    const totalHeight = lines.length * lineHeight;
    const startY = (canvas.height - totalHeight) / 2;

    const renderFrame = () => {
      if (recorder.state === 'inactive') return;

      const progress = Math.min((video.currentTime / maxDuration) * 100, 100);
      setRenderProgress(Math.round(progress));

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 12;
      let currentY = startY;
      lines.forEach((l) => {
        ctx.fillText(`"${l.trim()}"`, canvas.width / 2, currentY + lineHeight / 2);
        currentY += lineHeight;
      });
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#D4AF37';
      ctx.font = 'bold 28px "Cinzel"';
      ctx.fillText(selectedVerse.reference.toUpperCase(), canvas.width / 2, currentY + 40);

      const refWidth = ctx.measureText(selectedVerse.reference.toUpperCase()).width;
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - refWidth / 2 - 60, currentY + 40);
      ctx.lineTo(canvas.width / 2 - refWidth / 2 - 15, currentY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 + refWidth / 2 + 15, currentY + 40);
      ctx.lineTo(canvas.width / 2 + refWidth / 2 + 60, currentY + 40);
      ctx.stroke();

      if (!video.paused && !video.ended && video.currentTime < maxDuration) {
        requestAnimationFrame(renderFrame);
      } else {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }
    };

    renderFrame();
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const handleShare = async () => {
    if (!renderedBlob || !selectedVerse) return;
    
    const extension = renderedBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([renderedBlob], `palavra_diaria.${extension}`, { type: renderedBlob.type });

    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'A Palavra Diária',
          text: `"${selectedVerse.text}" - ${selectedVerse.reference}`,
        });
      } else {
        throw new Error('ShareNotSupported');
      }
    } catch (err: any) {
      console.error('Erro ao compartilhar:', err);
      
      // Se for erro de permissão (comum em iframes) ou não suportado
      const isPermissionError = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      
      if (isPermissionError) {
        // No alert here to avoid annoyance, just proceed to download
        console.log('Share blocked by environment, falling back to download');
      } else if (err.name !== 'AbortError') {
        alert('Compartilhamento não disponível. O vídeo será baixado.');
      }
      
      if (err.name !== 'AbortError') {
        handleDownload();
        try {
          await navigator.clipboard.writeText(`"${selectedVerse.text}" - ${selectedVerse.reference}`);
          showToast('Vídeo baixado e texto copiado!');
        } catch (e) {
          showToast('Vídeo baixado!');
        }
      }
    }
  };

  const handleDownload = () => {
    if (!renderedBlob) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const extension = renderedBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(renderedBlob);
    
    if (isIOS) {
      // On iOS, opening in a new tab is often more reliable for saving to gallery
      window.open(url, '_blank');
      showToast('Vídeo aberto! Pressione e segure para salvar.');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `palavra_diaria_${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Vídeo salvo na galeria!');
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Texto copiado!');
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-gold/30">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 20 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-0 left-1/2 -translate-x-1/2 z-[100] bg-navy text-gold px-6 py-3 rounded-full shadow-2xl border border-gold/50 font-display text-xs tracking-widest uppercase flex items-center gap-2"
          >
            <div className="w-2 h-2 bg-gold rounded-full animate-pulse" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sacred-gradient text-white py-8 px-6 shadow-2xl border-b-2 border-gold/40">
        {!genAI && (
          <div className="bg-red-500/20 border border-red-500/50 text-red-200 text-[10px] py-1 text-center mb-4 rounded">
            Atenção: Chave API não configurada. Configure GEMINI_API_KEY no ambiente.
          </div>
        )}
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gold/20 rounded-full border border-gold/50">
              <BookOpen className="w-8 h-8 text-gold" />
            </div>
            <div>
              <h1 className="font-display text-3xl tracking-widest text-gold uppercase">A Palavra Diária</h1>
              <p className="text-xs text-white/60 tracking-[0.2em] font-light mt-1">MEDITAÇÃO E COMPARTILHAMENTO</p>
            </div>
          </div>
          
          <nav className="flex gap-1 bg-white/5 p-1 rounded-full border border-white/10">
            {[
              { id: 'search', icon: Search, label: 'Busca' },
              { id: 'history', icon: History, label: 'Histórico' },
              { id: 'favorites', icon: Star, label: 'Favoritos' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-2 px-6 py-2 rounded-full text-sm transition-all duration-300",
                  activeTab === tab.id 
                    ? "bg-gold text-navy font-semibold shadow-lg" 
                    : "text-white/70 hover:text-white hover:bg-white/10"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Search & Lists */}
        <div className="lg:col-span-5 space-y-6">
          <AnimatePresence mode="wait">
            {activeTab === 'search' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <form onSubmit={handleSearch} className="relative group">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Digite uma palavra-chave (ex: Amor, Fé, Paz)..."
                    className="w-full bg-white border-2 border-navy/10 focus:border-gold rounded-xl py-4 pl-12 pr-4 outline-none transition-all shadow-sm group-hover:shadow-md"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-navy/40 group-focus-within:text-gold transition-colors" />
                  <button 
                    type="submit"
                    disabled={loading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy/90 disabled:opacity-50 transition-all"
                  >
                    {loading ? 'Buscando...' : 'Buscar'}
                  </button>
                </form>

                <div className="space-y-4">
                  <h2 className="font-display text-lg text-navy/60 flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-gold" />
                    Resultados da Bíblia
                  </h2>
                  
                  {verses.length === 0 && !loading && (
                    <div className="text-center py-12 border-2 border-dashed border-navy/5 rounded-2xl">
                      <BookOpen className="w-12 h-12 text-navy/10 mx-auto mb-3" />
                      <p className="text-navy/40 text-sm italic">Nenhum versículo encontrado ainda.</p>
                    </div>
                  )}

                  {verses.map((v, idx) => (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      key={v.reference}
                      onClick={() => setSelectedVerse(v)}
                      className={cn(
                        "p-5 rounded-2xl cursor-pointer transition-all border-2 group relative",
                        selectedVerse?.reference === v.reference
                          ? "bg-navy text-white border-gold shadow-xl scale-[1.02]"
                          : "bg-white border-navy/5 hover:border-gold/30 hover:shadow-md"
                      )}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className={cn(
                          "font-display text-sm tracking-widest",
                          selectedVerse?.reference === v.reference ? "text-gold" : "text-navy/60"
                        )}>
                          {v.reference}
                        </span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(`"${v.text}" - ${v.reference}`);
                          }}
                          className="p-1 rounded-full hover:bg-white/10 transition-colors mr-1"
                          title="Copiar texto"
                        >
                          <Copy className="w-4 h-4 text-navy/20" />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(v);
                          }}
                          className="p-1 rounded-full hover:bg-white/10 transition-colors"
                        >
                          <Star className={cn(
                            "w-4 h-4",
                            favorites.some(f => f.reference === v.reference) 
                              ? "fill-gold text-gold" 
                              : "text-navy/20"
                          )} />
                        </button>
                      </div>
                      <p className={cn(
                        "font-serif text-base leading-relaxed italic",
                        selectedVerse?.reference === v.reference ? "text-white" : "text-navy/80"
                      )}>
                        "{v.text}"
                      </p>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="flex justify-between items-center">
                  <h2 className="font-display text-lg text-navy/60">Histórico de Buscas</h2>
                  <button 
                    onClick={clearHistory}
                    className="text-xs text-red-500 hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Limpar tudo
                  </button>
                </div>
                {history.length === 0 ? (
                  <p className="text-center py-10 text-navy/30 italic">Sem histórico.</p>
                ) : (
                  history.map((item) => (
                    <div 
                      key={item.id}
                      onClick={async () => {
                        if (item.verse) {
                          setSelectedVerse(item.verse);
                          setVerses([item.verse]);
                        }
                        if (item.videoId) {
                          const file = await getVideoFromDB(item.videoId);
                          if (file) {
                            setVideoFile(file);
                            if (videoUrl) URL.revokeObjectURL(videoUrl);
                            setVideoUrl(URL.createObjectURL(file));
                          }
                        }
                        setActiveTab('search');
                      }}
                      className="flex items-center justify-between p-4 bg-white border border-navy/5 rounded-xl hover:border-gold cursor-pointer transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        {item.videoId ? (
                          <Video className="w-4 h-4 text-gold" />
                        ) : (
                          <History className="w-4 h-4 text-navy/30 group-hover:text-gold" />
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium text-navy/80">{item.keyword}</span>
                          {item.videoId && <span className="text-[9px] text-gold uppercase font-bold">Com Vídeo</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-navy/40 uppercase tracking-tighter">
                        {new Date(item.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'favorites' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <h2 className="font-display text-lg text-navy/60">Versículos Favoritos</h2>
                {favorites.length === 0 ? (
                  <p className="text-center py-10 text-navy/30 italic">Nenhum favorito salvo.</p>
                ) : (
                  favorites.map((v) => (
                    <div 
                      key={v.reference}
                      onClick={() => {
                        setSelectedVerse(v);
                        setActiveTab('search');
                      }}
                      className="p-4 bg-white border border-navy/5 rounded-xl hover:border-gold cursor-pointer transition-all"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-display text-xs text-gold tracking-widest">{v.reference}</span>
                        <Bookmark className="w-3 h-3 text-gold fill-gold" />
                      </div>
                      <p className="font-serif text-sm italic text-navy/70 line-clamp-2">"{v.text}"</p>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Video Preview & Overlay */}
        <div className="lg:col-span-7">
          <div className="sticky top-6 space-y-6">
            <div className="bg-navy rounded-3xl overflow-hidden shadow-2xl border-4 border-gold/20 aspect-[9/16] max-h-[70vh] mx-auto relative group">
              {videoUrl ? (
                <>
                  <video 
                    ref={videoRef}
                    src={videoUrl} 
                    className="w-full h-full object-cover"
                    controls={false}
                    loop
                    muted
                    autoPlay
                    playsInline
                    webkit-playsinline="true"
                  />
                  
                  {/* Overlay Text */}
                  <AnimatePresence>
                    {selectedVerse && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute inset-0 flex items-center justify-center p-8 bg-black/30 pointer-events-none"
                      >
                        <div className="text-center space-y-4 max-w-lg">
                          <p className="font-serif text-xl md:text-2xl text-white italic leading-relaxed drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                            "{selectedVerse.text}"
                          </p>
                          <div className="flex items-center justify-center gap-3">
                            <div className="h-[1px] w-8 bg-gold/60" />
                            <span className="font-display text-sm tracking-[0.3em] text-gold drop-shadow-md">
                              {selectedVerse.reference}
                            </span>
                            <div className="h-[1px] w-8 bg-gold/60" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Video Controls Overlay */}
                  <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}
                      className="bg-white/20 backdrop-blur-md p-3 rounded-full text-white hover:bg-gold hover:text-navy transition-all"
                    >
                      <div className="w-5 h-5 flex items-center justify-center">
                        <div className="w-3 h-3 bg-current rounded-sm" />
                      </div>
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-white/20 p-12 text-center">
                  <Upload className="w-16 h-16 mb-4 stroke-1" />
                  <p className="font-display text-sm tracking-widest uppercase">Faça upload de um vídeo para começar</p>
                  <p className="text-xs mt-2 opacity-50">O versículo selecionado aparecerá aqui como overlay</p>
                </div>
              )}
            </div>

            <div className="glass-card rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm text-navy/80 tracking-widest uppercase">Configurações de Mídia</h3>
                {videoUrl && (
                  <button 
                    onClick={() => {
                      setVideoUrl(null);
                      setVideoFile(null);
                      setRenderedBlob(null);
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Remover Vídeo
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4">
                {!videoUrl ? (
                  <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gold/30 rounded-xl cursor-pointer hover:bg-gold/5 transition-colors group">
                    <Upload className="w-6 h-6 text-gold group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-medium text-navy/60">Selecionar Vídeo Local</span>
                    <input type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
                  </label>
                ) : !renderedBlob ? (
                  <button 
                    disabled={!videoUrl || !selectedVerse || isRendering}
                    onClick={handleRender}
                    className="flex flex-col items-center justify-center gap-2 p-6 bg-navy text-white rounded-xl disabled:opacity-30 hover:bg-navy/90 transition-all shadow-lg hover:shadow-xl relative overflow-hidden"
                  >
                    {isRendering ? (
                      <>
                        <div className="absolute inset-0 bg-gold/20" />
                        <div 
                          className="absolute bottom-0 left-0 h-1 bg-gold transition-all duration-300" 
                          style={{ width: `${renderProgress}%` }}
                        />
                        <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin mb-1" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter">Renderizando {renderProgress}%</span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs font-medium uppercase tracking-widest">Gerar Vídeo para Compartilhar</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={handleShare}
                      className="flex flex-col items-center justify-center gap-2 p-6 bg-navy text-white rounded-xl hover:bg-navy/90 transition-all shadow-lg hover:shadow-xl"
                    >
                      <Share2 className="w-6 h-6 text-gold" />
                      <span className="text-xs font-medium">
                        {canNativeShare ? 'Compartilhar' : 'Baixar p/ Postar'}
                      </span>
                    </button>
                    <button 
                      onClick={handleDownload}
                      className="flex flex-col items-center justify-center gap-2 p-6 bg-gold text-navy rounded-xl hover:bg-gold/90 transition-all shadow-lg hover:shadow-xl"
                    >
                      <Download className="w-6 h-6 text-navy" />
                      <span className="text-xs font-medium">Salvar Galeria</span>
                    </button>
                    <button 
                      onClick={() => copyToClipboard(`"${selectedVerse.text}" - ${selectedVerse.reference}`)}
                      className="col-span-2 flex items-center justify-center gap-2 p-3 bg-navy/5 text-navy rounded-xl border border-navy/20 hover:bg-navy/10 transition-all"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="text-xs font-medium">Copiar Legenda do Versículo</span>
                    </button>
                    <button 
                      onClick={() => setRenderedBlob(null)}
                      className="col-span-2 text-xs text-navy/40 hover:text-navy transition-colors py-2"
                    >
                      Gerar outro vídeo
                    </button>
                    
                    <div className="col-span-2 p-4 bg-gold/10 rounded-xl border border-gold/30">
                      <p className="text-[10px] text-navy/80 leading-relaxed">
                        <strong className="text-navy uppercase block mb-1">Qualidade HD Ativada:</strong>
                        • Vídeo em Alta Definição (720p).<br/>
                        • Compatível com Android e iOS.<br/>
                        • Texto copiado automaticamente.<br/>
                        • No iPhone, o vídeo abrirá em uma nova aba para salvar.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!selectedVerse && (
                <div className="flex items-center gap-2 p-3 bg-gold/10 rounded-lg border border-gold/20">
                  <BookOpen className="w-4 h-4 text-gold" />
                  <p className="text-[10px] text-navy/70 font-medium">Dica: Selecione um versículo na lista à esquerda para ver o overlay.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="py-8 px-6 border-t border-navy/5 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Cross className="w-4 h-4 text-gold" />
        </div>
        <p className="text-[10px] text-navy/40 tracking-[0.4em] uppercase">
          "Lâmpada para os meus pés é tua palavra, e luz para o meu caminho."
        </p>
        <p className="text-[9px] text-navy/20 mt-4">
          A Palavra Diária &copy; {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
