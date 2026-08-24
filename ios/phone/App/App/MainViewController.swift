import Capacitor

/// Локальный (не npm) плагин нужно зарегистрировать вручную — Capacitor
/// подхватывает такие только через registerPluginInstance(), автообнаружение
/// работает лишь для пакетов, установленных через `npm install` + `cap sync`.
/// Storyboard указывает на этот класс вместо стандартного CAPBridgeViewController
/// (см. Main.storyboard, customClass).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrivoxPushPlugin())
    }
}
