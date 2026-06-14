#pragma once

#include <QByteArray>
#include <QString>

namespace qtpanel {

// Crypto for the Milestone XProtect mobile protocol, ported from the SDK's
// Lib/security/{DiffieHellman,AES}.js. Self-contained: a fixed-width big
// integer for the 1024-bit DH modexp, and Windows CNG (BCrypt) for AES-256-CBC.
//
// Handshake: createPublicKey() → send to server; setServerPublicKey(reply);
// then encodeString() encrypts the username and password for LogIn. Byte
// ordering matches the JS exactly (little-endian on the wire).
class XpCrypto {
public:
    XpCrypto();

    // Base64 client public key for the Connect command.
    QString createPublicKey();
    // Feed the server's base64 public key from the Connect response.
    void setServerPublicKey(const QString& base64);
    // AES-encrypt a string with the DH-derived key/IV; base64 ciphertext.
    QString encodeString(const QString& plain) const;

    bool ready() const { return m_haveShared; }

private:
    void deriveShared();

    QByteArray m_randExponentBE; // client secret exponent (big-endian bytes)
    QByteArray m_serverKeyLE;    // server public key (little-endian, as sent)
    QByteArray m_sharedLE;       // shared secret, little-endian bytes
    bool m_haveShared = false;
};

} // namespace qtpanel
