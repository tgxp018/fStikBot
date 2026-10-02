// Broadcast creation flow — plain `telegraf/scenes/base` instances, matching
// the rest of the project's scene style (pack-new, packRename, donate, …).
// Draft state lives on `ctx.session.scene` and is reset on first scene entry.

const Scene = require('telegraf/scenes/base')
const Markup = require('telegraf/markup')
const moment = require('moment')

const broadcast = require('../broadcast')
const capture = require('../broadcast/capture')
const escapeHTML = require('../utils/html-escape')
const log = require('../utils/logger').scope('broadcast:wizard')

const NAME_MAX_LEN = 200

// ───────────────────────────────────────────────────────────────────────
// Shared helpers
// ───────────────────────────────────────────────────────────────────────
const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.callbackButton('✖️ 取消', 'broadcast:new:cancel')]
])

const audienceKeyboard = () => Markup.inlineKeyboard([
  ...broadcast.audiences.list().map(({ key, label }) => (
    [Markup.callbackButton(label, `broadcast:new:audience:${key}`)]
  )),
  [Markup.callbackButton('✖️ 取消', 'broadcast:new:cancel')]
])

const confirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.callbackButton('🚀 发布', 'broadcast:new:publish'),
    Markup.callbackButton('✖️ 取消', 'broadcast:new:cancel')
  ]
])

// Telegram message envelope keys that are NEVER the "content" type. Listing
// them lets us log the actually-interesting top-level keys when we can't
// detect a supported payload type.
const MESSAGE_META_KEYS = new Set([
  'message_id', 'from', 'sender_chat', 'date', 'chat', 'forward_from',
  'forward_from_chat', 'forward_from_message_id', 'forward_signature',
  'forward_sender_name', 'forward_date', 'is_automatic_forward', 'forward_origin',
  'reply_to_message', 'external_reply', 'quote', 'via_bot', 'edit_date',
  'has_protected_content', 'media_group_id', 'author_signature', 'entities',
  'caption_entities', 'caption', 'reply_markup', 'has_media_spoiler',
  'is_topic_message', 'message_thread_id', 'link_preview_options',
  'effect_id', 'show_caption_above_media', 'business_connection_id'
])

// Thin wrapper around broadcast/capture.captureMessage that logs unrecognised
// content keys (paid_media, story, gift, …) so we know when Bot API ships
// something we should support.
const captureMessage = (message) => {
  const captured = capture.captureMessage(message)
  if (!captured) {
    const novelKeys = Object.keys(message || {}).filter((k) => !MESSAGE_META_KEYS.has(k))
    log.warn('unsupported message type — unknown content keys:', novelKeys.join(', ') || '(none)')
  }
  return captured
}

const exitScene = async (ctx, message) => {
  ctx.session.scene = {}
  if (message) await ctx.replyWithHTML(message).catch(() => {})
  return ctx.scene.leave()
}

// ───────────────────────────────────────────────────────────────────────
// Scene: name
// ───────────────────────────────────────────────────────────────────────
const broadcastNewName = new Scene('broadcastNewName')

broadcastNewName.enter(async (ctx) => {
  ctx.session.scene = {}
  await ctx.replyWithHTML(
    '📣 <b>新建广播</b>\n\n' +
    `请输入本次广播的内部名称（≤${NAME_MAX_LEN} 个字符；用户不会看到）。`,
    { reply_markup: cancelKeyboard }
  )
})

broadcastNewName.on('text', async (ctx) => {
  const name = (ctx.message.text || '').trim()
  if (!name) {
    return ctx.replyWithHTML('请发送一个文本名称。', { reply_markup: cancelKeyboard })
  }
  ctx.session.scene.name = name.slice(0, NAME_MAX_LEN)
  return ctx.scene.enter('broadcastNewMessage')
})

broadcastNewName.action('broadcast:new:cancel', (ctx) => exitScene(ctx, '✖️ 已取消。'))

// ───────────────────────────────────────────────────────────────────────
// Scene: message
// ───────────────────────────────────────────────────────────────────────
const broadcastNewMessage = new Scene('broadcastNewMessage')

broadcastNewMessage.enter(async (ctx) => {
  await ctx.replyWithHTML(
    '✅ 名称已保存。\n\n' +
    '现在发送要广播的内容——与用户实际收到的完全一致。\n' +
    '<i>支持任何消息类型。内联按钮（URL、复制文本、WebApp、彩色——全部保留）。</i>',
    { reply_markup: cancelKeyboard }
  )
})

broadcastNewMessage.on('message', async (ctx) => {
  const captured = captureMessage(ctx.message)
  if (!captured) {
    return ctx.replyWithHTML(
      '❌ 不支持的消息类型——请发送常规文本/图片/视频/文件等。',
      { reply_markup: cancelKeyboard }
    )
  }
  ctx.session.scene.message = captured
  return ctx.scene.enter('broadcastNewDate')
})

broadcastNewMessage.action('broadcast:new:cancel', (ctx) => exitScene(ctx, '✖️ 已取消。'))

// ───────────────────────────────────────────────────────────────────────
// Scene: date
// ───────────────────────────────────────────────────────────────────────
const broadcastNewDate = new Scene('broadcastNewDate')

broadcastNewDate.enter(async (ctx) => {
  await ctx.replyWithHTML(
    '✅ 内容已捕获。\n\n' +
    '什么时候发送？\n' +
    '• 发送 <code>now</code> 立即推送\n' +
    '• 或发送 <code>DD.MM HH:mm</code> 格式的日期（服务器时区）',
    { reply_markup: cancelKeyboard }
  )
})

broadcastNewDate.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim()
  let scheduledAt

  if (text.toLowerCase() === 'now') {
    scheduledAt = new Date()
  } else {
    const m = moment(text, 'DD.MM HH:mm', true)
    if (!m.isValid()) {
      return ctx.replyWithHTML(
        '❌ 日期无效——请使用 <code>DD.MM HH:mm</code> 或 <code>now</code>。',
        { reply_markup: cancelKeyboard }
      )
    }
    // Operator picks "12.01 09:00" in late December → treat as next year.
    if (m.isBefore(moment())) m.add(1, 'year')
    scheduledAt = m.toDate()
  }

  ctx.session.scene.scheduledAt = scheduledAt
  return ctx.scene.enter('broadcastNewAudience')
})

broadcastNewDate.action('broadcast:new:cancel', (ctx) => exitScene(ctx, '✖️ 已取消。'))

// ───────────────────────────────────────────────────────────────────────
// Scene: audience
// ───────────────────────────────────────────────────────────────────────
const broadcastNewAudience = new Scene('broadcastNewAudience')

broadcastNewAudience.enter(async (ctx) => {
  const { scheduledAt } = ctx.session.scene
  await ctx.replyWithHTML(
    `📅 计划发送时间：<code>${moment(scheduledAt).format('DD MMM YYYY HH:mm')}</code>\n\n` +
    '选择受众：',
    { reply_markup: audienceKeyboard() }
  )
})

broadcastNewAudience.action(/^broadcast:new:audience:(.+)$/, async (ctx) => {
  const key = ctx.match[1]
  const audience = broadcast.audiences.get(key)
  if (!audience) {
    return ctx.answerCbQuery('未知受众', true).catch(() => {})
  }
  await ctx.answerCbQuery('统计中…').catch(() => {})

  // Count is cached for 5 min in broadcast/audiences.js; the first pick may
  // still take several seconds on big collections. If it times out (mongo
  // maxTimeMS), proceed with null — materialization at dispatch time
  // computes the real total, and the wizard makes it clear the figure is
  // unknown.
  let count = null
  try {
    count = await audience.count()
  } catch (err) {
    log.warn(`audience count failed (${key}): ${err.message}`)
    await ctx.replyWithHTML(
      '⚠️ 当前无法统计受众（数据库繁忙或查询超时）。\n' +
      '你仍然可以发布——实际数量将在发送时计算。'
    ).catch(() => {})
  }

  ctx.session.scene.audience = key
  ctx.session.scene.audienceCount = count
  ctx.session.scene.audienceLabel = audience.label
  return ctx.scene.enter('broadcastNewConfirm')
})

broadcastNewAudience.action('broadcast:new:cancel', (ctx) => exitScene(ctx, '✖️ 已取消。'))

// Fallback for stray text while waiting for the audience pick.
broadcastNewAudience.on('message', async (ctx) => {
  await ctx.replyWithHTML('请使用上方按钮选择受众。', {
    reply_markup: audienceKeyboard()
  })
})

// ───────────────────────────────────────────────────────────────────────
// Scene: confirm
// ───────────────────────────────────────────────────────────────────────
const broadcastNewConfirm = new Scene('broadcastNewConfirm')

broadcastNewConfirm.enter(async (ctx) => {
  const { name, message, scheduledAt, audienceLabel, audienceCount } = ctx.session.scene

  // Render the post first so the operator visually confirms what users will
  // actually receive (media, buttons, link previews — all 1:1 with dispatch).
  try {
    await broadcast.renderPreview(ctx.telegram, ctx.chat.id, message)
  } catch (err) {
    log.error('confirm preview failed:', err.message)
    await ctx.replyWithHTML(
      `⚠️ 预览失败：<code>${escapeHTML(err.message || '未知')}</code>\n` +
      '你仍然可以发布，但请确认捕获的内容完整。'
    )
  }

  const audienceLine = audienceCount === null || audienceCount === undefined
    ? `<b>Audience:</b> ${escapeHTML(audienceLabel)} — <i>数量暂不可用，将在发送时计算</i>`
    : `<b>Audience:</b> ${escapeHTML(audienceLabel)} — <b>${audienceCount.toLocaleString()}</b> 名用户`

  const lines = [
    '☝️ <i>上方为预览——用户将收到的内容。</i>',
    '',
    '<b>📋 确认广播</b>',
    `<b>名称：</b> ${escapeHTML(name)}`,
    audienceLine,
    `<b>计划发送：</b> <code>${moment(scheduledAt).format('DD MMM YYYY HH:mm')}</code>`,
    '',
    audienceCount === 0
      ? '⚠️ <i>没有用户匹配该受众。</i>'
      : '准备发布？'
  ]

  await ctx.replyWithHTML(lines.join('\n'), { reply_markup: confirmKeyboard })
})

broadcastNewConfirm.action('broadcast:new:publish', async (ctx) => {
  const draft = ctx.session.scene
  if (!draft || !draft.name || !draft.message || !draft.scheduledAt || !draft.audience) {
    await ctx.answerCbQuery('草稿不完整', true).catch(() => {})
    return exitScene(ctx)
  }
  // Take the draft synchronously, before the first await: two quick taps run
  // as concurrent updates sharing the same in-memory session object, and both
  // used to read the intact draft and create two campaigns.
  ctx.session.scene = {}
  await ctx.answerCbQuery().catch(() => {})

  try {
    const doc = await ctx.db.Broadcast.create({
      name: draft.name,
      message: draft.message,
      audience: {
        type: draft.audience,
        snapshotCount: draft.audienceCount
      },
      scheduledAt: draft.scheduledAt,
      status: broadcast.STATUS.QUEUED,
      createdBy: ctx.session.userInfo && ctx.session.userInfo._id
    })

    await ctx.replyWithHTML(
      `✅ 广播 <b>${escapeHTML(draft.name)}</b> 已排队。\n` +
      `<i>ID：</i> <code>${doc._id}</code>`,
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.callbackButton('📊 查看状态', `admin:messaging:status:${doc._id}`)],
          [Markup.callbackButton('📣 广播', 'admin:messaging')]
        ])
      }
    )
  } catch (err) {
    log.error('failed to persist broadcast:', err.stack || err.message)
    await ctx.replyWithHTML('❌ 保存广播失败，请查看日志。').catch(() => {})
  }

  return exitScene(ctx)
})

broadcastNewConfirm.action('broadcast:new:cancel', (ctx) => exitScene(ctx, '✖️ 已取消。'))

module.exports = [
  broadcastNewName,
  broadcastNewMessage,
  broadcastNewDate,
  broadcastNewAudience,
  broadcastNewConfirm
]
