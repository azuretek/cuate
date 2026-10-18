import Foundation
import Security

public struct SigningIdentity: Codable, Sendable, Equatable {
    public let name: String
    public let team: String?

    public init(name: String, team: String?) {
        self.name = name
        self.team = team
    }

    public var display: String {
        if let team, !team.isEmpty { return "Signed by " + name + " (" + team + ")" }
        return "Signed by " + name
    }

    public static let unknown = SigningIdentity(name: "an unsigned build", team: nil)

    public static func current() -> SigningIdentity {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return .unknown }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return .unknown }
        var information: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(staticCode, flags, &information) == errSecSuccess,
              let info = information as? [String: Any] else { return .unknown }
        let team = info[kSecCodeInfoTeamIdentifier as String] as? String
        if let certificates = info[kSecCodeInfoCertificates as String] as? [SecCertificate],
           let certificate = certificates.first {
            let summary = SecCertificateCopySubjectSummary(certificate) as String? ?? ""
            if !summary.isEmpty { return SigningIdentity(name: summary, team: team) }
        }
        if let identifier = info[kSecCodeInfoIdentifier as String] as? String {
            return SigningIdentity(name: identifier, team: team)
        }
        return .unknown
    }
}
