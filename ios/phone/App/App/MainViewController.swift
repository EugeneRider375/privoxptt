import Capacitor

/// Локальный (не npm) плагин нужно зарегистрировать вручную — Capacitor
/// подхватывает такие только через registerPluginInstance(), автообнаружение
/// работает лишь для пакетов, установленных через `npm install` + `cap sync`.
/// Storyboard указывает на этот класс вместо стандартного CAPBridgeViewController
/// (см. Main.storyboard, customClass).
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        print("[Privox] MainViewController.viewDidLoad — class is instantiated")
        super.viewDidLoad()
    }

    override func capacitorDidLoad() {
        print("[Privox] MainViewController.capacitorDidLoad — registering PrivoxPushPlugin")
        bridge?.registerPluginInstance(PrivoxPushPlugin())
        bridge?.registerPluginInstance(PrivoxDeepLinkPlugin())
    }
}
