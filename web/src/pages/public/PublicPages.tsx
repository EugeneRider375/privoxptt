import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FileQuestion,
  Headphones,
  Lock,
  MapPinned,
  MessageCircle,
  Mic,
  Radio,
  Router,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { authApi } from '@/api/client';
import { unregisterNativePushDevice } from '@/hooks/useNativePush';
import { PrivoxLogo } from '@/components/brand/PrivoxLogo';
import { disconnectPrivoxSocket } from '@/hooks/useSocket';
import { useStore } from '@/store/useStore';

const navLinks = [
  { to: '/download', label: 'Download' },
  // Презентация системы — отдельная статическая страница (web/public/presentation),
  // а не маршрут приложения. Поэтому external: обычная ссылка, не Link роутера —
  // иначе роутер попытается отрисовать её сам и покажет пустоту.
  // Из английского меню ведём на английскую версию; русскую дают ссылкой напрямую.
  { to: '/presentation/en/', label: 'Overview', external: true },
  { to: '/docs', label: 'Docs' },
  { to: '/faq', label: 'FAQ' },
  { to: '/support', label: 'Support' },
  { to: '/status', label: 'Status' },
];

const audience = [
  ['Security teams', ShieldCheck],
  ['Dispatch centers', Headphones],
  ['Logistics', MapPinned],
  ['Farms and field teams', Cloud],
  ['Remote sites', Wifi],
  ['Garages and monitoring', Building2],
  ['Technical services', Wrench],
  ['Private teams', Users],
];

const features = [
  ['Push-to-talk voice', Mic],
  ['User groups', Users],
  ['Dispatcher mode', Headphones],
  ['Administration tools', TerminalSquare],
  ['Browser access', Cloud],
  ['Android app path', Smartphone],
  ['PRIVOX Mini Radio hardware', Radio],
  ['WebRTC audio', Wifi],
  ['Secure authentication', Lock],
];

const platforms = [
  { title: 'Web', status: 'Available now', icon: Cloud, tone: 'text-sky-700 bg-sky-50 border-sky-100' },
  { title: 'Android', status: 'Signed APK available', icon: Smartphone, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
  { title: 'Inrico T320', status: 'Hardware radio — verified', icon: Radio, tone: 'text-orange-700 bg-orange-50 border-orange-100' },
  { title: 'PRIVOX Mini Radio', status: 'Available — self-build', icon: Radio, tone: 'text-indigo-700 bg-indigo-50 border-indigo-100' },
  { title: 'iPhone', status: 'Use web version now', icon: BadgeCheck, tone: 'text-slate-700 bg-slate-50 border-slate-200' },
];

const docs = [
  {
    title: 'System overview',
    text: 'PRIVOX PTT is a browser-based push-to-talk system with a signed Android wrapper. The platform uses the web interface, authorization, groups, WebRTC audio, dispatcher tools, and backend.',
    items: ['Web app: /app', 'Signed Android APK: /download', 'Roles: superadmin, admin, dispatcher, user', 'Organizations isolate groups and users'],
  },
  {
    title: 'Quick start for testers',
    text: 'Use this flow when giving access to a new test team.',
    items: ['Create or choose an organization', 'Create an organization admin', 'Let the admin create groups and users', 'Install Android APK or open the web app', 'Allow microphone and location permissions', 'Test transmit, receive, logout, and login'],
  },
  {
    title: 'Organizations',
    text: 'Organizations separate customers, teams, or test environments. A superadmin can create organizations and move users between them.',
    items: ['Superadmin sees all organizations', 'Admin works only inside their organization', 'Moving a user removes memberships in groups from the previous organization', 'After moving a user, add them to groups in the new organization'],
  },
  {
    title: 'User roles',
    text: 'Roles define what each account can do inside the system.',
    items: ['SUPERADMIN: manages all organizations', 'ADMIN: manages users and groups inside one organization', 'DISPATCHER: uses dispatcher console and map', 'USER: uses radio/PTT mode'],
  },
  {
    title: 'Groups and channels',
    text: 'Groups are the voice channels used for PTT communication.',
    items: ['Create groups inside the selected organization', 'Add users to one or more groups', 'Use can-speak permission to control who may transmit', 'Keep test groups small at first: 2-4 users is ideal'],
  },
  {
    title: 'Dispatcher workflow',
    text: 'Dispatcher mode is used for operational monitoring and calls.',
    items: ['Open dispatcher console', 'Monitor online users and active channel state', 'Use map view when location permission is enabled', 'Check SOS/user call behavior during tests'],
  },
  {
    title: 'Android application',
    text: 'The Android app combines the production web interface with native background calling and Firebase wake-up support.',
    items: ['Uses existing login and groups', 'Supports PTT, individual calls, and CALL GROUP', 'Wakes a sleeping phone through Firebase', 'Shows native ANSWER and DECLINE controls', 'Uses a foreground service for background availability'],
  },
  {
    title: 'iPhone and desktop web',
    text: 'iPhone users can use the web version in Safari while native iOS distribution is planned later.',
    items: ['Open /app in Safari on iPhone', 'Use Share -> Add to Home Screen for a home icon', 'Keep the web app open for incoming calls', 'Locked-screen iPhone wake-up requires a future native iOS/APNs app', 'On desktop, use a modern browser and allow microphone access'],
  },
  {
    title: 'Android app — user guide',
    text: 'Step-by-step instructions for the PRIVOX PTT Android app. Works over Wi-Fi or mobile data. PTT works like a radio: press to speak, release to listen.',
    steps: [
      'Open PRIVOX PTT and allow microphone, notification, and full-screen call permissions when prompted.',
      'Allow unrestricted battery usage when prompted — this keeps the app reachable while the screen is off.',
      'Enter the login and password given by your administrator and tap Sign in. Credentials are saved — you will not need to log in again after a normal restart.',
      'Tap the active group name at the top of the screen to open the group list and select your group.',
      'Press and hold the large microphone button. Speak after TRANSMITTING appears. Release the button to stop transmitting and listen to others.',
      'To call one person: find them in the participant list with a green or blue phone icon and tap it. Green means online now; blue means the phone is asleep but can be woken by the call.',
      'Incoming call: the screen lights up with the caller name and group. Tap ANSWER to open PRIVOX PTT and join the group, or DECLINE to dismiss without opening the app.',
      'To stay available: lock the screen normally — do not tap Log out. Use Log out only when switching accounts.',
    ],
    items: [
      'No audio: check microphone permission in Android settings and confirm the correct group is selected.',
      'No ringtone on incoming call: check that notifications and full-screen call permissions are enabled for PRIVOX PTT.',
      'App not reachable when screen is off: set battery to Unrestricted in Android settings for PRIVOX PTT.',
      'Connection lost after switching networks: wait a few seconds for automatic reconnection, then press PTT.',
      'Status colours take up to 60 seconds to update across all devices — this is normal.',
    ],
  },
  {
    title: 'iPhone — user guide',
    text: 'PRIVOX PTT runs as a web app in Safari on iPhone. No App Store installation is needed. Works over Wi-Fi or mobile data.',
    steps: [
      'Open Safari and go to https://ptt.privox.tech/app — do not use Safari private mode, as login will not be saved.',
      'Enter your login and password and tap Sign in. Allow microphone access when Safari asks.',
      'To add a home screen icon: tap the Share button (square with arrow), scroll to Add to Home Screen, and tap Add. Open the app from that icon in the future.',
      'Tap the group name at the top to select your group before transmitting.',
      'Press and hold the large microphone button. Speak after TRANSMITTING appears. Release to listen.',
      'To call one person: tap the phone icon next to their name in the participant list.',
      'Incoming call while the app is open: tap ANSWER to join the group, or DECLINE to dismiss.',
      'Keep PRIVOX PTT open and the screen unlocked during duty. The current web version cannot wake a locked iPhone — a future native iOS app will add this.',
    ],
    items: [
      'No microphone: in Safari, open website settings for ptt.privox.tech and allow microphone access.',
      'No sound: raise media volume with the side buttons and disconnect any Bluetooth device.',
      'Missed call with screen locked: this is a current iOS web limitation — keep the app open on screen.',
      'Old interface after update: fully close and reopen the app, or force-reload in Safari.',
    ],
  },
  {
    title: 'Desktop browser — user guide',
    text: 'PRIVOX PTT works directly in a modern browser on any computer. No installation needed. Recommended browsers: Chrome, Edge, or Safari.',
    steps: [
      'Open https://ptt.privox.tech/app in Chrome, Edge, or Safari.',
      'Enter your login and password and tap Sign in. Allow the browser to use the microphone when prompted.',
      'Select a group from the list on the screen. The active group name is shown at the top.',
      'Press and hold the PTT button, or hold the Space bar (when not in a text field) to transmit. Release to stop.',
      'To call one person: click the phone icon next to their name. Green = online, blue = sleeping Android reachable via push, grey = unavailable.',
      'Dispatchers can click CALL GROUP to ring all members of a group at once — even those currently in other groups.',
      'After the called participant taps ANSWER, their device switches to the called group automatically.',
    ],
    items: [
      'No microphone: click the lock or microphone icon in the browser address bar and allow access.',
      'Old interface: press Ctrl+Shift+R on Windows or Cmd+Shift+R on macOS to force-reload.',
      'Connection lost after switching networks: wait a few seconds, then press PTT once to resume.',
      'Close any other app that may be holding the microphone (video calls, recording software).',
    ],
  },
  {
    title: 'Test checklist',
    text: 'Use this list before reporting that a test account is ready.',
    items: ['Login works', 'Microphone permission appears', 'Transmit and receive work', 'Dispatcher map shows location when allowed', 'Screen does not sleep during active Android test', 'Logout/login works after restart'],
  },
  {
    title: 'Current limitations',
    text: 'These items are not part of the current release.',
    items: ['No native iOS/APNs wake-up yet', 'No Bluetooth headset certification yet', 'No Google Play or App Store distribution yet', 'PRIVOX Mini Radio cannot switch groups automatically after a call yet'],
  },
  {
    title: 'Inrico T320 digital radio',
    text: 'Inrico T320 is a commercial Android-based PTT radio that runs the PRIVOX PTT application natively. It has a dedicated hardware PTT button, an integrated speaker and microphone, a 3800 mAh battery, and supports SIM card (2G/3G), Wi-Fi, Bluetooth, and GPS. The device runs Android 8.1 with an updatable WebView and works as a drop-in radio for PRIVOX PTT without any visible difference from the web or Android app experience.',
    items: [
      'Works in the same groups as web and Android users — all users hear each other',
      'Dedicated hardware PTT side button triggers transmit instantly, same as pressing the on-screen button',
      'SIM card option lets the device work on cellular data without a Wi-Fi hotspot',
      'Standalone device — no phone or computer needed during operation',
      'Full dispatcher map, SOS, and dispatcher call features work on the device',
      'WebRTC audio (transmit and receive) confirmed on hardware',
    ],
  },
  {
    title: 'Inrico T320 — setup and installation',
    text: 'The T320 requires one-time preparation before use: updating the system WebView and installing the PRIVOX PTT APK. An administrator completes this setup once; after that the user only needs to log in.',
    items: [
      'Connect the T320 to Wi-Fi and open the Play Store — update Chrome to the latest version (WebView is powered by Chrome on this device)',
      'Download the PRIVOX PTT APK from ptt.privox.tech/download on the device or sideload it via USB',
      'Allow installation from the browser if Android asks — tap Settings, enable the option, go back and install',
      'Open PRIVOX PTT, allow microphone and location permissions, and sign in',
      'Press the hardware PTT button on the side — the app immediately enters TRANSMITTING state',
      'The T320 appears in the dispatcher console and on the map the same way as any other user',
    ],
  },
  {
    title: 'PRIVOX Mini Radio',
    text: 'PRIVOX Mini Radio is a compact push-to-talk radio that connects to the PRIVOX PTT server over Wi-Fi. It has a built-in microphone, speaker, PTT button, and a status indicator. No phone or computer is needed during operation — just power on and press to talk.',
    items: [
      'Works in the same groups as web and Android users — all hear each other',
      'Status indicator shows connection state and active transmission at a glance',
      'Volume control built in',
      'Supports up to 5 saved Wi-Fi networks — connects automatically to any available',
      'Works on home Wi-Fi, office networks, or a mobile hotspot',
      'No apps or drivers needed on the user\'s phone',
    ],
  },
  {
    title: 'PRIVOX Mini Radio — first-time setup',
    text: 'The device is configured once through a browser. An administrator prepares the account; the user only needs to add their Wi-Fi network.',
    items: [
      'Administrator creates a user account in PRIVOX PTT and adds it to the required group',
      'Administrator connects to the device setup page and enters the account details',
      'User powers on the device — the indicator blinks purple during setup mode',
      'User connects phone or laptop to the Wi-Fi network named PRIVOX-XXXX (no password required)',
      'Browser opens the setup page automatically — enter Wi-Fi name and password, tap Save',
      'Device restarts, connects to Wi-Fi, and the indicator turns blue — ready to use',
    ],
  },
  {
    title: 'PRIVOX Mini Radio — indicator',
    text: 'The status indicator shows what the device is doing without any sound or display.',
    items: [
      'Purple blinking — setup mode, waiting for Wi-Fi configuration',
      'Purple solid — connecting to Wi-Fi or to the server',
      'Orange — account error, contact the administrator',
      'Blue — connected and ready, no activity in the group',
      'Green — someone in the group is speaking, audio is playing',
      'Red — PTT button is pressed, you are transmitting',
    ],
  },
  {
    title: 'PRIVOX Mini Radio — adding a new Wi-Fi network',
    text: 'To add a new Wi-Fi network without losing existing settings, use the short PTT hold at power-on.',
    items: [
      'Hold the PTT button while powering on the device',
      'Release when the indicator turns yellow (after 3–8 seconds)',
      'Connect to PRIVOX-XXXX Wi-Fi and open the browser',
      'Existing networks and account details are preserved — just add the new network',
      'For a full reset, hold PTT until the indicator turns red (more than 8 seconds)',
    ],
  },
];

const faqs = [
  ['What is PRIVOX PTT?', 'PRIVOX PTT is a secure push-to-talk communication system for teams, dispatchers, and future PoC devices. Users press, speak, and release, similar to radio communication over the internet.'],
  ['Do I need the Android app?', 'No. The web version works today in a modern browser. The Android APK is useful for mobile field testing and faster access from the phone launcher.'],
  ['Can iPhone users test PRIVOX PTT?', 'Yes. iPhone users should open the web app in Safari and can add it to the Home Screen from the Safari Share menu. A native iOS app can be considered later.'],
  ['What does the Android app support now?', 'It supports PTT, individual calls, CALL GROUP, Firebase wake-up, native ANSWER and DECLINE controls, and background availability through a foreground service.'],
  ['Does Android work with the screen locked?', 'Yes. A high-priority Firebase call can wake a registered sleeping Android phone and show the native incoming-call screen. Network access, notifications, and unrestricted battery settings must remain enabled.'],
  ['Does iPhone receive calls with the screen locked?', 'Not reliably in the current web version. Keep PRIVOX PTT open for active use. Guaranteed locked-screen wake-up will require a native iOS application with Apple Push Notification Service.'],
  ['Why does Android ask to install an APK from the browser?', 'PRIVOX PTT is distributed directly from this site rather than through Google Play, so Android asks you to confirm the installation. The build is signed with the production PRIVOX key.'],
  ['Why did an older Android phone show render errors?', 'Older devices may have an outdated Android System WebView. Update Android System WebView from Google Play, restart PRIVOX PTT, and test again.'],
  ['Who creates organizations?', 'A superadmin creates organizations and can assign users to them. Organization admins then manage users and groups inside their own organization.'],
  ['Can a user be moved to another organization?', 'Yes. A superadmin can edit an existing user and select another organization. The user must then be added to groups in the new organization.'],
  ['Can administrators create groups?', 'Yes. Organization admins can create groups, create users, assign users to groups, and manage speaking permissions inside their organization.'],
  ['What if there is no sound?', 'Check that users are in the same group, microphone permission is allowed, the browser or Android WebView is updated, and the network connection is stable. Restart the app once after first installation if needed.'],
  ['What should testers report?', 'Report the device model, Android or browser version, account role, group name, whether transmit or receive failed, and whether restarting the app changed the result.'],
  ['What is Inrico T320?', 'Inrico T320 is a commercial Android-based digital radio. It runs the PRIVOX PTT application as a native APK and works alongside web and Android users in the same groups. The hardware PTT side button is fully integrated and triggers transmit instantly.'],
  ['Does Inrico T320 require a SIM card?', 'No. The T320 works over Wi-Fi without a SIM. A SIM card (2G/3G) can also be used for cellular connectivity in the field, giving the device standalone operation without a separate hotspot.'],
  ['How is Inrico T320 different from the Android app?', 'Both run the same PRIVOX PTT web app through a Capacitor wrapper. The main difference is that T320 is a dedicated radio device with a hardware PTT button, a louder built-in speaker, a large battery, and no distraction from a phone. The T320 APK also intercepts the hardware PTT key and maps it to push-to-talk.'],
  ['Does the hardware PTT button work on Inrico T320?', 'Yes. The side PTT button on the T320 is captured by the PRIVOX PTT app and triggers transmit immediately. Releasing the button stops transmission. No on-screen interaction is needed during operation.'],
  ['What if the Inrico T320 shows a blank screen after opening PRIVOX PTT?', 'The factory Chrome on older T320 units is version 70, which is too old for the web app. Open the Play Store, update Chrome to version 100 or later, then restart PRIVOX PTT. The system WebView on T320 is powered by Chrome, so updating Chrome is sufficient.'],
  ['What is PRIVOX Mini Radio?', 'PRIVOX Mini Radio is a self-build PTT radio based on the ESP32-S3 microcontroller. It connects to the PRIVOX PTT server over Wi-Fi and works inside the same groups as web and Android users.'],
  ['Do I need to program the PRIVOX Mini Radio?', 'No programming tools are needed for configuration. The device starts a Wi-Fi setup portal on first power-on. Connect a phone to the PRIVOX-XXXX network, open a browser, and fill in the Wi-Fi and account details.'],
  ['What hardware do I need to build PRIVOX Mini Radio?', 'ESP32-S3 DevKitC-1, INMP441 I2S microphone, MAX98357A I2S amplifier, a small 4Ω speaker, and a push button. Full wiring details are in the Docs section.'],
  ['How do I add a new Wi-Fi network to PRIVOX Mini Radio?', 'Hold the PTT button while powering on until the LED turns yellow (3–8 seconds), then release. The portal opens with existing settings preserved. Add the new network and save.'],
  ['How do I factory reset PRIVOX Mini Radio?', 'Hold the PTT button while powering on until the LED turns red (more than 8 seconds), then release. All settings are erased and the device restarts the setup portal.'],
  ['Can PRIVOX Mini Radio work on mobile data?', 'Yes. Connect the radio to a mobile hotspot like any other Wi-Fi network. It will authenticate and work the same way as on a home or office network.'],
];

function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user);
  const clearAuth = useStore((s) => s.clearAuth);

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken') ?? '';
    await unregisterNativePushDevice().catch(() => {});
    await authApi.logout(refreshToken).catch(() => {});
    disconnectPrivoxSocket();
    clearAuth();
  }

  return (
    <div className="h-full overflow-y-auto bg-white text-slate-950 font-sans">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-950">
            <PrivoxLogo className="h-9 w-9 shadow-sm" markClassName="h-6 w-6" />
            <span className="text-lg">PRIVOX PTT</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {navLinks.map((link) =>
              link.external ? (
                <a key={link.to} href={link.to} className="hover:text-sky-700">
                  {link.label}
                </a>
              ) : (
                <Link key={link.to} to={link.to} className="hover:text-sky-700">
                  {link.label}
                </Link>
              )
            )}
          </nav>
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={handleLogout}
                className="hidden rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 sm:inline-flex"
              >
                Log out
              </button>
            )}
            <Link
              to="/app"
              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
            >
              {user ? 'Open app' : 'Sign in'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <p className="font-bold text-slate-950">PRIVOX PTT</p>
            <p className="mt-1 text-sm text-slate-500">Secure push-to-talk platform for operational teams.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-medium text-slate-600">
            <Link to="/app" className="hover:text-sky-700">Sign in</Link>
            <Link to="/download" className="hover:text-sky-700">Download</Link>
            <Link to="/docs" className="hover:text-sky-700">Docs</Link>
            <Link to="/faq" className="hover:text-sky-700">FAQ</Link>
            <Link to="/support" className="hover:text-sky-700">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeader({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-lg leading-8 text-slate-600">{text}</p>}
    </div>
  );
}

function AppMockup() {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-2xl shadow-sky-900/10">
      <div className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold">ONLINE</span>
          </div>
          <span className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-200">DISPATCH</span>
        </div>
        <div className="grid gap-3 py-4 sm:grid-cols-[1fr_150px]">
          <div className="space-y-2">
            {['Priority channel', 'Field team', 'Operations channel'].map((name, index) => (
              <div key={name} className={clsx('rounded-md border p-3', index === 1 ? 'border-emerald-400/50 bg-emerald-400/10' : 'border-white/10 bg-white/5')}>
                <div className="flex items-center gap-2">
                  <span className={clsx('h-2 w-2 rounded-full', index === 0 ? 'bg-red-400' : index === 1 ? 'bg-emerald-400' : 'bg-sky-400')} />
                  <span className="text-sm font-semibold">{name}</span>
                  {index === 1 && <Mic className="ml-auto h-4 w-4 text-emerald-300" />}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-white/5 p-4">
            <PrivoxLogo className="h-24 w-24 rounded-2xl shadow-lg shadow-emerald-400/20" markClassName="h-16 w-16" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">Push to talk</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-xs text-slate-300">
          <span>Team online</span>
          <span>WebRTC</span>
          <span>Secure auth</span>
        </div>
      </div>
      <p className="mt-3 px-1 text-xs text-slate-500">
        Placeholder mockup. Future real media can include Android screenshots, dispatcher views, PoC devices, and the PTT interface.
      </p>
    </div>
  );
}

export function HomePage() {
  return (
    <PublicLayout>
      <main>
        <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-slate-100">
          <div className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-sm font-medium text-sky-800 shadow-sm">
                <ShieldCheck className="h-4 w-4" />
                Web version available now
              </div>
              <h1 className="mt-6 text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                PRIVOX PTT
              </h1>
              <p className="mt-6 max-w-2xl text-xl leading-8 text-slate-600">
                A secure push-to-talk communication system for teams, dispatchers, and future PoC devices.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/app" className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                  Sign in to the system <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/download" className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm transition hover:border-sky-300 hover:text-sky-700">
                  Download app <Download className="h-4 w-4" />
                </Link>
                <Link to="/docs" className="inline-flex items-center justify-center gap-2 rounded-md border border-transparent px-5 py-3 font-semibold text-slate-700 transition hover:text-sky-700">
                  Documentation <BookOpen className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <AppMockup />
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="What it is"
            title="Digital radio over the internet"
            text="PRIVOX PTT gives teams a press-to-talk voice workflow across web access, Android, and future PoC devices."
          />
          <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {['User groups', 'Dispatcher mode', 'Administration', 'WebRTC audio', 'Secure authentication', 'Device-ready roadmap'].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <CheckCircle2 className="h-5 w-5 text-sky-600" />
                <p className="mt-3 font-semibold text-slate-900">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Who it serves" title="Teams that need fast operational voice" />
          <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {audience.map(([title, Icon]) => (
              <div key={title as string} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <Icon className="h-6 w-6 text-sky-600" />
                <p className="mt-4 font-semibold text-slate-900">{title as string}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="How it works" title="One server, roles, and voice channels" />
          <div className="mx-auto mt-12 grid max-w-6xl gap-4 lg:grid-cols-4">
            {[
              ['User / Android / PoC device', Smartphone],
              ['PRIVOX PTT Server', Router],
              ['Groups / dispatcher / admin', Users],
              ['Other users', Radio],
            ].map(([title, Icon], index) => (
              <div key={title as string} className="relative rounded-lg border border-slate-200 bg-slate-50 p-6">
                <Icon className="h-7 w-7 text-sky-600" />
                <p className="mt-4 font-semibold text-slate-900">{title as string}</p>
                {index < 3 && <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-slate-300 lg:block" />}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Capabilities" title="Core pieces for a production PTT platform" />
          <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(([title, Icon]) => (
              <div key={title as string} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <Icon className="h-6 w-6 text-sky-600" />
                <p className="mt-3 font-semibold text-slate-900">{title as string}</p>
              </div>
            ))}
          </div>
        </section>

        <PlatformsSection />
        <HelpSection />
      </main>
    </PublicLayout>
  );
}

function PlatformsSection() {
  return (
    <section className="bg-white px-4 py-20 sm:px-6 lg:px-8">
      <SectionHeader eyebrow="Platforms" title="Web today, mobile and hardware next" />
      <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {platforms.map(({ title, status, icon: Icon, tone }) => (
          <div key={title} className={clsx('rounded-lg border p-5', tone)}>
            <Icon className="h-7 w-7" />
            <h3 className="mt-4 text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm">{status}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HelpSection() {
  return (
    <section className="bg-slate-950 px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-300">Docs and help</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">Launch, support, and operating materials</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['/docs', 'Docs', BookOpen],
            ['/faq', 'FAQ', FileQuestion],
            ['/support', 'Support', MessageCircle],
          ].map(([to, label, Icon]) => (
            <Link key={to as string} to={to as string} className="rounded-lg border border-white/10 bg-white/5 p-5 transition hover:bg-white/10">
              <Icon className="h-6 w-6 text-sky-300" />
              <p className="mt-4 font-semibold">{label as string}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DownloadPage() {
  // Сборки подписаны рабочим ключом PRIVOX — обновляются поверх предыдущих.
  // ?v= обязателен и должен расти с каждой сборкой: без него Cloudflare и
  // браузер отдадут закешированный APK со старым содержимым.
  const androidApkUrl = '/downloads/privox-ptt-android.apk?v=14';
  const t320ApkUrl = '/downloads/privox-ptt-t320.apk?v=13';
  const webAppUrl = '/app';
  // Заполняется публичной ссылкой TestFlight после первой заливки сборки
  // (Xcode → Archive → Distribute → TestFlight → Public Link). См. D23 в
  // BACKLOG_RU.md. Пока пусто — карточка ниже ведёт на веб-версию, как сейчас.
  const iosTestFlightUrl = '';

  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Download" title="PRIVOX PTT downloads" text="Use PRIVOX PTT on Android, iPhone, a computer, or a dedicated hardware radio." />
        <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
            <Smartphone className="h-8 w-8 text-emerald-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">Android APK</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-emerald-700">Signed release</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">v2.1 — opens invitation links directly, works with the screen off, rings on incoming calls.</p>
            <a href={androidApkUrl} download className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700">
              Download Android APK <Download className="h-4 w-4" />
            </a>
          </div>
          <div className="rounded-lg border border-orange-200 bg-white p-6 shadow-sm">
            <Radio className="h-8 w-8 text-orange-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">Inrico T320</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-orange-700">Hardware PTT radio</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Android-based radio with a dedicated PTT button. Runs the PRIVOX PTT app natively.</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">v2.0 — opens invitation links directly, starts on its own after power-on, stays signed in.</p>
            <a href={t320ApkUrl} download className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700">
              Download T320 APK <Download className="h-4 w-4" />
            </a>
            <Link to="/docs" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-orange-300 px-4 py-3 font-semibold text-orange-700 transition hover:bg-orange-50">
              Setup guide <BookOpen className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-lg border border-sky-200 bg-white p-6 shadow-sm">
            <BadgeCheck className="h-8 w-8 text-sky-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">iPhone</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-sky-700">
              {iosTestFlightUrl ? 'TestFlight app' : 'Use web version'}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {iosTestFlightUrl
                ? 'Rings on incoming calls even with the screen locked.'
                : 'Works fully in Safari — add it to your Home Screen below for an app-like experience.'}
            </p>
            {iosTestFlightUrl ? (
              <a href={iosTestFlightUrl} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                Install via TestFlight <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <a href={webAppUrl} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
                Open web app <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <Link to="/docs" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-200 bg-white px-4 py-3 font-semibold text-sky-700 transition hover:bg-sky-50">
              Setup guide <BookOpen className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-white p-6 shadow-sm">
            <Radio className="h-8 w-8 text-indigo-600" />
            <h2 className="mt-5 text-xl font-bold text-slate-950">PRIVOX Mini Radio</h2>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.12em] text-indigo-700">Hardware PTT radio</p>
            <Link to="/docs" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-indigo-700">
              Setup guide <BookOpen className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-slate-950">Upgrading from an earlier build? Uninstall it first</h2>
          <p className="mt-3 leading-7 text-slate-700">
            These builds are signed with the production PRIVOX key, while earlier ones were test builds. Android
            refuses to install over an app signed with a different key, so remove the old PRIVOX PTT before
            installing. You will sign in once more afterwards.
          </p>
          <p className="mt-2 leading-7 text-slate-700">
            This is a one-time step. From now on new versions install straight over the previous one and keep you
            signed in.
          </p>
        </section>

        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-sky-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Web version for iPhone and computers</h2>
          <p className="mt-3 leading-7 text-slate-600">
            If you use an iPhone, open the PRIVOX PTT web version in Safari. You can also use the same web version on a desktop or laptop computer.
          </p>
          <a href={webAppUrl} className="mt-5 inline-flex items-center gap-2 rounded-md bg-slate-950 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
            Open PRIVOX PTT web app <ArrowRight className="h-4 w-4" />
          </a>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">Add to iPhone Home Screen</p>
              <ol className="mt-2 space-y-1">
                <li>1. Open PRIVOX PTT in Safari.</li>
                <li>2. Tap the Share button.</li>
                <li>3. Choose Add to Home Screen.</li>
                <li>4. Tap Add.</li>
              </ol>
            </div>
            <div className="rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <p className="font-semibold text-slate-950">Use on a computer</p>
              <p className="mt-2">
                Open this site in Chrome, Edge, Safari, or another modern browser, sign in, allow microphone access, and use PRIVOX PTT directly from the web.
              </p>
            </div>
          </div>
        </section>
        <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Android installation steps</h2>
          <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
            <li className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">1.</span> Open this page on the Android phone and tap Download Android APK.</li>
            <li className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">2.</span> Confirm the APK download warning in Chrome or the browser.</li>
            <li className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">3.</span> Open the downloaded APK and allow installation from the browser if Android asks.</li>
            <li className="rounded-md bg-slate-50 p-4"><span className="font-semibold text-slate-950">4.</span> Install PRIVOX PTT, sign in, allow microphone and location access, and test PTT with the screen on.</li>
          </ol>
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            If PRIVOX PTT asks to update Android System WebView, tap Update, install the update from Google Play, then restart the app.
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Signed release build, distributed directly from this site. Upgrading from an earlier test build requires uninstalling it first — the signing key changed. Play Store distribution is planned later.
          </p>
        </section>
        <section className="mx-auto mt-8 grid max-w-5xl gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">Tester checklist</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
              {[
                'App launches from the phone launcher.',
                'Login works with the issued test account.',
                'Microphone and location permissions are requested.',
                'PTT transmit and receive work with the screen on.',
                'Dispatcher map shows the Android app user.',
                'Logout and login work after restarting the app.',
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">If something does not work</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
              {[
                'Close PRIVOX PTT and open it again once after the first install.',
                'Check Android app permissions for microphone and location.',
                'Update Android System WebView if the app asks for it.',
                'Use a real Android phone for final PTT/audio checks.',
                'Hard-refresh the web page or clear site data if old icons remain visible.',
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </PublicLayout>
  );
}

export function DocsPage() {
  return (
    <PublicLayout>
      <main className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Docs"
          title="PRIVOX PTT documentation"
          text="Operating notes for test teams, organization admins, dispatchers, Android testers, and web users."
        />
        <div className="mx-auto mt-10 max-w-5xl space-y-4">
          {docs.map((section, index) => (
            <details key={section.title} className="group rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-sky-700">Section {index + 1}</p>
                    <h2 className="mt-2 text-xl font-bold text-slate-950">{section.title}</h2>
                  </div>
                  <span className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 group-open:text-sky-700">
                    <span className="group-open:hidden">Open</span>
                    <span className="hidden group-open:inline">Close</span>
                  </span>
                </div>
              </summary>
              <div className="mt-4 border-t border-slate-200 pt-4">
                <p className="leading-7 text-slate-600">{section.text}</p>
                {'steps' in section && section.steps && (
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                    {section.steps.map((step, i) => (
                      <li key={step} className="flex gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {'items' in section && section.items && (
                  <ul className={`space-y-2 text-sm leading-6 text-slate-600 ${'steps' in section && section.steps ? 'mt-4 border-t border-slate-100 pt-4' : 'mt-4'}`}>
                    {section.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
        </div>
        <section className="mx-auto mt-10 max-w-6xl rounded-lg border border-sky-200 bg-sky-50 p-6">
          <h2 className="text-xl font-bold text-slate-950">Recommended first test scenario</h2>
          <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
            {[
              'Superadmin creates a new organization.',
              'Superadmin creates one admin and one dispatcher in that organization.',
              'Admin logs in and creates one group.',
              'Admin creates two users and adds them to the group.',
              'Two phones or browsers log in as users and test PTT.',
              'Dispatcher logs in, checks online users, calls, and map markers.',
              'One user is moved to another organization by superadmin.',
              'Admin adds the moved user to a group in the new organization and tests again.',
            ].map((step, index) => (
              <li key={step} className="rounded-md bg-white p-4 shadow-sm">
                <span className="font-semibold text-slate-950">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </PublicLayout>
  );
}

export function FaqPage() {
  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="FAQ" title="Frequently asked questions" />
        <div className="mx-auto mt-10 max-w-4xl space-y-4">
          {faqs.map(([question, answer], index) => (
            <details key={question} className="group rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-bold text-slate-950">{question}</h2>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500 group-open:text-sky-700">
                    <span className="group-open:hidden">Open</span>
                    <span className="hidden group-open:inline">Close</span>
                  </span>
                </div>
              </summary>
              <p className="mt-3 border-t border-slate-100 pt-3 leading-7 text-slate-600">{answer}</p>
            </details>
          ))}
        </div>
      </main>
    </PublicLayout>
  );
}

export function SupportPage() {
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  return (
    <PublicLayout>
      <main className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Support"
          title="Support and feedback"
          text="Use this page to prepare useful test reports. The contact form is local-only for now and will be connected to a delivery channel later."
        />
        <section className="mx-auto mt-10 grid max-w-6xl gap-5 md:grid-cols-3">
          {[
            ['Before reporting', ['Restart the app once after first install.', 'Check microphone and location permissions.', 'Confirm users are in the same group.', 'Update Android System WebView on older phones.']],
            ['Include in the report', ['Device model and Android version.', 'Browser or Android app version if known.', 'User role and callsign.', 'Group name and organization.', 'Whether transmit, receive, login, or map failed.']],
            ['Fast checks', ['Try web app in Chrome or Safari.', 'Try another group with two users.', 'Log out and log in again.', 'Check if dispatcher sees the user online.']],
          ].map(([title, items]) => (
            <article key={title as string} className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{title as string}</h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                {(items as string[]).map((item) => (
                  <li key={item} className="flex gap-2">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
        <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-2xl rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Prepare a support note</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This form does not send messages yet. Use it as a checklist for what should be sent to the PRIVOX test coordinator.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-slate-700">
              Name
              <input className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="Your name" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Email
              <input type="email" className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="you@example.com" />
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold text-slate-700">
            Message
            <textarea className="mt-2 min-h-36 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" placeholder="Describe your question or deployment scenario" />
          </label>
          <button className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-sky-700">
            Prepare note <ArrowRight className="h-4 w-4" />
          </button>
          {sent && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Note prepared. Delivery integration will be added later.</p>}
        </form>
      </main>
    </PublicLayout>
  );
}

export function StatusPage() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [details, setDetails] = useState<string>('Checking API...');

  useEffect(() => {
    fetch('/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setStatus(data?.status === 'ok' ? 'ok' : 'error');
        setDetails(data?.status === 'ok' ? 'Service is responding normally.' : 'Service returned an unexpected response.');
      })
      .catch(() => {
        setStatus('error');
        setDetails('Could not reach the public healthcheck.');
      });
  }, []);

  return (
    <PublicLayout>
      <main className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="Status" title="System status" text="This public page shows only high-level availability, without internal secrets or infrastructure details." />
        <div className="mx-auto mt-10 max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className={clsx('flex h-12 w-12 items-center justify-center rounded-full', status === 'ok' ? 'bg-emerald-50 text-emerald-700' : status === 'error' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700')}>
              <Activity className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-xl font-bold text-slate-950">
                {status === 'ok' ? 'Operational' : status === 'error' ? 'Needs attention' : 'Checking'}
              </h2>
              <p className="mt-1 text-slate-600">{details}</p>
            </div>
          </div>
        </div>
      </main>
    </PublicLayout>
  );
}
