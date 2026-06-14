#include "XpCrypto.h"

#include <QDebug>

#include <algorithm>
#include <vector>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>

namespace qtpanel {

namespace {

// ── Minimal unsigned big integer (little-endian 32-bit limbs) ────────────────
// Just enough for fixed-prime modular exponentiation. Not constant-time; this
// is a client-side key agreement, not a server secret store.
class BigUInt {
public:
    BigUInt() = default;

    static BigUInt fromHexBE(const QString& hex) {
        BigUInt v;
        QString s = hex;
        if (s.size() % 2)
            s.prepend(QLatin1Char('0'));
        // Walk big-endian hex, build little-endian bytes.
        std::vector<uint8_t> bytesLE;
        bytesLE.reserve(s.size() / 2);
        for (int i = s.size() - 2; i >= 0; i -= 2)
            bytesLE.push_back(static_cast<uint8_t>(s.mid(i, 2).toUInt(nullptr, 16)));
        v.setBytesLE(bytesLE.data(), bytesLE.size());
        return v;
    }

    static BigUInt fromBytesLE(const uint8_t* data, size_t len) {
        BigUInt v;
        v.setBytesLE(data, len);
        return v;
    }

    static BigUInt fromU32(uint32_t x) {
        BigUInt v;
        if (x)
            v.m_limbs.push_back(x);
        return v;
    }

    bool isZero() const { return m_limbs.empty(); }

    // Big-endian, minimal-length byte serialization.
    QByteArray toBytesBE() const {
        std::vector<uint8_t> le;
        for (uint32_t limb : m_limbs) {
            le.push_back(limb & 0xFF);
            le.push_back((limb >> 8) & 0xFF);
            le.push_back((limb >> 16) & 0xFF);
            le.push_back((limb >> 24) & 0xFF);
        }
        while (!le.empty() && le.back() == 0)
            le.pop_back();
        QByteArray be(static_cast<int>(le.size()), Qt::Uninitialized);
        for (size_t i = 0; i < le.size(); ++i)
            be[static_cast<int>(le.size() - 1 - i)] = static_cast<char>(le[i]);
        return be;
    }

    static BigUInt modExp(const BigUInt& base, const BigUInt& exp, const BigUInt& mod) {
        BigUInt result = fromU32(1);
        BigUInt b = base.mod(mod);
        const int bits = exp.bitLength();
        for (int i = 0; i < bits; ++i) {
            if (exp.bit(i))
                result = result.mul(b).mod(mod);
            b = b.mul(b).mod(mod);
        }
        return result;
    }

private:
    std::vector<uint32_t> m_limbs; // little-endian, no trailing zero limbs

    void trim() {
        while (!m_limbs.empty() && m_limbs.back() == 0)
            m_limbs.pop_back();
    }

    void setBytesLE(const uint8_t* data, size_t len) {
        m_limbs.assign((len + 3) / 4, 0);
        for (size_t i = 0; i < len; ++i)
            m_limbs[i / 4] |= static_cast<uint32_t>(data[i]) << (8 * (i % 4));
        trim();
    }

    int bitLength() const {
        if (m_limbs.empty())
            return 0;
        uint32_t top = m_limbs.back();
        int bits = static_cast<int>(m_limbs.size() - 1) * 32;
        while (top) { ++bits; top >>= 1; }
        return bits;
    }

    bool bit(int i) const {
        const size_t limb = i / 32;
        if (limb >= m_limbs.size())
            return false;
        return (m_limbs[limb] >> (i % 32)) & 1u;
    }

    static int cmp(const BigUInt& a, const BigUInt& b) {
        if (a.m_limbs.size() != b.m_limbs.size())
            return a.m_limbs.size() < b.m_limbs.size() ? -1 : 1;
        for (int i = static_cast<int>(a.m_limbs.size()) - 1; i >= 0; --i) {
            if (a.m_limbs[i] != b.m_limbs[i])
                return a.m_limbs[i] < b.m_limbs[i] ? -1 : 1;
        }
        return 0;
    }

    void shiftLeftOneAndSetBit0(bool set) {
        uint32_t carry = set ? 1u : 0u;
        for (size_t i = 0; i < m_limbs.size(); ++i) {
            const uint32_t next = m_limbs[i] >> 31;
            m_limbs[i] = (m_limbs[i] << 1) | carry;
            carry = next;
        }
        if (carry)
            m_limbs.push_back(carry);
    }

    void subInPlace(const BigUInt& b) { // assumes *this >= b
        uint64_t borrow = 0;
        for (size_t i = 0; i < m_limbs.size(); ++i) {
            const uint64_t bv = i < b.m_limbs.size() ? b.m_limbs[i] : 0;
            uint64_t cur = static_cast<uint64_t>(m_limbs[i]) - bv - borrow;
            borrow = (cur >> 63) & 1;
            m_limbs[i] = static_cast<uint32_t>(cur);
        }
        trim();
    }

    BigUInt mul(const BigUInt& b) const {
        if (m_limbs.empty() || b.m_limbs.empty())
            return BigUInt();
        std::vector<uint64_t> acc(m_limbs.size() + b.m_limbs.size(), 0);
        for (size_t i = 0; i < m_limbs.size(); ++i) {
            uint64_t carry = 0;
            for (size_t j = 0; j < b.m_limbs.size(); ++j) {
                const uint64_t cur = acc[i + j]
                    + static_cast<uint64_t>(m_limbs[i]) * b.m_limbs[j] + carry;
                acc[i + j] = cur & 0xFFFFFFFFu;
                carry = cur >> 32;
            }
            acc[i + b.m_limbs.size()] += carry;
        }
        BigUInt r;
        r.m_limbs.resize(acc.size());
        for (size_t i = 0; i < acc.size(); ++i)
            r.m_limbs[i] = static_cast<uint32_t>(acc[i] & 0xFFFFFFFFu);
        r.trim();
        return r;
    }

    // Remainder via bit-by-bit long division (schoolbook).
    BigUInt mod(const BigUInt& m) const {
        if (cmp(*this, m) < 0)
            return *this;
        BigUInt r;
        for (int i = bitLength() - 1; i >= 0; --i) {
            r.shiftLeftOneAndSetBit0(bit(i));
            if (cmp(r, m) >= 0)
                r.subInPlace(m);
        }
        return r;
    }
};

// 1024-bit prime and generator from Lib/security/DiffieHellman.js.
const char kPrime1024[] =
    "F488FD584E49DBCD20B49DE49107366B336C380D451D0F7C88B31C7C5B2D8EF6"
    "F3C923C043F0A55B188D8EBB558CB85D38D334FD7C175743A31D186CDE33212C"
    "B52AFF3CE1B1294018118D7C84A70A72D686C40319C807297ACA950CD9969FAB"
    "D00A509B0246D3083D66A45D419F9C7CBD894B221926BAABA25EC355E92F78C7";

QByteArray reversed(const QByteArray& in) {
    QByteArray out(in.size(), Qt::Uninitialized);
    for (int i = 0; i < in.size(); ++i)
        out[i] = in[in.size() - 1 - i];
    return out;
}

} // namespace

XpCrypto::XpCrypto()
{
    // 160-bit random secret exponent.
    QByteArray rnd(20, Qt::Uninitialized);
    BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(rnd.data()), rnd.size(),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    m_randExponentBE = rnd;
}

QString XpCrypto::createPublicKey()
{
    const BigUInt prime = BigUInt::fromHexBE(QString::fromLatin1(kPrime1024));
    const BigUInt gen = BigUInt::fromU32(2);
    const BigUInt exp = BigUInt::fromBytesLE(
        reinterpret_cast<const uint8_t*>(reversed(m_randExponentBE).constData()),
        m_randExponentBE.size());
    const BigUInt pub = BigUInt::modExp(gen, exp, prime);

    // JS: big-endian bytes → reverse to little-endian → append 0x00 → base64.
    QByteArray le = reversed(pub.toBytesBE());
    le.append('\0');
    return QString::fromLatin1(le.toBase64());
}

void XpCrypto::setServerPublicKey(const QString& base64)
{
    m_serverKeyLE = QByteArray::fromBase64(base64.toLatin1());
    deriveShared();
}

void XpCrypto::deriveShared()
{
    if (m_serverKeyLE.isEmpty())
        return;
    const BigUInt prime = BigUInt::fromHexBE(QString::fromLatin1(kPrime1024));
    const BigUInt server = BigUInt::fromBytesLE(
        reinterpret_cast<const uint8_t*>(m_serverKeyLE.constData()), m_serverKeyLE.size());
    const BigUInt exp = BigUInt::fromBytesLE(
        reinterpret_cast<const uint8_t*>(reversed(m_randExponentBE).constData()),
        m_randExponentBE.size());
    const BigUInt shared = BigUInt::modExp(server, exp, prime);
    m_sharedLE = reversed(shared.toBytesBE()); // little-endian, LSB first
    m_haveShared = m_sharedLE.size() >= 48;
    if (!m_haveShared)
        qWarning() << "[camera] shared secret too short:" << m_sharedLE.size();
}

QString XpCrypto::encodeString(const QString& plain) const
{
    if (!m_haveShared)
        return {};
    // First 48 little-endian bytes: [0..15] = IV, [16..47] = AES-256 key.
    const QByteArray iv = m_sharedLE.left(16);
    const QByteArray key = m_sharedLE.mid(16, 32);

    QByteArray data = plain.toUtf8();
    // ISO 10126: pad to the block size with random bytes, last byte = pad count.
    const int blockSize = 16;
    int pad = blockSize - (data.size() % blockSize);
    if (pad == 0)
        pad = blockSize;
    QByteArray padding(pad, Qt::Uninitialized);
    BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(padding.data()), padding.size(),
                    BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    padding[pad - 1] = static_cast<char>(pad);
    data.append(padding);

    BCRYPT_ALG_HANDLE alg = nullptr;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_AES_ALGORITHM, nullptr, 0) < 0)
        return {};
    BCryptSetProperty(alg, BCRYPT_CHAINING_MODE,
                      reinterpret_cast<PUCHAR>(const_cast<wchar_t*>(BCRYPT_CHAIN_MODE_CBC)),
                      sizeof(BCRYPT_CHAIN_MODE_CBC), 0);

    BCRYPT_KEY_HANDLE hKey = nullptr;
    BCryptGenerateSymmetricKey(alg, &hKey, nullptr, 0,
                               reinterpret_cast<PUCHAR>(const_cast<char*>(key.constData())),
                               key.size(), 0);

    QByteArray ivCopy = iv; // CBC mutates the IV buffer in place
    QByteArray out(data.size(), Qt::Uninitialized);
    ULONG written = 0;
    const NTSTATUS rc = BCryptEncrypt(
        hKey,
        reinterpret_cast<PUCHAR>(data.data()), data.size(),
        nullptr,
        reinterpret_cast<PUCHAR>(ivCopy.data()), ivCopy.size(),
        reinterpret_cast<PUCHAR>(out.data()), out.size(), &written, 0);

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(alg, 0);
    if (rc < 0)
        return {};
    out.truncate(static_cast<int>(written));
    return QString::fromLatin1(out.toBase64());
}

} // namespace qtpanel
