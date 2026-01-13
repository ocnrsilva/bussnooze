
import React, { useState, useEffect, useRef } from 'react';
import { Coords, AlarmConfig, LocationState, HistoryItem } from './types';
import { calculateDistance, formatDistance } from './utils/geo';
import { getTravelTips } from './services/geminiService';

const DEFAULT_ALARM_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';
const HISTORY_KEY = 'bussnooze_history_v1';
const SOUND_KEY = 'bussnooze_custom_sound_v1';
const LOCATION_SMOOTHING_WINDOW = 3;

interface UserContext {
  countryCode?: string;
  state?: string;
}

const App: React.FC = () => {
  const [location, setLocation] = useState<LocationState>({ current: null, error: null, accuracy: null });
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [alarm, setAlarm] = useState<AlarmConfig>({
    destination: null,
    radius: 500,
    isActive: false,
    isTriggered: false,
    addressName: ''
  });
  const [tips, setTips] = useState<string>('');
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
  const [isWakeLocked, setIsWakeLocked] = useState<boolean>(false);
  const [customSound, setCustomSound] = useState<string | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const locationBufferRef = useRef<{lat: number, lng: number}[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const hasCenteredOnUser = useRef<boolean>(false);

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
        
        const sortedData = data.sort((a: any, b: any) => {
          if (userContext?.state) {
            const aInState = a.address?.state?.toLowerCase().includes(userContext.state.toLowerCase());
            const bInState = b.address?.state?.toLowerCase().includes(userContext.state.toLowerCase());
            if (aInState && !bInState) return -1;
            if (!aInState && bInState) return 1;
          }
          return 0;
        });

        setSearchResults(sortedData);
      } catch (e) {
        console.error("Erro na busca:", e);
      } finally {
        setIsSearching(false);
      }
    }, 500);
  }, [searchQuery, userContext, location.current]);

  const initMap = () => {
    const L = (window as any).L;
    if (!L || mapRef.current) return;

    try {
      mapRef.current = L.map('map', { 
        zoomControl: false, 
        attributionControl: false,
        fadeAnimation: true
      }).setView([0, 0], 2);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapRef.current);
      
      // FUNÇÃO PARA PARAR DE SEGUIR O GPS AO INTERAGIR
      const stopFollowing = () => {
        setIsFollowing(false);
      };

      // Adicionamos múltiplos eventos de interação para garantir que o "isFollowing" vire false imediatamente
      mapRef.current.on('dragstart', stopFollowing);
      mapRef.current.on('zoomstart', stopFollowing);
      mapRef.current.on('touchstart', stopFollowing);
      mapRef.current.on('mousedown', stopFollowing);

      mapRef.current.on('click', (e: any) => {
        if (!alarm.isActive) {
          setAlarm(prev => ({ ...prev, destination: e.latlng, isTriggered: false, addressName: '' }));
          fetchAddress(e.latlng.lat, e.latlng.lng);
        }
        setShowSuggestions(false);
      });
    } catch (e) {
      console.error("Erro ao inicializar mapa:", e);
    }
  };

  const startGpsTracking = () => {
    if (!navigator.geolocation) return;
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    
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

    const avgLat = locationBufferRef.current.reduce((s, p) => s + p.lat, 0) / locationBufferRef.current.length;
    const avgLng = locationBufferRef.current.reduce((s, p) => s + p.lng, 0) / locationBufferRef.current.length;
    const smoothed = { lat: avgLat, lng: avgLng };
    
    setLocation({ current: smoothed, error: null, accuracy });

    if (!userContext) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        if (data.address) {
          setUserContext({
            countryCode: data.address.country_code,
            state: data.address.state
          });
        }
      } catch (e) {}
    }

    const L = (window as any).L;
    if (mapRef.current && L) {
      if (!hasCenteredOnUser.current) {
        mapRef.current.setView([smoothed.lat, smoothed.lng], 16);
        hasCenteredOnUser.current = true;
      } else if (isFollowing) {
        // Só move o mapa se isFollowing for true
        mapRef.current.panTo([smoothed.lat, smoothed.lng], { animate: true, duration: 0.5 });
      }
    }
  };

  useEffect(() => {
    const L = (window as any).L;
    if (!mapRef.current || !L) return;

    if (alarm.destination) {
      if (!markerRef.current) markerRef.current = L.marker([alarm.destination.lat, alarm.destination.lng]).addTo(mapRef.current);
      else markerRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
      
      if (!radiusCircleRef.current) radiusCircleRef.current = L.circle([alarm.destination.lat, alarm.destination.lng], { radius: alarm.radius, color: '#3b82f6', weight: 2, fillOpacity: 0.15 }).addTo(mapRef.current);
      else { 
        radiusCircleRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]); 
        radiusCircleRef.current.setRadius(alarm.radius); 
      }
    }

    if (location.current) {
      if (!userMarkerRef.current) userMarkerRef.current = L.circleMarker([location.current.lat, location.current.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 }).addTo(mapRef.current);
      else userMarkerRef.current.setLatLng([location.current.lat, location.current.lng]);
    }
  }, [alarm.destination, alarm.radius, location.current]);

  const handleRecenter = () => {
    setIsFollowing(true);
    locationBufferRef.current = [];
    if (location.current && mapRef.current) {
      mapRef.current.flyTo([location.current.lat, location.current.lng], 16);
    }
  };

  const handleShare = async () => {
    if (!alarm.destination) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${alarm.destination.lat},${alarm.destination.lng}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'BusSnooze Destino', text: `Vou para: ${alarm.addressName || 'Local Selecionado'}`, url }); } catch (e) {}
    } else { window.open(url, '_blank'); }
  };

  useEffect(() => {
    if (alarm.isActive && alarm.destination && location.current) {
      const dist = calculateDistance(location.current, alarm.destination);
      setDistanceToDest(dist);
      if (dist <= alarm.radius && !alarm.isTriggered) {
        setAlarm(prev => ({ ...prev, isTriggered: true }));
        if (audioRef.current) audioRef.current.play().catch(e => console.error("Erro ao tocar alarme:", e));
      }
    }
  }, [location.current, alarm.isActive, alarm.destination, alarm.radius]);

  const toggleAlarm = async () => {
    if (!alarm.destination || !alarm.addressName) return;
    if (!alarm.isActive) {
      if ('Notification' in window && Notification.permission !== 'granted') await Notification.requestPermission();
      await requestWakeLock();
      setAlarm(prev => ({ ...prev, isActive: true }));
      const t = await getTravelTips(alarm.addressName);
      setTips(t || '');
    } else {
      await releaseWakeLock();
      setAlarm(prev => ({ ...prev, isActive: false, isTriggered: false }));
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
      setTips('');
    }
  };

  const fetchAddress = async (lat: number, lng: number) => {
    setIsFetchingAddress(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'pt-BR' } });
      const data = await response.json();
      setAlarm(prev => ({ ...prev, addressName: data.display_name || 'Local Selecionado' }));
    } catch (e) {
      setAlarm(prev => ({ ...prev, addressName: 'Local Selecionado' }));
    } finally { setIsFetchingAddress(false); }
  };

  const selectSuggestion = (result: any) => {
    const coords = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
    setAlarm(prev => ({ ...prev, destination: coords, isTriggered: false, addressName: result.display_name }));
    addToHistory(result);
    setSearchQuery(result.display_name);
    setShowSuggestions(false);
    setShowQuickHistory(false);
    if (mapRef.current) {
      setIsFollowing(false);
      mapRef.current.flyTo([coords.lat, coords.lng], 16);
    }
  };

  const addToHistory = (item: any) => {
    const newItem: HistoryItem = { id: item.place_id || String(Date.now()), display_name: item.display_name, lat: item.lat, lon: item.lon, timestamp: Date.now() };
    setSearchHistory(prev => {
      const filtered = prev.filter(h => h.display_name !== newItem.display_name);
      const updated = [newItem, ...filtered].slice(0, 10);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLocked(true);
      } catch (err) {}
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsWakeLocked(false);
    }
  };

  const handleSoundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setCustomSound(base64);
      localStorage.setItem(SOUND_KEY, base64);
      if (audioRef.current) audioRef.current.src = base64;
    };
    reader.readAsDataURL(file);
  };

  const getAccuracyLabel = (acc: number | null) => {
    if (!acc) return { text: 'Buscando GPS...', color: 'text-slate-500' };
    if (acc < 30) return { text: 'GPS: Excelente', color: 'text-green-500' };
    if (acc < 80) return { text: 'GPS: Bom', color: 'text-blue-500' };
    return { text: 'Sinal Fraco', color: 'text-yellow-500' };
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-white overflow-hidden font-sans">
      <div className="z-50 bg-slate-900 border-b border-slate-800 shadow-xl pt-3 pb-4 px-4">
        <div className="max-w-lg mx-auto flex justify-between items-center mb-3">
          <h1 className="font-black text-2xl text-blue-500 tracking-tighter">BusSnooze</h1>
          <div className="flex items-center gap-2">
            {userContext?.state && (
              <span className="text-[8px] font-black bg-blue-500/20 text-blue-400 px-2 py-1 rounded-md uppercase">
                {userContext.state}
              </span>
            )}
            <span className={`text-[10px] font-bold uppercase tracking-widest ${getAccuracyLabel(location.accuracy).color}`}>
              {getAccuracyLabel(location.accuracy).text}
            </span>
          </div>
        </div>
        <div className="relative max-w-lg mx-auto">
          <div className={`flex items-center bg-slate-800 border rounded-xl transition-all ${isSearching ? 'border-blue-500' : 'border-slate-700'}`}>
            <input 
              type="text" 
              placeholder="Para onde vamos?" 
              className="flex-1 bg-transparent px-4 py-3 text-sm focus:outline-none font-bold placeholder:text-slate-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
            />
            {isSearching && (
              <div className="mr-3 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            )}
          </div>
          {showSuggestions && (searchQuery.length >= 3 || searchHistory.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[100] max-h-80 overflow-y-auto">
              <div className="p-2 border-b border-slate-800 text-[9px] font-black text-slate-500 uppercase tracking-widest flex justify-between">
                <span>{searchQuery.length >= 3 ? 'Resultados Inteligentes' : 'Locais Recentes'}</span>
                {userContext?.countryCode && <span className="text-blue-500">Filtrando: {userContext.countryCode.toUpperCase()}</span>}
              </div>
              {(searchQuery.length >= 3 ? searchResults : searchHistory).map((res, i) => (
                <button key={i} onClick={() => selectSuggestion(res)} className="w-full p-4 text-left border-b border-slate-800 last:border-0 hover:bg-slate-800 flex gap-3 items-center group">
                  <span className="text-blue-500 bg-blue-500/10 p-1.5 rounded-lg text-xs group-hover:bg-blue-500 group-hover:text-white transition-colors">📍</span>
                  <div className="flex-1 overflow-hidden">
                    <div className="truncate text-xs font-bold text-white">{res.display_name}</div>
                    {res.address?.state && (
                      <div className="text-[10px] text-slate-500 font-medium">{res.address.state} • {res.address.country}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        <div id="map" className="w-full h-full"></div>
        <div className="absolute right-4 bottom-4 z-40 flex flex-col gap-3">
          <button onClick={() => setShowSettingsOverlay(true)} className="p-4 bg-slate-900 border border-slate-800 rounded-full text-white shadow-xl">⚙️</button>
          <button onClick={() => setShowQuickHistory(!showQuickHistory)} className={`p-4 rounded-full border shadow-xl transition-all ${showQuickHistory ? 'bg-blue-600 border-blue-400' : 'bg-slate-900 border-slate-800'}`}>🕒</button>
          <button onClick={handleRecenter} className={`p-4 rounded-full border shadow-xl transition-all ${isFollowing ? 'bg-blue-600 border-blue-400' : 'bg-slate-900 border-slate-800'}`}>🎯</button>
        </div>
        {showQuickHistory && (
          <div className="absolute left-4 top-4 bottom-20 z-40 w-64 bg-slate-900/95 backdrop-blur-sm border border-slate-800 rounded-2xl p-4 shadow-2xl overflow-y-auto">
            <h2 className="text-xs font-black uppercase mb-3 text-slate-400">Recentes</h2>
            {searchHistory.map((h, i) => (
              <button key={i} onClick={() => selectSuggestion(h)} className="w-full text-left p-3 mb-2 bg-slate-800 border border-slate-700 rounded-xl text-[10px] font-bold truncate">{h.display_name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="z-50 p-5 bg-slate-900 border-t border-slate-800 rounded-t-3xl shadow-2xl safe-area-bottom">
        {!alarm.destination ? (
          <div className="text-center py-4 text-slate-500 font-bold uppercase text-xs tracking-widest">
            {location.current ? 'Arraste e selecione um ponto' : 'Aguardando GPS...'}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-slate-800 rounded-xl flex justify-between items-center border border-slate-700">
              <div className="truncate flex-1 pr-4">
                <span className="text-[9px] block text-slate-500 font-black uppercase tracking-widest">Destino Selecionado</span>
                <p className="text-sm font-bold truncate text-white">{alarm.addressName || 'Local Definido'}</p>
              </div>
              <button onClick={handleShare} className="bg-slate-700 p-2 rounded-lg text-blue-500 active:scale-90 transition-transform">🔗</button>
            </div>
            <div className="flex justify-between items-end px-1">
              <div>
                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Raio do Alerta</span>
                <p className="text-xl font-black text-white">{alarm.radius}m</p>
              </div>
              {distanceToDest !== null && (
                <div className="text-right">
                  <span className="text-[9px] text-blue-500 font-black uppercase tracking-widest">Faltam</span>
                  <p className="text-2xl font-black tabular-nums text-blue-400">{formatDistance(distanceToDest)}</p>
                </div>
              )}
            </div>
            <input type="range" min="50" max="3000" step="50" value={alarm.radius} disabled={alarm.isActive} onChange={(e) => setAlarm(prev => ({...prev, radius: parseInt(e.target.value)}))} className="w-full accent-blue-500 bg-slate-800 h-1.5 rounded-full appearance-none" />
            <button onClick={toggleAlarm} disabled={!alarm.destination || isFetchingAddress} className={`w-full py-4 rounded-xl font-black text-lg shadow-xl ${alarm.isActive ? 'bg-red-600' : 'bg-blue-600'}`}>
              {alarm.isActive ? 'CANCELAR MONITORAMENTO' : 'ATIVAR ALARME'}
            </button>
          </div>
        )}
      </div>

      {alarm.isTriggered && (
        <div className="fixed inset-0 z-[1000] bg-red-600 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="text-8xl mb-8 animate-bounce">🔔</div>
          <h2 className="text-5xl font-black italic mb-10 text-white tracking-tighter uppercase">Chegamos!</h2>
          <button onClick={() => { setAlarm(prev => ({...prev, isActive: false, isTriggered: false})); if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } releaseWakeLock(); }} className="bg-white text-red-600 px-16 py-6 rounded-full font-black text-2xl shadow-2xl active:scale-95 transition-transform">DESLIGAR</button>
        </div>
      )}

      {showSettingsOverlay && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-sm flex items-end animate-in fade-in">
          <div className="w-full bg-slate-900 rounded-t-3xl p-6 border-t border-slate-800 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-black text-lg uppercase tracking-tight">Configurações</h3>
              <button onClick={() => setShowSettingsOverlay(false)} className="text-slate-500 font-bold p-2">FECHAR</button>
            </div>
            <div className="mb-8">
              <span className="text-[10px] font-black text-slate-500 block mb-3 uppercase tracking-widest">Som do Alarme</span>
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 flex flex-col gap-4">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span>{customSound ? '🔊 Som Personalizado' : '🎵 Som Padrão'}</span>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleSoundUpload} accept="audio/*" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="w-full py-3 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-xl text-xs font-black uppercase tracking-widest">Subir MP3</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
