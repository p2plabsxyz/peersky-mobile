import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'bare-fs'
import sodium from 'sodium-native'
import b4a from 'b4a'

export const DEVICE_KEY_FILE = 'device-key.json'

export async function getDeviceKeys (storagePath = getDefaultIdentityStoragePath()) {
  const filePath = joinPath(storagePath, DEVICE_KEY_FILE)

  if (existsSync(filePath)) {
    const parsed = JSON.parse(b4a.toString(readFileSync(filePath), 'utf8'))
    return {
      signing: deserializeKeyPair(parsed.signing, 'signing key'),
      encryption: deserializeKeyPair(parsed.encryption, 'encryption key')
    }
  }

  const signingPublicKey = b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const signingSecretKey = b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(signingPublicKey, signingSecretKey)

  const encryptionPublicKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  const encryptionSecretKey = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_box_keypair(encryptionPublicKey, encryptionSecretKey)

  const serialized = {
    version: 1,
    createdAt: new Date().toISOString(),
    signing: serializeKeyPair({
      publicKey: signingPublicKey,
      secretKey: signingSecretKey
    }),
    encryption: serializeKeyPair({
      publicKey: encryptionPublicKey,
      secretKey: encryptionSecretKey
    })
  }

  mkdirSync(storagePath, { recursive: true })
  writeFileSync(filePath, JSON.stringify(serialized, null, 2))

  return {
    signing: deserializeKeyPair(serialized.signing, 'signing key'),
    encryption: deserializeKeyPair(serialized.encryption, 'encryption key')
  }
}

export function getEncryptionPublicKeyHex (keys) {
  return b4a.toString(keys.encryption.publicKey, 'hex')
}

export function getDefaultIdentityStoragePath () {
  const workletStoragePath = globalThis.Bare?.argv?.[0]
  if (!workletStoragePath) return '.'

  const normalized = String(workletStoragePath).replace(/[/\\]+$/, '')
  const baseName = getBaseName(normalized)

  if (baseName === 'hyper-storage') {
    return getDirName(normalized) || '.'
  }

  return normalized
}

function serializeKeyPair (keyPair) {
  return {
    publicKey: b4a.toString(keyPair.publicKey, 'hex'),
    secretKey: b4a.toString(keyPair.secretKey, 'hex')
  }
}

function deserializeKeyPair (keyPair, name) {
  if (!keyPair || typeof keyPair !== 'object') {
    throw new Error(`Invalid ${name}`)
  }

  return {
    publicKey: fromHex(keyPair.publicKey, `${name} public key`),
    secretKey: fromHex(keyPair.secretKey, `${name} secret key`)
  }
}

function fromHex (value, name) {
  if (!value || typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${name}`)
  }

  return b4a.from(value, 'hex')
}

function getBaseName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? filepath : filepath.slice(separatorIndex + 1)
}

function getDirName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? '' : filepath.slice(0, separatorIndex)
}

function joinPath (dir, name) {
  const normalized = String(dir || '.').replace(/[/\\]+$/, '')
  return `${normalized}/${name}`
}
