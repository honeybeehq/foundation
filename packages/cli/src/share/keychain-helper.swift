import Foundation
import Security

let service = "foundation-share-native-v1"

func fail(_ status: OSStatus) -> Never {
    FileHandle.standardError.write(Data("Foundation Keychain operation failed (\(status)).\n".utf8))
    exit(status == errSecItemNotFound ? 44 : 1)
}

func readPassword(_ keychain: SecKeychain, _ account: String) {
    var length: UInt32 = 0
    var bytes: UnsafeMutableRawPointer?
    let status = service.withCString { servicePointer in
        account.withCString { accountPointer in
            SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), servicePointer, UInt32(account.utf8.count), accountPointer, &length, &bytes, nil)
        }
    }
    guard status == errSecSuccess else { fail(status) }
    defer { SecKeychainItemFreeContent(nil, bytes) }
    if let bytes {
        FileHandle.standardOutput.write(Data(bytes: bytes, count: Int(length)))
    } else if length != 0 {
        fail(errSecInternalComponent)
    }
}

func writePassword(_ keychain: SecKeychain, _ account: String, _ data: Data) {
    var item: SecKeychainItem?
    let found = service.withCString { servicePointer in
        account.withCString { accountPointer in
            SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), servicePointer, UInt32(account.utf8.count), accountPointer, nil, nil, &item)
        }
    }
    guard found == errSecSuccess || found == errSecItemNotFound else { fail(found) }
    guard data.count <= Int(UInt32.max) else { fail(errSecParam) }
    let status: OSStatus = data.withUnsafeBytes { bytes in
        guard let pointer = bytes.baseAddress else { return errSecParam }
        if let item {
            return SecKeychainItemModifyAttributesAndData(item, nil, UInt32(data.count), pointer)
        }
        return service.withCString { servicePointer in
            account.withCString { accountPointer in
                SecKeychainAddGenericPassword(keychain, UInt32(service.utf8.count), servicePointer, UInt32(account.utf8.count), accountPointer, UInt32(data.count), pointer, nil)
            }
        }
    }
    guard status == errSecSuccess else { fail(status) }
}

let arguments = CommandLine.arguments
guard (arguments.count == 3 || arguments.count == 4), ["get", "set"].contains(arguments[1]) else {
    FileHandle.standardError.write(Data("usage: keychain-helper get|set ACCOUNT [KEYCHAIN]\n".utf8))
    exit(64)
}
let interaction = SecKeychainSetUserInteractionAllowed(false)
guard interaction == errSecSuccess else { fail(interaction) }
var selected: SecKeychain?
let opened = arguments.count == 4
    ? SecKeychainOpen(arguments[3], &selected)
    : SecKeychainCopyDefault(&selected)
guard opened == errSecSuccess else { fail(opened) }
guard let keychain = selected else { fail(errSecInvalidKeychain) }
if arguments[1] == "get" {
    readPassword(keychain, arguments[2])
} else {
    do {
        let data = try FileHandle.standardInput.readToEnd() ?? Data()
        writePassword(keychain, arguments[2], data)
    } catch {
        fail(errSecIO)
    }
}
