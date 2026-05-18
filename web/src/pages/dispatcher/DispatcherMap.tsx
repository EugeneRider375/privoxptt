import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { useStore } from '@/store/useStore';
import { formatDistanceToNow } from 'date-fns';

const EUROPE_CENTER: [number, number] = [46.6, 2.4];
const EUROPE_ZOOM = 6;

// Иконка маркера в стиле рации
function makeIcon(callsign: string, isOnline: boolean) {
  return divIcon({
    html: `
      <div style="
        background: ${isOnline ? '#0A0C0A' : '#161C16'};
        border: 2px solid ${isOnline ? '#3DDC84' : '#2A3A2A'};
        border-radius: 4px;
        padding: 2px 6px;
        font-family: 'Share Tech Mono', monospace;
        font-size: 11px;
        color: ${isOnline ? '#3DDC84' : '#8BA888'};
        white-space: nowrap;
        box-shadow: ${isOnline ? '0 0 8px rgba(61,220,132,0.3)' : 'none'};
      ">
        ${callsign}
      </div>
    `,
    className: '',
    iconAnchor: [0, 0],
  });
}

function MapAutoCenter({ locations }: { locations: Array<{ lat: number; lng: number }> }) {
  const map = useMap();

  useEffect(() => {
    if (locations.length > 0) {
      const bounds = latLngBounds(locations.map((loc) => [loc.lat, loc.lng]));
      map.fitBounds(bounds.pad(0.28), { maxZoom: 12, animate: false });
      return;
    }

    if (!navigator.geolocation) {
      map.setView(EUROPE_CENTER, EUROPE_ZOOM, { animate: false });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 10, { animate: false });
      },
      () => {
        map.setView(EUROPE_CENTER, EUROPE_ZOOM, { animate: false });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 4_000 }
    );
  }, [locations, map]);

  return null;
}

export function DispatcherMap() {
  const locations = useStore((s) => s.locations);
  const onlineUsers = useStore((s) => s.onlineUsers);

  const locationList = Object.values(locations);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-ptt-panel border-b border-ptt-border">
        <span className="font-mono text-ptt-text text-xs tracking-widest">SUBSCRIBER MAP</span>
        <span className="font-mono text-xs text-ptt-green">{locationList.length} markers</span>
      </div>

      <div className="flex-1 relative">
        <MapContainer
          center={EUROPE_CENTER}
          zoom={EUROPE_ZOOM}
          className="dispatcher-map w-full h-full"
          style={{ background: '#101610' }}
        >
          <MapAutoCenter locations={locationList} />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />

          {locationList.map((loc) => {
            const isOnline = !!onlineUsers[loc.userId];
            return (
              <Marker
                key={loc.userId}
                position={[loc.lat, loc.lng]}
                icon={makeIcon(loc.callsign, isOnline)}
              >
                <Popup className="ptt-popup">
                  <div className="font-mono text-xs space-y-1 bg-ptt-panel p-2 rounded border border-ptt-border">
                    <p className="callsign">{loc.callsign}</p>
                    <p className="text-ptt-text">
                      {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
                    </p>
                    {loc.speed != null && (
                      <p className="text-ptt-text">
                        Speed: {(loc.speed * 3.6).toFixed(0)} km/h
                      </p>
                    )}
                    <p className="text-ptt-muted">
                      {formatDistanceToNow(loc.timestamp, { addSuffix: true })}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {locationList.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="font-mono text-ptt-muted text-sm">NO LOCATION DATA</p>
              <p className="font-mono text-ptt-text text-xs mt-1">Subscribers are not sending GPS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
