import { useEffect, useState } from 'react';

interface BatteryState {
  level: number | null;
  charging: boolean;
}

export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({ level: null, charging: false });

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<any> };
    if (!nav.getBattery) return;

    let battery: any = null;
    const update = () => {
      if (battery) setState({ level: battery.level, charging: battery.charging });
    };

    nav.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });

    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, []);

  return state;
}
