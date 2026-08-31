'use strict'

const dns = require('node:dns')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const tls = require('node:tls')

const blockedHosts = ['fastdl.mongodb.org', 'downloads.mongodb.com']
const logPath = process.env.DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG

function normalizedHost(host) {
  return typeof host === 'string'
    ? host
        .toLowerCase()
        .replace(/\.$/, '')
        .replace(/^\[|\]$/g, '')
    : ''
}

function rejectBlockedHost(host, operation) {
  const normalized = normalizedHost(host)
  const blocked = blockedHosts.some(
    (candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`)
  )
  if (!blocked) return
  if (logPath) {
    fs.appendFileSync(logPath, `${JSON.stringify({ host: normalized, operation })}\n`, {
      mode: 0o600,
    })
  }
  const error = new Error(`Blocked MongoDB binary-download request to ${normalized}`)
  error.code = 'ERR_MONGODB_BINARY_DOWNLOAD_BLOCKED'
  throw error
}

function hostFromRequest(input) {
  if (input instanceof URL) return input.hostname
  if (typeof input === 'string') {
    try {
      return new URL(input).hostname
    } catch {
      return input
    }
  }
  return input?.hostname ?? input?.host
}

const originalLookup = dns.lookup
dns.lookup = function guardedLookup(hostname, ...args) {
  rejectBlockedHost(hostname, 'dns.lookup')
  return originalLookup.call(this, hostname, ...args)
}

function guardSocket(module, method) {
  const original = module[method]
  module[method] = function guardedSocket(...args) {
    const options = args[0]
    const host =
      typeof options === 'object' && options !== null
        ? (options.host ?? options.hostname)
        : typeof args[1] === 'string'
          ? args[1]
          : undefined
    rejectBlockedHost(host, `${module === tls ? 'tls' : 'net'}.${method}`)
    return original.apply(this, args)
  }
}

guardSocket(net, 'connect')
guardSocket(net, 'createConnection')
guardSocket(tls, 'connect')

function guardRequest(module, method) {
  const original = module[method]
  module[method] = function guardedRequest(input, ...args) {
    rejectBlockedHost(
      hostFromRequest(input),
      `${module === https ? 'https' : 'http'}.${method}`
    )
    return original.call(this, input, ...args)
  }
}

guardRequest(http, 'request')
guardRequest(http, 'get')
guardRequest(https, 'request')
guardRequest(https, 'get')

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch
  globalThis.fetch = function guardedFetch(input, ...args) {
    rejectBlockedHost(hostFromRequest(input), 'fetch')
    return originalFetch.call(this, input, ...args)
  }
}
