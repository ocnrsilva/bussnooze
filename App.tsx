
import React, { useState, useEffect, useRef } from 'react';
import { Coords, AlarmConfig, LocationState } from './types';
import { calculateDistance, formatDistance } from './utils/geo';
import { getTravelTips } from './services/geminiService';

const ALARM_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const App: React.FC = () => {
  const [location, setLocation] = useState<LocationState>({ current: null, error: null, accuracy: null });
  const [alarm, setAlarm] = useState<AlarmConfig>({
    destination: null,
    radius: 500,
    isActive: false,
    isTriggered: false,
    addressName: ''
  });
  const [tips, setTips] = useState<string>('');
  const [distanceToDest, setDistanceToDest] = useState<number | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vibrationIntervalRef = useRef<number | null>(null);

  // Audio Setup
  useEffect(() => {
    const audio = new Audio(ALARM_SOUND_URL);
    audio.loop = true;
    audioRef.current = audio;
  }, []);

  // Effect to handle persistent alarm (Sound + Vibration)
  useEffect(() => {
    if (alarm.isTriggered) {
      // Start/Keep playing audio
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => console.log("User interaction required for audio"));
      }

      // Start persistent vibration loop
      if (navigator.vibrate) {
        // Initial vibration
        navigator.vibrate([1000, 500, 1000]);
        // Loop every 2.5 seconds (duration of pattern above)
        vibrationIntervalRef.current = window.setInterval(() => {
          navigator.vibrate([1000, 500, 1000]);
        }, 3000);
      }
    } else {
      // Cleanup when alarm is dismissed
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      if (navigator.vibrate) {
        navigator.vibrate(0); // Stop any ongoing vibration
      }
    }

    return () => {
      if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
    };
  }, [alarm.isTriggered]);

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current) {
      const L = (window as any).L;
      mapRef.current = L.map('map', { zoomControl: false, attributionControl: false }).setView([0, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapRef.current);
      mapRef.current.on('click', (e: any) => {
        if (!alarm.isActive) {
          const { lat, lng } = e.latlng;
          setAlarm(prev => ({ ...prev, destination: { lat, lng }, isTriggered: false }));
        }
      });
    }
  }, [alarm.isActive]);

  // Map markers
  useEffect(() => {
    const L = (window as any).L;
    if (!mapRef.current) return;

    if (alarm.destination) {
      if (!markerRef.current) {
        markerRef.current = L.marker([alarm.destination.lat, alarm.destination.lng], {
          icon: L.icon({
              iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
              shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41]
          })
        }).addTo(mapRef.current);
      } else {
        markerRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
      }

      if (!radiusCircleRef.current) {
        radiusCircleRef.current = L.circle([alarm.destination.lat, alarm.destination.lng], {
          radius: alarm.radius,
          color: '#3b82f6',
          fillOpacity: 0.2
        }).addTo(mapRef.current);
      } else {
        radiusCircleRef.current.setLatLng([alarm.destination.lat, alarm.destination.lng]);
        radiusCircleRef.current.setRadius(alarm.radius);
      }
    }

    if (location.current) {
      if (!userMarkerRef.current) {
        userMarkerRef.current = L.circleMarker([location.current.lat, location.current.lng], {
          radius: 8, color: '#fff', fillColor: '#ef4444', fillOpacity: 1, weight: 2
        }).addTo(mapRef.current);
      } else {
        userMarkerRef.current.setLatLng([location.current.lat, location.current.lng]);
      }
    }
  }, [alarm.destination, alarm.radius, location.current]);

  // Geolocation
  useEffect(() => {
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation({ current: coords, error: null, accuracy: pos.coords.accuracy });
        if (mapRef.current && !location.current) mapRef.current.setView([coords.lat, coords.lng], 15);
      },
      (err) => setLocation(prev => ({ ...prev, error: err.message })),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Distance monitoring
  useEffect(() => {
    if (alarm.isActive && alarm.destination && location.current) {
      const dist = calculateDistance(location.current, alarm.destination);
      setDistanceToDest(dist);
      if (dist <= alarm.radius && !alarm.isTriggered) {
        setAlarm(prev => ({ ...prev, isTriggered: true }));
      }
    }
  }, [location.current, alarm.isActive, alarm.destination, alarm.radius, alarm.isTriggered]);

  const toggleAlarm = async () => {
    if (!alarm.destination) return;
    if (!alarm.isActive) {
      // Warm up audio on user interaction to bypass browser restrictions
      audioRef.current?.play().then(() => {
        audioRef.current?.pause();
        audioRef.current!.currentTime = 0;
      }).catch(() => {});
      
      setAlarm(prev => ({ ...prev, isActive: true }));
      const t = await getTravelTips("seu destino");
      setTips(t || '');
    } else {
      setAlarm(prev => ({ ...prev, isActive: false, isTriggered: false }));
      setTips('');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">
      {/* Header */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center z-10">
        <h1 className="font-black text-xl text-blue-500">BusSnooze</h1>
      </header>

      {/* Map */}
      <div id="map" className="flex-1 z-0 relative brightness-75 grayscale-[0.2]"></div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-slate-900/90 backdrop-blur-md border-t border-slate-800 rounded-t-3xl shadow-2xl safe-area-bottom">
        {!alarm.destination ? (
          <div className="text-center py-4 animate-pulse text-blue-300 font-bold">
            📍 Toque no mapa para marcar seu destino
          </div>
        ) : (
          <div className="space-y-4">
            {tips && alarm.isActive && (
              <div className="p-3 bg-blue-900/50 border border-blue-800 rounded-xl text-xs text-blue-100 animate-in fade-in slide-in-from-bottom-2">
                <span className="font-bold text-blue-400 block mb-1">DICAS DE SEGURANÇA:</span>
                <p className="whitespace-pre-line leading-relaxed">{tips}</p>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Raio: {alarm.radius}m</span>
              {distanceToDest !== null && alarm.isActive && (
                <span className="text-blue-400 font-black tracking-tighter text-lg">{formatDistance(distanceToDest)}</span>
              )}
            </div>
            
            <input 
              type="range" min="100" max="3000" step="100"
              value={alarm.radius}
              disabled={alarm.isActive}
              onChange={(e) => setAlarm(prev => ({ ...prev, radius: parseInt(e.target.value) }))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none accent-blue-600"
            />

            <button
              onClick={toggleAlarm}
              className={`w-full py-4 rounded-2xl font-black text-lg transition-all ${
                alarm.isActive ? 'bg-red-600' : 'bg-blue-600'
              }`}
            >
              {alarm.isActive ? 'CANCELAR RASTREIO' : 'ATIVAR ALARME'}
            </button>
          </div>
        )}
      </div>

      {/* Trigger Screen */}
      {alarm.isTriggered && (
        <div className="fixed inset-0 z-[2000] bg-red-600 flex flex-col items-center justify-center text-center p-8">
          <div className="bg-white p-8 rounded-full mb-8 shadow-2xl animate-bounce">
            <svg className="w-16 h-16 text-red-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" />
            </svg>
          </div>
          <h2 className="text-6xl font-black mb-4 uppercase tracking-tighter">Acorda!</h2>
          <p className="text-2xl font-bold mb-10 opacity-90">Você chegou ao seu destino.</p>
          <button 
            onClick={() => {
              setAlarm(prev => ({ ...prev, isActive: false, isTriggered: false }));
              setTips('');
            }}
            className="bg-white text-red-600 px-12 py-6 rounded-3xl font-black text-2xl shadow-xl active:scale-95 transition-transform"
          >
            ESTOU ACORDADO
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
