import UIKit
import Capacitor
import PushKit
import CallKit

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
    // множеству различаем, что именно произошло.
    private var answeredCallUUIDs = Set<UUID>()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("[Privox] didFinishLaunchingWithOptions")
        setupVoipPush()
        setupCallKit()
        return true
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
    }

    private func string(_ data: [AnyHashable: Any], _ key: String) -> String? {
        data[key] as? String
    }
}

// MARK: - CallKit (экран входящего звонка, ответ/отклонение)

extension AppDelegate: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        answeredCallUUIDs.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("[Privox] CXAnswerCallAction, uuid=\(action.callUUID)")
        answeredCallUUIDs.insert(action.callUUID)
        reportPendingStatus("answered")
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let wasAnswered = answeredCallUUIDs.remove(action.callUUID) != nil
        print("[Privox] CXEndCallAction, uuid=\(action.callUUID), wasAnswered=\(wasAnswered)")
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
