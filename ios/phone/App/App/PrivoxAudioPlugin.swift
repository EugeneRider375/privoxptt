import Foundation
import AVFAudio
import Capacitor

/// Куда направлять звук: в громкий динамик или в тихий разговорный наушник.
/// Тот же контракт (имя плагина, методы, поля), что и Android
/// PrivoxAudioPlugin.java (D16) — web/src/utils/audioRoute.ts вызывает их
/// одинаково на обеих платформах.
///
/// Веб-часть сама этого не может: WebRTC в WKWebView сам переводит
/// AVAudioSession в .playAndRecord, как только одновременно работают
/// микрофон и воспроизведение, и уводит звук по умолчанию (обычно в
/// наушник). Никакого веб-API, чтобы это перебить, не существует — только
/// нативный AVAudioSession.overrideOutputAudioPort.
///
///   speaker  — групповой канал: рацию держат в руке или в кармане, слышно
///              должно быть всем вокруг;
///   earpiece — личный звонок один на один: подносят к уху, как телефон.
///
/// Система может сбрасывать override при каждой новой активации сессии
/// (новое WebRTC-соединение) — тот же риск, что и на Android с браузером,
/// поэтому маршрут переустанавливается по таймеру, а не один раз.
@objc(PrivoxAudioPlugin)
public class PrivoxAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrivoxAudioPlugin"
    public let jsName = "PrivoxAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMode", returnType: CAPPluginReturnPromise),
    ]

    /// Как часто перебивать сброс маршрута системой.
    private static let reassertInterval: TimeInterval = 1.5

    /// nil = режим не задан, ничего не навязываем и таймер не крутим.
    private var wantSpeaker: Bool?
    private var reassertTimer: Timer?

    @objc func setMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "auto"

        if mode == "auto" {
            wantSpeaker = nil
            DispatchQueue.main.async { self.stopReassert() }
            try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
            call.resolve(self.result(mode: "auto"))
            return
        }

        wantSpeaker = (mode == "speaker")
        applyRoute()
        DispatchQueue.main.async { self.startReassert() }
        call.resolve(result(mode: mode))
    }

    @objc func getMode(_ call: CAPPluginCall) {
        guard let wantSpeaker = wantSpeaker else {
            call.resolve(result(mode: "auto"))
            return
        }
        call.resolve(result(mode: wantSpeaker ? "speaker" : "earpiece"))
    }

    private func applyRoute() {
        guard let wantSpeaker = wantSpeaker else { return }
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(wantSpeaker ? .speaker : .none)
        } catch {
            print("[Privox] PrivoxAudioPlugin: overrideOutputAudioPort failed: \(error)")
        }
    }

    // Timer требует главный поток — Capacitor вызывает методы плагина на
    // своей bridge-очереди, не на главном (см. тот же приём в PrivoxPushPlugin).
    private func startReassert() {
        stopReassert()
        let timer = Timer.scheduledTimer(withTimeInterval: Self.reassertInterval, repeats: true) { [weak self] _ in
            self?.applyRoute()
        }
        RunLoop.main.add(timer, forMode: .common)
        reassertTimer = timer
    }

    private func stopReassert() {
        reassertTimer?.invalidate()
        reassertTimer = nil
    }

    private func isSpeakerActive() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    }

    private func result(mode: String) -> [String: Any] {
        return ["mode": mode, "speakerOn": isSpeakerActive()]
    }

    override public func load() {
        // Плагин может пережить закрытие звонка (bridge не пересоздаётся) —
        // на новую загрузку webview лучше стартовать с чистого "auto", а не
        // с состоянием, оставшимся от прошлой сессии/звонка.
        wantSpeaker = nil
    }
}
