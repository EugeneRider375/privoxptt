import Foundation

/// Отчёт "ответил/отклонил" НЕ дожидаясь запуска WebView — иначе кнопка на
/// нативном экране звонка тормозила бы на секунды. Зеркало Android
/// CallResponseReporter.java: та же полезная нагрузка, тот же responseUrl
/// из push (POST /api/calls/respond, см. server/src/routes/calls.ts).
enum CallResponseReporter {
    static func report(responseUrl: String, callId: String, responseToken: String, status: String) {
        guard !responseUrl.isEmpty, !callId.isEmpty, !responseToken.isEmpty,
              let url = URL(string: responseUrl) else { return }

        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "callId": callId,
            "responseToken": responseToken,
            "status": status,
        ])

        // Сервер и так закроет звонок по таймауту, если ответ не дойдёт —
        // поэтому результат запроса не важен, разбираться с ошибкой незачем.
        URLSession.shared.dataTask(with: request).resume()
    }
}
