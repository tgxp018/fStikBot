// Preflight checks — verify env + connectivity before the bot starts
// accepting updates. Fast-fail with a clear message instead of starting
// a half-broken bot that shows up as PM2-alive but mysteriously silent.
//
// Each check returns { ok, name, detail } so the caller can decide
// whether to abort or proceed (some checks are advisory).

const defaultLog = require('../utils/logger').scope('preflight')

const requireBotToken = () => {
  const token = process.env.BOT_TOKEN
  if (!token) {
    return { ok: false, name: 'BOT_TOKEN', detail: 'env var is empty or unset' }
  }
  // Format: <bot_id>:<35-char alphanumeric+_-> — bot id is numeric.
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return { ok: false, name: 'BOT_TOKEN', detail: 'malformed (expected `<digits>:<35+ chars>`)' }
  }
  return { ok: true, name: 'BOT_TOKEN' }
}

const requireMongoUri = () => {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    return { ok: false, name: 'MONGODB_URI', detail: 'env var is empty or unset' }
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    return { ok: false, name: 'MONGODB_URI', detail: 'must start with mongodb:// or mongodb+srv://' }
  }
  return { ok: true, name: 'MONGODB_URI' }
}

// Wait for a Mongoose connection's first `open` event with a timeout.
// Without this, a misconfigured MONGODB_URI leaves the bot hanging
// indefinitely with no progress past "Connecting…".
const waitForMongo = (connection, timeoutMs = 60_000) => new Promise((resolve) => {
  if (connection.readyState === 1) {
    return resolve({ ok: true, name: 'mongo' })
  }
  const timer = setTimeout(() => {
    connection.removeListener('open', onOpen)
    resolve({ ok: false, name: 'mongo', detail: `did not open within ${timeoutMs}ms — check MONGODB_URI and that the cluster is reachable` })
  }, timeoutMs)
  const onOpen = () => {
    clearTimeout(timer)
    resolve({ ok: true, name: 'mongo' })
  }
  connection.once('open', onOpen)
})

// Verify the bot token actually works by hitting Telegram getMe.
// 401 → bad token, network errors → infrastructure issue. Both should
// surface immediately, not 30 seconds into a polling loop.
const pingTelegram = async (bot) => {
  try {
    const me = await bot.telegram.getMe()
    return { ok: true, name: 'telegram', detail: `@${me.username} (id=${me.id})` }
  } catch (err) {
    return {
      ok: false,
      name: 'telegram',
      detail: err?.description || err?.message || String(err)
    }
  }
}

// Run all checks; abort process if any required check fails.
const runPreflight = async ({ bot, dbConnection, log = defaultLog }) => {
  const checks = []

  // Required env validations — synchronous, run first so we don't spend
  // 30s waiting for Mongo only to fail on a missing token afterwards.
  checks.push(requireBotToken())
  checks.push(requireMongoUri())

  // Async connectivity probes only run if env passes.
  if (checks.every((c) => c.ok)) {
    const [mongo, telegram] = await Promise.all([
      waitForMongo(dbConnection),
      pingTelegram(bot)
    ])
    checks.push(mongo, telegram)
  }

  for (const check of checks) {
    if (check.ok) {
      log.info(`✓ ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
    } else {
      log.error(`✗ ${check.name} — ${check.detail}`)
    }
  }

  const failed = checks.filter((c) => !c.ok)
  if (failed.length > 0) {
    log.error(`${failed.length} check(s) failed — aborting startup`)
    process.exit(1)
  }
}

module.exports = {
  runPreflight,
  requireBotToken,
  requireMongoUri,
  waitForMongo,
  pingTelegram
}
