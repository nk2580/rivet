import Foundation
import CryptoKit
import LocalAuthentication
import Security

// One request over private pipes. No tokens, passwords or keys in arguments or logs.
struct Envelope: Codable {
    let keyBlob: Data
    let publicKey: Data
    let salt: Data
    let sealedKey: Data
}
struct Request: Decodable { let action: String; let envelope: Envelope? }
struct Failure: Error { let code: String; let message: String }
let context = LAContext()
context.localizedCancelTitle = "Keep Oracle locked"
context.localizedFallbackTitle = "Use Mac Password"
context.localizedReason = "unlock your ChatGPT connection in Rivet"

func authenticate() throws {
    var availableError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availableError) else {
        throw Failure(code: "unavailable", message: "Mac authentication is unavailable. Your character sheet still works offline.")
    }
    let completion = DispatchSemaphore(value: 0)
    var accepted = false
    var failure: Error?
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: context.localizedReason) { success, error in
        accepted = success; failure = error; completion.signal()
    }
    completion.wait()
    guard accepted else {
        let code = (failure as? LAError)?.code
        if code == .userCancel || code == .appCancel || code == .systemCancel {
            throw Failure(code: "cancelled", message: "Oracle is still locked. You can try again when you’re ready.")
        }
        throw Failure(code: "authentication", message: "Your Mac could not verify you. Try again and choose Use Mac Password if needed.")
    }
}
func wrappingKey(_ key: SecureEnclave.P256.KeyAgreement.PrivateKey, _ publicKey: P256.KeyAgreement.PublicKey, _ salt: Data) throws -> SymmetricKey {
    let secret = try key.sharedSecretFromKeyAgreement(with: publicKey)
    return secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: Data("com.rivet.desktop.connection.v1".utf8), outputByteCount: 32)
}
func respond(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys) {
        FileHandle.standardOutput.write(data)
    }
}
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 65536 else { throw Failure(code: "input", message: "Invalid unlock request.") }
    let request = try JSONDecoder().decode(Request.self, from: input)
    if request.action == "status" {
        respond(["available": SecureEnclave.isAvailable && context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil), "touchID": context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)])
    } else {
        guard SecureEnclave.isAvailable else { throw Failure(code: "unavailable", message: "Secure device storage is unavailable on this Mac.") }
        guard request.action == "create" || request.action == "open" else { throw Failure(code: "input", message: "Unknown unlock request.") }
        try authenticate()
        if request.action == "create" {
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &error) else {
                throw Failure(code: "storage", message: "Could not create protected device storage.")
            }
            let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access, authenticationContext: context)
            let ephemeral = P256.KeyAgreement.PrivateKey()
            let salt = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
            let secret = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
            let seal = try AES.GCM.seal(secret, using: wrappingKey(key, ephemeral.publicKey, salt))
            let envelope = Envelope(keyBlob: key.dataRepresentation, publicKey: ephemeral.publicKey.x963Representation, salt: salt, sealedKey: seal.combined!)
            let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope))
            respond(["key": secret.base64EncodedString(), "envelope": encoded])
        } else {
            guard let envelope = request.envelope, envelope.salt.count == 32, envelope.sealedKey.count == 60, envelope.keyBlob.count <= 16384, envelope.publicKey.count == 65 else {
                throw Failure(code: "storage", message: "The saved connection protection could not be read.")
            }
            let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: envelope.keyBlob, authenticationContext: context)
            let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: envelope.publicKey)
            let secret = try AES.GCM.open(AES.GCM.SealedBox(combined: envelope.sealedKey), using: wrappingKey(key, publicKey, envelope.salt))
            guard secret.count == 32 else { throw Failure(code: "storage", message: "Invalid connection key.") }
            respond(["key": secret.base64EncodedString()])
        }
    }
} catch let failure as Failure {
    respond(["error": failure.code, "message": failure.message])
} catch {
    respond(["error": "storage", "message": "The protected connection could not be opened. Try again or reconnect ChatGPT."])
}
context.invalidate()
