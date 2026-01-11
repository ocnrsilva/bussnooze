
export interface Coords {
  lat: number;
  lng: number;
}

export interface AlarmConfig {
  destination: Coords | null;
  radius: number; // in meters
  isActive: boolean;
  isTriggered: boolean;
  addressName?: string;
}

export interface LocationState {
  current: Coords | null;
  error: string | null;
  accuracy: number | null;
}

export interface HistoryItem {
  id: string;
  display_name: string;
  lat: string;
  lon: string;
  timestamp: number;
}
