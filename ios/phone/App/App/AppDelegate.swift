import UIKit
import Capacitor
import PushKit
import CallKit
import AVFoundation
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    private var voipRegistry: PKPushRegistry!
    private var callProvider: CXProvider!
    // Обратный канал: PrivoxPushPlugin.endCall() из JS запрашивает через него
    // завершение звонка в CallKit — иначе кнопка HANG UP внутри приложения
    // гасит только наш WebRTC-разговор, а системный экран звонка (зелёная
    // "трубка" в статус-баре) остаётся висеть, будто разговор продолжается.
    let callController = CXCallController()
    // Не отчитавшиеся звонки: CXEndCallAction прилетает и при отклонении
    // непринятого звонка, и при завершении уже отвеченного — по этому
    // множеству различаем, что именно произошло. Также отвечает на вопрос
    // "а был ли этот звонок вообще в CallKit" — если приложение было
    // на переднем плане, звонок мог прийти обычным сокетом (call-connected),
    // минуя VoIP-push и reportNewIncomingCall целиком.
    private var answeredCallUUIDs = Set<UUID>()

    func isKnownToCallKit(_ uuid: UUID) -> Bool {
        answeredCallUUIDs.contains(uuid)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("[Privox] didFinishLaunchingWithOptions")
        setupVoipPush()
        setupCallKit()
        setupLocalNotifications()
        return true
    }

    // Пропущенный звонок на iOS (D27 2/4) сделан БЕЗ отдельного APNs-канала:
    // как только приходит VoIP-push, планируем локальное уведомление на 45с
    // вперёд (тот же CALL_TIMEOUT_MS, что и на сервере calls.ts) и отменяем
    // его, если за это время ответили или отклонили. Не требует ни нового
    // токена, ни серверной отправки — надёжнее (не зависит от повторной
    // доставки push) и намного проще полноценного alert-канала, который
    // всё равно понадобится отдельно для сообщений.
    private func setupLocalNotifications() {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            print("[Privox] Notification permission granted=\(granted), error=\(String(describing: error))")
        }
    }

    private func setupVoipPush() {
        voipRegistry = PKPushRegistry(queue: .main)
        voipRegistry.delegate = self
        voipRegistry.desiredPushTypes = [.voIP]
        print("[Privox] PKPushRegistry configured, desiredPushTypes=[.voIP]")
    }

    private func setupCallKit() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        callProvider = CXProvider(configuration: configuration)
        callProvider.setDelegate(self, queue: nil)
        print("[Privox] CXProvider configured")
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// MARK: - PushKit (VoIP push)

extension AppDelegate: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        PendingCallStore.setVoipToken(token)
        print("[Privox] VoIP token received: \(token.prefix(12))... (\(token.count) hex chars)")
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        PendingCallStore.setVoipToken(nil)
        print("[Privox] VoIP token invalidated")
    }

    // ⚠️ Начиная с iOS 13, каждый VoIP-push ОБЯЗАН немедленно закончиться
    // reportNewIncomingCall — иначе система сначала придержит доставку, а
    // затем перестанет будить приложение вовсе. Отчитываемся всегда, даже
    // если сам вызов уже неактуален (сервер и так закроет его по таймауту).
    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else { completion(); return }
        print("[Privox] Incoming VoIP push received: \(payload.dictionaryPayload)")

        let data = payload.dictionaryPayload
        let callId = string(data, "callId") ?? UUID().uuidString
        let fromUserId = string(data, "fromUserId") ?? ""
        let fromCallsign = string(data, "fromCallsign") ?? ""
        let fromDisplayName = string(data, "fromDisplayName") ?? ""
        let groupId = string(data, "groupId") ?? ""
        let groupName = string(data, "groupName") ?? ""
        let responseUrl = string(data, "responseUrl") ?? ""
        let responseToken = string(data, "responseToken") ?? ""
        let kind = string(data, "kind") ?? "user"

        PendingCallStore.save(
            callId: callId, fromUserId: fromUserId, fromCallsign: fromCallsign, fromDisplayName: fromDisplayName,
            groupId: groupId, groupName: groupName, responseUrl: responseUrl,
            responseToken: responseToken, kind: kind
        )

        let uuid = UUID(uuidString: callId) ?? UUID()
        let update = CXCallUpdate()
        let handleValue = fromCallsign.isEmpty ? "PRIVOX PTT" : fromCallsign
        update.remoteHandle = CXHandle(type: .generic, value: handleValue)
        update.localizedCallerName = fromDisplayName.isEmpty ? fromCallsign : fromDisplayName
        update.hasVideo = false

        callProvider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error { print("[Privox] reportNewIncomingCall FAILED: \(error)") }
            else { print("[Privox] reportNewIncomingCall OK, uuid=\(uuid)") }
            completion()
        }

        scheduleMissedCallNotification(
            callId: callId, fromCallsign: fromCallsign, fromDisplayName: fromDisplayName,
            groupName: groupName, kind: kind
        )
    }

    private func string(_ data: [AnyHashable: Any], _ key: String) -> String? {
        data[key] as? String
    }
}

// MARK: - Пропущенный звонок (локальное уведомление, без APNs)

extension AppDelegate {
    private static let missedCallTimeoutSeconds: TimeInterval = 45 // = CALL_TIMEOUT_MS на сервере (calls.ts)

    private func missedCallNotificationId(_ callId: String) -> String {
        "privox-missed-call-\(callId)"
    }

    private func scheduleMissedCallNotification(
        callId: String, fromCallsign: String, fromDisplayName: String, groupName: String, kind: String
    ) {
        let content = UNMutableNotificationContent()
        content.title = kind == "group" ? "Missed group call" : "Missed call"
        let caller = fromCallsign.isEmpty ? "PRIVOX PTT" : fromCallsign
        content.body = groupName.isEmpty ? caller : "\(caller) · \(groupName)"
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: Self.missedCallTimeoutSeconds, repeats: false)
        let request = UNNotificationRequest(
            identifier: missedCallNotificationId(callId), content: content, trigger: trigger
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error { print("[Privox] Failed to schedule missed-call notification: \(error)") }
        }
    }

    // Ответили или отклонили ДО истечения 45с — уведомление больше не нужно.
    func cancelMissedCallNotification(callId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: [missedCallNotificationId(callId)]
        )
    }
}

// MARK: - Показ уведомлений, когда приложение на переднем плане

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }
}

// MARK: - CallKit (экран входящего звонка, ответ/отклонение)

extension AppDelegate: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        answeredCallUUIDs.removeAll()
    }

    // ⚠️ Без этой пары CallKit держит AVAudioSession в своём собственном,
    // "нейтральном" режиме — звонок визуально соединяется (сигналинг,
    // ICE/DTLS в WebView отрабатывают штатно), WKWebView даже получает трек
    // с микрофона, но реальные сэмплы в него не пишутся: категория сессии не
    // выставлена на запись. Обнаружено 25.08.2026 живым тестом: Android
    // звонит на iPhone — iPhone слышит собеседника, но сам не передаёт ни
    // звука (проверялась только эта комбинация ролей: caller никогда не идёт
    // через CXProvider вообще, поэтому у него проблемы не было). didActivate
    // — единственное место, где приложению разрешено сконфигурировать и
    // включить сессию под свои нужды (запись+воспроизведение).
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("[Privox] CXProvider didActivate audioSession")
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
            try audioSession.setActive(true)
        } catch {
            print("[Privox] Failed to configure/activate audio session: \(error)")
        }
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("[Privox] CXProvider didDeactivate audioSession")
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("[Privox] CXAnswerCallAction, uuid=\(action.callUUID)")
        answeredCallUUIDs.insert(action.callUUID)
        cancelMissedCallNotification(callId: action.callUUID.uuidString.lowercased())
        reportPendingStatus("answered")
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let wasAnswered = answeredCallUUIDs.remove(action.callUUID) != nil
        print("[Privox] CXEndCallAction, uuid=\(action.callUUID), wasAnswered=\(wasAnswered)")
        cancelMissedCallNotification(callId: action.callUUID.uuidString.lowercased())
        if !wasAnswered {
            // Отклонили непринятый звонок — сообщаем об этом сразу, не
            // дожидаясь запуска WebView (см. CallResponseReporter).
            reportPendingStatus("declined")
        } else {
            // Уже отвеченный разговор завершили с нативного экрана CallKit,
            // а не кнопкой HANG UP внутри приложения — WebView сам об этом не
            // узнает (нет подписки на системные события звонка), поэтому
            // уведомляем через NotificationCenter → PrivoxPushPlugin
            // передаёт это в JS, чтобы тот закрыл ActiveCallScreen и сообщил
            // серверу call-hangup (иначе собеседник останется "на линии").
            // .uuidString отдаёт заглавные буквы, а callId везде в JS/на
            // сервере — строчный UUID от Node randomUUID(); без lowercased()
            // сравнение строк на стороне WebView никогда бы не совпало.
            print("[Privox] Posting privoxCallEndedNatively for \(action.callUUID.uuidString.lowercased())")
            NotificationCenter.default.post(
                name: .privoxCallEndedNatively, object: nil,
                userInfo: ["callId": action.callUUID.uuidString.lowercased()]
            )
        }
        action.fulfill()
    }

    private func reportPendingStatus(_ status: String) {
        guard let pending = PendingCallStore.consume() else { return }
        // consume() уже вычистил хранилище — кладём обратно с новым статусом,
        // чтобы PrivoxPushPlugin.consumePendingCall() на стороне WebView всё
        // ещё нашёл эти данные, когда приложение откроется.
        PendingCallStore.save(
            callId: pending.callId, fromUserId: pending.fromUserId, fromCallsign: pending.fromCallsign,
            fromDisplayName: pending.fromDisplayName, groupId: pending.groupId,
            groupName: pending.groupName, responseUrl: pending.responseUrl,
            responseToken: pending.responseToken, kind: pending.kind
        )
        PendingCallStore.setResponseStatus(status)
        CallResponseReporter.report(
            responseUrl: pending.responseUrl, callId: pending.callId,
            responseToken: pending.responseToken, status: status
        )
    }
}
