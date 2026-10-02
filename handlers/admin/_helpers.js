// Shared admin guards / introspection. Single source of truth for the
// rights model — every command and action must funnel through here.
//
// Rights:
//   messaging — broadcast wizard
//   pack      — pack/emoji-set management (transfer, remove, bulk-delete)
//   finance   — /credit, /refund, financial ops menu, stars/outgoing CSV
//   users     — /ban, View User Info, user management menu
// Main admin (config.mainAdminId) implicitly has all rights.

const ADMIN_RIGHTS = ['messaging', 'pack', 'finance', 'users']

const isMainAdmin = (ctx) => ctx.config.mainAdminId === ctx.from?.id

// Defensive: Redis-cached session may carry old userInfo without adminRights.
const getAdminRights = (ctx) => {
  const r = ctx.session?.userInfo?.adminRights
  return Array.isArray(r) ? r : []
}

const hasRight = (ctx, right) => isMainAdmin(ctx) || getAdminRights(ctx).includes(right)

const isAnyAdmin = (ctx) => isMainAdmin(ctx) || getAdminRights(ctx).length > 0

// Reply helper that picks the right channel for the update type.
const sendDeny = async (ctx, message) => {
  if (ctx.callbackQuery) {
    return ctx.answerCbQuery(message, { show_alert: true }).catch(() => {})
  }
  return ctx.replyWithHTML(message).catch(() => {})
}

// Outsider gate: silently swallow updates from non-admins so the admin
// panel's existence isn't confirmed. Use for /admin and the panel root.
const requireAnyAdmin = (ctx, next) => {
  if (isAnyAdmin(ctx)) return next()
}

// Per-right gate: main admin OR holders of `right` pass; sub-admins who
// have *some* rights but not this one get a clear deny; outsiders stay
// silent. Use for any command that mutates state.
const requireRight = (right) => async (ctx, next) => {
  if (hasRight(ctx, right)) return next()
  if (isAnyAdmin(ctx)) {
    return sendDeny(ctx, `⛔ 该操作需要 <b>${right}</b> 管理员权限。`)
  }
}

// Main-admin-only gate (e.g. dangerous global ops). Same fidelity pattern.
const requireMainAdmin = async (ctx, next) => {
  if (isMainAdmin(ctx)) return next()
  if (isAnyAdmin(ctx)) {
    return sendDeny(ctx, '⛔ 该操作仅限主管理员使用。')
  }
}

module.exports = {
  ADMIN_RIGHTS,
  isMainAdmin,
  isAnyAdmin,
  hasRight,
  getAdminRights,
  requireAnyAdmin,
  requireRight,
  requireMainAdmin,
  sendDeny
}
