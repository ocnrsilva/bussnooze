
import React, { useState, useEffect, useRef } from 'react';
import { Coords, AlarmConfig, LocationState, HistoryItem } from './types';
import { calculateDistance, formatDistance } from './utils/geo';
import { getTravelTips } from './services/geminiService';

const DEFAULT_ALARM_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';
const HISTORY_KEY = 'bussnooze_history_v1';
const SOUND_KEY = 'bussnooze_custom_sound_v1';
const ALARM_STATE_KEY = 'bussnooze_alarm_v1';
const LOCATION_SMOOTHING_WINDOW = 3;

interface UserContext {
  countryCode?: string;
  state?: string;
}

const App: React.FC = () => {
  const [location, setLocation] = useState<LocationState>({ current: null, error: null, accuracy: null });
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [alarm, setAlarm] = useState<AlarmConfig>(() => {
    const saved = localStorage.getItem(ALARM_STATE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...parsed, isTriggered: false };
      } catch (e) { console.error(e); }
    }
    return { destination: null, radius: 500, isActive: false, isTriggered: false, addressName: '' };
  });
  
  const [tips, setTips] = useState<string>('');
  const [showTips, setShowTips] = useState<boolean>(false);
  const [distanceToDest, setDistanceToDest] = useState<number | null>(null);
  const [isFetchingAddress, setIsFetchingAddress] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchHistory, setSearchHistory] = useState<HistoryItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState<boolean>(false);
  const [showQuickHistory, setShowQuickHistory] = useState<boolean>(false);
  const [isFollowing, setIsFollowing] = useState<boolean>(true);
  const [customSound, setCustomSound] = useState<string | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const routeLineRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const locationBufferRef = useRef<{lat: number, lng: number}[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastCameraUpdate = useRef<number>(0);
  
  const hasCenteredOnUser = useRef<boolean>(false);

  useEffect(() => {
    localStorage.setItem(ALARM_STATE_KEY, JSON.stringify(alarm));
  }, [alarm]);

  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try { setSearchHistory(JSON.parse(savedHistory)); } catch (e) { console.error(e); }
    }
    const savedSound = localStorage.getItem(SOUND_KEY);
    const soundUrl = savedSound || DEFAULT_ALARM_SOUND;
    if (savedSound) setCustomSound(savedSound);

    const audio = new Audio(soundUrl);
    audio.loop = true;
    audioRef.current = audio;

    const timer = setTimeout(() => {
      startGpsTracking();
      initMap();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (wakeLockRef.current) wakeLockRef.current.release();
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    searchTimeoutRef.current = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=10&addressdetails=1`;
        if (location.current) url += `&lat=${location.current.lat}&lon=${location.current.lng}`;
        if (userContext?.countryCode) url += `&countrycodes=${userContext.countryCode}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
        const data = await res.json();
        setSearchResults(data);
      } catch (e) { console.error(e); } finally { setIsSearching(false); }
    }, 500);
  }, [searchQuery, userContext, location.current]);

  const initMap = () => {
    const L = (window as any).L;
    if (!L || mapRef.current) return;
    try {
      mapRef.current = L.map('map', { 
        zoomControl: false, 
        attributionControl: false,
        fadeAnimation: true,
        inertia: true
      }).setView([0, 0], 2);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapRef.current);
      
      const stopFollowing = () => setIsFollowing(false);
      mapRef.current.on('dragstart', stopFollowing);
      mapRef.current.on('zoomstart', stopFollowing);
      mapRef.current.on('touchstart', stopFollowing);

      mapRef.current.on('click', (e: any) => {
        if (!alarm.isActive) {
          setAlarm(prev => ({ ...prev, destination: e.latlng, isTriggered: false, addressName: '' }));
          fetchAddress(e.latlng.lat, e.latlng.lng);
        }
        setShowSuggestions(false);
      });
    } catch (e) { console.error(e); }
  };

  const startGpsTracking = () => {
    if (!navigator.geolocation) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      processLocationUpdate, 
      (err) => setLocation(prev => ({ ...prev, error: err.message })), 
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const processLocationUpdate = async (pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords;
    locationBufferRef.current.push({ lat: latitude, lng: longitude });
    if (locationBufferRef.current.length > LOCATION_SMOOTHING_WINDOW) locationBufferRef.current.shift();
    const smoothed = { 
      lat: locationBufferRef.current.reduce((s, p) => s + p.lat, 0) / locationBufferRef.current.length,
      lng: locationBufferRef.current.reduce((s, p) => s + p.lng, 0) / locationBufferRef.current.length
    };
    
    setLocation({ current: smoothed, error: null, accuracy });

    if (!userContext) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        if (data.address) setUserContext({ countryCode: data.address.country_code, state: data.address.state });
      } catch (e) {}
    }

    const L = (window as any).L;
    const now = Date.now();
    if (mapRef.current && L && isFollowing) {
      if (!hasCenteredOnUser.current) {
        mapRef.current.setView([smoothed.lat, smoothed.lng], 16);
        hasCenteredOnUser.current = true;
      } else if (alarm.isActive && alarm.destination) {
        // CÂMERA DINÂMICA: Ajusta o enquadramento entre usuário e destino
        if (now - lastCameraUpdate.current > 1500) {
          const bounds = L.latLngBounds([smoothed.lat, smoothed.lng], [alarm.destination.lat, alarm.destination.lng]);
          const dist = calculateDistance(smoothed, alarm.destination);
          
          if (dist > 1000) {
            mapRef.current.fitBounds(bounds, { 
              padding: [100, 100], 
              maxZoom: 15, 
              animate: true,
              duration: 1
            });
          } else {
            mapRef.current.panTo([smoothed.lat, smoothed.lng], { animate: true });
          }
          lastCameraUpdate.current = now;
        }
      } else if (!alarm.isActive) {
        mapRef.current.panTo([smoothed.lat, smoothed.lng], { animate: true });
      }
    }
  };

  useEffect(() => {
    const L = (window as any).L;
    if (!mapRef.current || !L) return;

    if (alarm.destination) {
      if (!markerRef.current) markerRef.current = L.marker([alarm.destination.lat, alarm.destination.lng]).addTo(mapRef.current);
      else markerRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
      
      if (!radiusCircleRef.current) radiusCircleRef.current = L.circle([alarm.destination.lat, alarm.destination.lng], { radius: alarm.radius, color: '#3b82f6', weight: 2, fillOpacity: 0.1, dashArray: '5, 10' }).addTo(mapRef.current);
      else { 
        radiusCircleRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]); 
        radiusCircleRef.current.setRadius(alarm.radius); 
      }
    } else {
      if (markerRef.current) { mapRef.current.removeLayer(markerRef.current); markerRef.current = null; }
      if (radiusCircleRef.current) { mapRef.current.removeLayer(radiusCircleRef.current); radiusCircleRef.current = null; }
    }

    if (location.current) {
      if (!userMarkerRef.current) userMarkerRef.current = L.circleMarker([location.current.lat, location.current.lng], { radius: 10, color: '#fff', weight: 4, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(mapRef.current);
      else userMarkerRef.current.setLatLng([location.current.lat, location.current.lng]);
    }

    if (alarm.isActive && alarm.destination && location.current) {
      const path = [[location.current.lat, location.current.lng], [alarm.destination.lat, alarm.destination.lng]];
      if (!routeLineRef.current) {
        routeLineRef.current = L.polyline(path, { color: '#3b82f6', weight: 4, opacity: 0.3, dashArray: '10, 10' }).addTo(mapRef.current);
      } else {
        routeLineRef.current.setLatLngs(path);
      }
    } else {
      if (routeLineRef.current) { mapRef.current.removeLayer(routeLineRef.current); routeLineRef.current = null; }
    }
  }, [alarm.destination, alarm.radius, alarm.isActive, location.current]);

  const toggleAlarm = async () => {
    if (!alarm.destination || !alarm.addressName) return;
    if (!alarm.isActive) {
      if ('Notification' in window && Notification.permission !== 'granted') await Notification.requestPermission();
      await requestWakeLock();
      setAlarm(prev => ({ ...prev, isActive: true }));
      setIsFollowing(true);
      const t = await getTravelTips(alarm.addressName);
      setTips(t || '');
      setShowTips(false);
    } else {
      await releaseWakeLock();
      setAlarm(prev => ({ ...prev, isActive: false, isTriggered: false }));
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      setTips('');
      setShowTips(false);
    }
  };

  useEffect(() => {
    if (alarm.isActive && alarm.destination && location.current) {
      const dist = calculateDistance(location.current, alarm.destination);
      setDistanceToDest(dist);
      if (dist <= alarm.radius && !alarm.isTriggered) {
        setAlarm(prev => ({ ...prev, isTriggered: true }));
        if (audioRef.current) audioRef.current.play().catch(e => console.error("Erro som:", e));
      }
    }
  }, [location.current, alarm.isActive, alarm.destination, alarm.radius, alarm.isTriggered]);

  const handleRecenter = () => {
    if (mapRef.current && location.current) {
      mapRef.current.flyTo([location.current.lat, location.current.lng], 16, { duration: 1 });
      setIsFollowing(true);
    }
  };

  const fetchAddress = async (lat: number, lng: number) => {
    setIsFetchingAddress(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'pt-BR' } });
      const data = await response.json();
      setAlarm(prev => ({ ...prev, addressName: data.display_name || 'Local Selecionado' }));
    } catch (e) { setAlarm(prev => ({ ...prev, addressName: 'Local Selecionado' })); } finally { setIsFetchingAddress(false); }
  };

  const selectSuggestion = (result: any) => {
    const coords = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    setAlarm(prev => ({ ...prev, destination: coords, isTriggered: false, addressName: result.display_name }));
    const newItem: HistoryItem = { id: result.place_id || String(Date.now()), display_name: result.display_name, lat: result.lat, lon: result.lon, timestamp: Date.now() };
    setSearchHistory(prev => {
      const updated = [newItem, ...prev.filter(h => h.display_name !== newItem.display_name)].slice(0, 10);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
    setSearchQuery('');
    setShowSuggestions(false);
    if (mapRef.current) {
      setIsFollowing(false);
      mapRef.current.flyTo([coords.lat, coords.lng], 16);
    }
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch (err) {}
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) { await wakeLockRef.current.release(); wakeLockRef.current = null; }
  };

  const handleSoundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setCustomSound(base64);
      localStorage.setItem(SOUND_KEY, base64);
      if (audioRef.current) audioRef.current.src = base64;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-white overflow-hidden font-sans relative">
      <div id="map" className="absolute inset-0 z-0"></div>

      {/* HEADER FLUTUANTE - COMPACTO */}
      <div className="absolute top-4 left-4 right-4 z-50 pointer-events-none">
        <div className="max-w-xl mx-auto space-y-3">
          <div className="flex justify-between items-center pointer-events-auto">
            <h1 className="font-black text-2xl text-blue-500 drop-shadow-md tracking-tighter">BusSnooze</h1>
            <div className="flex items-center gap-2">
               {userContext?.state && <span className="text-[10px] font-black bg-blue-600/90 px-2 py-1 rounded-md shadow-lg uppercase">{userContext.state}</span>}
               <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md shadow-lg backdrop-blur-md bg-slate-900/60 ${location.accuracy && location.accuracy < 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                {location.accuracy ? (location.accuracy < 50 ? 'SINAL OK' : 'SINAL MÉDIO') : 'BUSCANDO GPS'}
               </span>
            </div>
          </div>
          
          <div className="relative pointer-events-auto">
            <div className={`flex items-center bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border rounded-2xl transition-all shadow-xl overflow-hidden ${isSearching ? 'border-blue-500' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="pl-4 text-blue-500">🔍</div>
              <input 
                type="text" 
                placeholder="Para onde você vai?" 
                className="flex-1 bg-transparent px-3 py-4 text-sm focus:outline-none font-bold text-slate-800 dark:text-white placeholder:text-slate-400"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
              />
              {isSearching && <div className="mr-4 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>}
            </div>
            
            {showSuggestions && (searchQuery.length >= 3 || searchHistory.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-[100] max-h-60 overflow-y-auto">
                {(searchQuery.length >= 3 ? searchResults : searchHistory).map((res, i) => (
                  <button key={i} onClick={() => selectSuggestion(res)} className="w-full p-4 text-left border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-blue-50 dark:hover:bg-blue-600/20 flex gap-4 items-center group transition-colors">
                    <span className="text-blue-500">📍</span>
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate text-xs font-bold text-slate-700 dark:text-white leading-tight">{res.display_name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CONTROLES LATERAIS - ESTILO SLIM */}
      <div className="absolute right-4 bottom-[280px] sm:bottom-[320px] z-40 flex flex-col gap-3 pointer-events-auto">
        <button onClick={() => setShowSettingsOverlay(true)} className="p-3 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full shadow-lg hover:scale-105 transition-all">⚙️</button>
        <button onClick={handleRecenter} className={`p-3 rounded-full border shadow-lg transition-all active:scale-95 ${isFollowing ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/90 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700'}`}>🎯</button>
      </div>

      {/* PAINEL INFERIOR FLUTUANTE - COMPACTO E TRANSPARENTE */}
      <div className="absolute bottom-6 left-4 right-4 z-50 pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto">
          {alarm.destination ? (
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] p-5 space-y-4 animate-in slide-in-from-bottom duration-500 text-slate-900 dark:text-white">
              
              <div className="flex items-center gap-3">
                <div className="bg-blue-500/10 p-2 rounded-xl text-blue-500">🏁</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-blue-500 uppercase tracking-widest leading-none mb-1">Seu Destino</p>
                  <p className="text-sm font-bold truncate leading-tight">{alarm.addressName?.split(',')[0] || 'Local Selecionado'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded-2xl border border-black/5 dark:border-white/5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Raio do Alerta</span>
                  <p className="text-lg font-black">{alarm.radius}m</p>
                </div>
                <div className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded-2xl border border-black/5 dark:border-white/5 text-right">
                  <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest block mb-1">Distância</span>
                  <p className="text-lg font-black tabular-nums">{distanceToDest !== null ? formatDistance(distanceToDest) : '--'}</p>
                </div>
              </div>

              <input 
                type="range" min="50" max="2500" step="50" 
                value={alarm.radius} disabled={alarm.isActive} 
                onChange={(e) => setAlarm(prev => ({...prev, radius: parseInt(e.target.value)}))} 
                className="w-full accent-blue-500 bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer mb-2" 
              />

              <button 
                onClick={toggleAlarm} 
                disabled={!alarm.destination || isFetchingAddress} 
                className={`w-full py-4 rounded-2xl font-black text-base shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-3 ${alarm.isActive ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
              >
                {alarm.isActive ? 'CANCELAR MONITORAMENTO' : 'ATIVAR ALARME DE CHEGADA'}
              </button>

              {tips && alarm.isActive && (
                <div className="pt-1">
                  <button onClick={() => setShowTips(!showTips)} className="w-full text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center justify-center gap-1 opacity-70">
                    {showTips ? '▲ Esconder Dicas' : '▼ Dicas de Segurança (Região)'}
                  </button>
                  {showTips && (
                    <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-500/20 rounded-xl text-[10px] text-slate-600 dark:text-blue-100/80 leading-relaxed animate-in fade-in">
                      {tips}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full px-6 py-3 shadow-xl text-center">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse">
                Toque no mapa ou use a busca
              </p>
            </div>
          )}
        </div>
      </div>

      {/* TELA DE ALARME DISPARADO */}
      {alarm.isTriggered && (
        <div className="fixed inset-0 z-[1000] bg-red-600 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="text-8xl mb-8 animate-bounce">🔔</div>
          <h2 className="text-5xl font-black italic mb-10 text-white tracking-tighter uppercase leading-none">VOCÊ<br/>CHEGOU!</h2>
          <button 
            onClick={() => { 
              setAlarm(prev => ({...prev, isActive: false, isTriggered: false})); 
              if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } 
              releaseWakeLock(); 
            }} 
            className="bg-white text-red-600 px-16 py-6 rounded-full font-black text-2xl shadow-2xl active:scale-95 transition-transform"
          >
            PARAR ALARME
          </button>
        </div>
      )}

      {/* CONFIGURAÇÕES */}
      {showSettingsOverlay && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-black text-lg uppercase tracking-tight text-slate-800 dark:text-white">Opções</h3>
              <button onClick={() => setShowSettingsOverlay(false)} className="text-slate-400 text-xl font-bold">✕</button>
            </div>
            <div className="space-y-6">
              <div>
                <span className="text-[10px] font-black text-slate-400 block mb-3 uppercase tracking-widest">Som Personalizado</span>
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl flex flex-col gap-4 border border-slate-100 dark:border-slate-700">
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    {customSound ? '🔊 MP3 em Uso' : '🎵 Alarme Padrão'}
                  </div>
                  <input type="file" ref={fileInputRef} onChange={handleSoundUpload} accept="audio/*" className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="w-full py-3 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md">Carregar MP3</button>
                </div>
              </div>
              <p className="text-[9px] text-slate-400 text-center uppercase tracking-widest">BusSnooze v2.7.0 • pt-BR</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
