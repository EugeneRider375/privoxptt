import { useEffect, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { useStore } from '@/store/useStore';
import { formatDistanceToNow } from 'date-fns';
import { locationsApi } from '@/api/client';

const EUROPE_CENTER: [number, number] = [46.6, 2.4];
const EUROPE_ZOOM = 6;
// D53 — режим "фокус на одном абоненте": насколько близко приближать.
// Leaflet+OSM тянут детальный вид (улицы/здания) без доп. затрат — карта
// раньше просто никогда не зумила так близко (всегда fitBounds на всех).
const FOCUS_ZOOM = 17;
// Как долго после чек-ина подсвечивать маркер зелёной галочкой на карте.
const ARRIVAL_HIGHLIGHT_MS = 10 * 60 * 1000;

// Иконка маркера в стиле рации. arrived — недавний чек-ин "Я прибыл" (D53):
// зелёная галочка поверх, отдельно от online/offline цвета самой рамки.
function makeIcon(callsign: string, isOnline: boolean, arrived: boolean) {
  return divIcon({
    html: `
      <div style="position: relative;">
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
        ${arrived ? `
          <div style="
            position: absolute; top: -8px; right: -8px;
            width: 16px; height: 16px; border-radius: 50%;
            background: #3DDC84; border: 2px solid #0A0C0A;
            display: flex; align-items: center; justify-content: center;
            font-size: 10px; color: #0A0C0A; font-weight: bold;
            box-shadow: 0 0 6px rgba(61,220,132,0.6);
          ">✓</div>
        ` : ''}
      </div>
    `,
    className: '',
    iconAnchor: [0, 0],
  });
}

function MapAutoCenter({
  locations,
  focusLocation,
}: {
  locations: Array<{ lat: number; lng: number }>;
  focusLocation?: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (focusLocation) {
      map.setView([focusLocation.lat, focusLocation.lng], FOCUS_ZOOM, { animate: true });
      return;
    }

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
  }, [locations, focusLocation, map]);

  return null;
}

export function DispatcherMap() {
  const locations = useStore((s) => s.locations);
  const onlineUsers = useStore((s) => s.onlineUsers);
  const updateLocation = useStore((s) => s.updateLocation);
  const arrivals = useStore((s) => s.arrivals);
  const addArrival = useStore((s) => s.addArrival);
  // D53 — режим "фокус на одном": клик по маркеру приближает и держит карту
  // на нём вместо привычного fitBounds по всем сразу.
  const [focusUserId, setFocusUserId] = useState<string | null>(null);

  // Живая трансляция по сокету (user-location) знает только о тех, кто
  // отправил координаты, пока эта вкладка уже открыта — без подгрузки карта
  // была пустой для всех, кто не в сети именно сейчас (D35). Один раз при
  // открытии подтягиваем последние сохранённые позиции, дальше живые
  // обновления освежают их поверх.
  useEffect(() => {
    locationsApi.list().then((list) => {
      list.forEach((loc) => updateLocation(loc));
    }).catch(() => {
      // Диспетчер и без этого увидит карту, просто без "холодного старта" —
      // не повод показывать ошибку поверх карты.
    });
  }, [updateLocation]);

  // То же самое для чек-инов "Я прибыл" (D53) — иначе диспетчер, открывший
  // карту позже самого события, не увидел бы его вообще.
  useEffect(() => {
    locationsApi.arrivals().then((list) => {
      list.forEach((checkIn) => addArrival(checkIn));
    }).catch(() => {});
  }, [addArrival]);

  const locationList = Object.values(locations);
  const focusLocation = focusUserId ? locations[focusUserId] ?? null : null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-ptt-panel border-b border-ptt-border">
        <span className="font-mono text-ptt-text text-xs tracking-widest">
          SUBSCRIBER MAP{focusUserId && locations[focusUserId] ? ` · ${locations[focusUserId].callsign}` : ''}
        </span>
        <span className="font-mono text-xs text-ptt-green">{locationList.length} markers</span>
      </div>

      <div className="flex-1 relative">
        {focusUserId && (
          <button
            onClick={() => setFocusUserId(null)}
            className="absolute top-2 right-2 z-[1000] px-3 py-1.5 rounded border border-ptt-blue/50 bg-ptt-panel/95 text-ptt-blue font-mono text-xs tracking-widest hover:bg-ptt-blue/10 transition-colors"
          >
            SHOW ALL
          </button>
        )}
        <MapContainer
          center={EUROPE_CENTER}
          zoom={EUROPE_ZOOM}
          className="dispatcher-map w-full h-full"
          style={{ background: '#101610' }}
        >
          <MapAutoCenter locations={locationList} focusLocation={focusLocation} />
          {/* CARTO (basemaps.cartocdn.com) ужесточил условия бесплатного
              анонимного доступа — тайлы стали отдавать плашку "get an API
              key" вместо карты (замечено 2026-08-27, ключа в проекте не
              было никогда, это изменение на стороне CARTO). OpenStreetMap —
              единственный крупный провайдер тайлов, не требующий ключа
              вообще, ценой менее стилизованного вида и собственной политики
              разумного использования (без проблем для внутреннего
              инструмента с горсткой диспетчеров). */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          {locationList.map((loc) => {
            const isOnline = !!onlineUsers[loc.userId];
            const arrival = arrivals[loc.userId];
            const arrived = !!arrival && Date.now() - arrival.timestamp < ARRIVAL_HIGHLIGHT_MS;
            return (
              <Marker
                key={loc.userId}
                position={[loc.lat, loc.lng]}
                icon={makeIcon(loc.callsign, isOnline, arrived)}
                eventHandlers={{
                  click: () => setFocusUserId((current) => (current === loc.userId ? null : loc.userId)),
                }}
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
                    {arrived && (
                      <p className="text-ptt-green">
                        ✓ Arrived {formatDistanceToNow(arrival.timestamp, { addSuffix: true })}
                      </p>
                    )}
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
