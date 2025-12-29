
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Coords, AlarmConfig, LocationState } from './types';
import { calculateDistance, formatDistance } from './utils/geo';
import { getTravelTips } from './services/geminiService';

// Constants
const DEFAULT_RADIUS = 500; // meters
const MIN_RADIUS = 100;
const MAX_RADIUS = 5000;
// Usando um som de alarme mais padrão e direto
const ALARM_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const App: React.FC = () => {
  // State
  const [location, setLocation] = useState<LocationState>({ current: null, error: null, accuracy: null });
  const [alarm, setAlarm] = useState<AlarmConfig>({
    destination: null,
    radius: DEFAULT_RADIUS,
    isActive: false,
    isTriggered: false,
    addressName: ''
  });
  const [tips, setTips] = useState<string>('');
  const [distanceToDest, setDistanceToDest] = useState<number | null>(null);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);

  // Refs
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Audio Setup
  useEffect(() => {
    const audio = new Audio(ALARM_SOUND_URL);
    audio.loop = true;
    audio.preload = 'auto';
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) {
      const L = (window as any).L;
      mapRef.current = L.map('map', {
        zoomControl: false,
        attributionControl: false
      }).setView([0, 0], 2);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapRef.current);

      mapRef.current.on('click', (e: any) => {
        if (!alarm.isActive) {
          const { lat, lng } = e.latlng;
          setAlarm(prev => ({ ...prev, destination: { lat, lng }, isTriggered: false }));
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [alarm.isActive]);

  // Update Map Markers & Visuals
  useEffect(() => {
    const L = (window as any).L;
    if (!mapRef.current) return;

    if (alarm.destination) {
      if (markerRef.current) {
        markerRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
      } else {
        markerRef.current = L.marker([alarm.destination.lat, alarm.destination.lng], {
          draggable: !alarm.isActive,
          icon: L.icon({
              iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
              shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41]
          })
        }).addTo(mapRef.current);
        
        markerRef.current.on('dragend', (e: any) => {
          const { lat, lng } = e.target.getLatLng();
          setAlarm(prev => ({ ...prev, destination: { lat, lng } }));
        });
      }

      if (radiusCircleRef.current) {
        radiusCircleRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
        radiusCircleRef.current.setRadius(alarm.radius);
      } else {
        radiusCircleRef.current = L.circle([alarm.destination.lat, alarm.destination.lng], {
          radius: alarm.radius,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.2
        }).addTo(mapRef.current);
      }
    } else {
      if (markerRef.current) { mapRef.current.removeLayer(markerRef.current); markerRef.current = null; }
      if (radiusCircleRef.current) { mapRef.current.removeLayer(radiusCircleRef.current); radiusCircleRef.current = null; }
    }

    if (location.current) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([location.current.lat, location.current.lng]);
      } else {
        userMarkerRef.current = L.circleMarker([location.current.lat, location.current.lng], {
          radius: 8,
          color: '#fff',
          fillColor: '#ef4444',
          fillOpacity: 1,
          weight: 2
        }).addTo(mapRef.current);
      }
    }
  }, [alarm.destination, alarm.radius, alarm.isActive, location.current]);

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation(prev => ({ ...prev, error: 'Geolocation not supported' }));
      return;
    }
    const startTracking = () => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation({ current: newCoords, error: null, accuracy: pos.coords.accuracy });
          if (mapRef.current && !location.current) {
            mapRef.current.setView([newCoords.lat, newCoords.lng], 15);
          }
        },
        (err) => setLocation(prev => ({ ...prev, error: err.message })),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    };
    startTracking();
    return () => { if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, []);

  // Monitor Distance
  useEffect(() => {
    if (alarm.isActive && alarm.destination && location.current) {
      const dist = calculateDistance(location.current, alarm.destination);
      setDistanceToDest(dist);

      if (dist <= alarm.radius && !alarm.isTriggered) {
        setAlarm(prev => ({ ...prev, isTriggered: true }));
        if (audioRef.current) {
          audioRef.current.volume = 1.0;
          audioRef.current.play().catch(e => {
            console.error("Erro ao tocar alarme:", e);
            alert("CHEGOU! (O som foi bloqueado pelo navegador, verifique as permissões)");
          });
        }
        if ('vibrate' in navigator) {
          navigator.vibrate([1000, 500, 1000, 500, 1000]);
        }
      }
    }
  }, [location.current, alarm.isActive, alarm.destination, alarm.radius, alarm.isTriggered]);

  // Actions
  const testSound = () => {
    if (audioRef.current) {
      audioRef.current.volume = 1.0;
      audioRef.current.play().then(() => {
        setIsAudioUnlocked(true);
        setTimeout(() => {
          if (!alarm.isTriggered) {
            audioRef.current?.pause();
            if (audioRef.current) audioRef.current.currentTime = 0;
          }
        }, 2000);
      }).catch(err => {
        console.error("Som bloqueado:", err);
        alert("Por favor, clique na tela para permitir o som.");
      });
    }
  };

  const toggleAlarm = async () => {
    if (!alarm.destination) return;
    
    if (!alarm.isActive) {
      // "Desbloquear" o áudio tocando um silêncio ou iniciando o play/pause
      testSound(); 
      setAlarm(prev => ({ ...prev, isActive: true, isTriggered: false }));
      setTips("Gerando dicas de segurança...");
      const newTips = await getTravelTips("seu destino");
      setTips(newTips || '');
    } else {
      stopAlarm();
    }
  };

  const stopAlarm = () => {
    setAlarm(prev => ({ ...prev, isActive: false, isTriggered: false }));
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const centerOnUser = () => {
    if (location.current && mapRef.current) {
      mapRef.current.flyTo([location.current.lat, location.current.lng], 16);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 font-sans">
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-10 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-inner">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="font-black text-xl tracking-tighter text-white">BusSnooze</h1>
        </div>
        
        {location.accuracy && (
          <div className="text-[10px] text-slate-400 bg-slate-800/80 px-2 py-1 rounded-full border border-slate-700 flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${location.accuracy < 30 ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
            GPS: {Math.round(location.accuracy)}m
          </div>
        )}
      </header>

      <main className="flex-1 relative flex flex-col md:flex-row">
        <div id="map" className="flex-1 min-h-[40%] md:min-h-full relative grayscale-[0.2] brightness-[0.9]">
          <button 
            onClick={centerOnUser}
            className="absolute bottom-6 left-6 z-[1000] p-4 bg-white text-slate-800 rounded-2xl shadow-2xl hover:bg-slate-100 transition-all active:scale-90"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <aside className="w-full md:w-96 bg-slate-900 overflow-y-auto z-10 p-6 flex flex-col gap-6 border-t md:border-t-0 md:border-l border-slate-800 shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
          
          {!alarm.destination && (
            <div className="bg-blue-600/10 border border-blue-500/30 p-5 rounded-2xl text-blue-200 text-sm animate-pulse">
              <p className="flex items-center gap-3 font-semibold">
                <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                Toque no mapa para marcar onde você quer acordar!
              </p>
            </div>
          )}

          {alarm.destination && (
            <div className="space-y-6">
              <div className="flex gap-2">
                <button 
                  onClick={testSound}
                  className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-300 flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  TESTAR SOM
                </button>
                <button 
                  onClick={() => setAlarm(prev => ({ ...prev, destination: null, isActive: false }))}
                  className="p-2 bg-slate-800 hover:bg-red-900/40 rounded-xl text-slate-400 hover:text-red-400 border border-slate-700 transition-all"
                  disabled={alarm.isActive}
                >
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Raio de Alerta</label>
                  <span className="text-xl font-black text-blue-500">{alarm.radius}m</span>
                </div>
                <input 
                  type="range" min={MIN_RADIUS} max={MAX_RADIUS} step="50"
                  value={alarm.radius}
                  onChange={(e) => setAlarm(prev => ({ ...prev, radius: parseInt(e.target.value) }))}
                  disabled={alarm.isActive}
                  className="w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <button
                onClick={toggleAlarm}
                className={`w-full py-5 rounded-2xl font-black text-xl transition-all transform active:scale-95 shadow-[0_10px_20px_rgba(0,0,0,0.3)] flex items-center justify-center gap-3 ${
                  alarm.isActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {alarm.isActive ? 'CANCELAR RASTREIO' : 'ATIVAR ALARME'}
              </button>

              {alarm.isActive && distanceToDest !== null && (
                <div className="bg-slate-950 p-8 rounded-3xl border border-blue-500/20 flex flex-col items-center gap-1 shadow-inner">
                  <span className="text-slate-500 text-[10px] uppercase font-bold tracking-[0.3em]">Distância</span>
                  <span className={`text-5xl font-black tracking-tighter ${alarm.isTriggered ? 'text-red-500 animate-bounce' : 'text-white'}`}>
                    {formatDistance(distanceToDest)}
                  </span>
                </div>
              )}

              {alarm.isActive && tips && (
                <div className="bg-indigo-500/5 border border-indigo-500/20 p-5 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-indigo-400 font-black text-[10px] uppercase tracking-widest">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM13.464 15.05a1 1 0 010 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1z" /></svg>
                    Dicas de Viagem
                  </div>
                  <p className="text-sm text-slate-300 italic leading-relaxed">
                    {tips}
                  </p>
                </div>
              )}
            </div>
          )}

          {location.error && (
            <div className="mt-auto bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-red-400 text-xs">
              <p className="font-black uppercase mb-1">Erro de GPS</p>
              <p className="opacity-80">{location.error}</p>
            </div>
          )}
          
          <div className="mt-auto text-[10px] text-slate-700 text-center font-bold uppercase tracking-[0.2em] pb-2">
            Mantenha a tela ligada
          </div>
        </aside>
      </main>

      {alarm.isTriggered && (
        <div className="fixed inset-0 z-[9999] bg-red-600 flex items-center justify-center p-8 text-center animate-in fade-in duration-300">
          <div className="max-w-md w-full space-y-10">
            <div className="flex justify-center">
              <div className="bg-white p-10 rounded-full shadow-[0_0_100px_rgba(255,255,255,0.5)] animate-bounce">
                 <svg className="w-20 h-20 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                   <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                 </svg>
              </div>
            </div>
            
            <div className="space-y-4">
              <h2 className="text-6xl font-black text-white tracking-tighter uppercase leading-none">CHEGOU!</h2>
              <p className="text-red-100 text-2xl font-bold opacity-90">Você está a menos de {alarm.radius}m do seu ponto.</p>
            </div>

            <button
              onClick={stopAlarm}
              className="w-full bg-white text-red-600 py-8 rounded-[2rem] font-black text-3xl shadow-2xl hover:scale-105 active:scale-95 transition-all"
            >
              JÁ ACORDEI!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
