const Markup = require('telegraf/markup')
const Scene = require('telegraf/scenes/base')
const { escapeHTML } = require('../utils')

const adminPackFind = new Scene('adminPackFind')

adminPackFind.enter(async (ctx) => {
  const welcomeText = `
<b>欢迎使用管理员贴纸包管理！</b>

要管理贴纸包或自定义表情集，请发送：
• 包里的一个贴纸
• 表情集里的一个自定义表情
• 分享链接（如 https://t.me/addstickers/packname 或 https://t.me/addemoji/setname）
• 或直接发送包/表情集名称

我将帮你查看、编辑或删除该包/表情集。
  `

  const replyMarkup = Markup.inlineKeyboard([
    [Markup.callbackButton('🏠 返回管理菜单', 'admin:menu')]
  ])

  await ctx.replyWithHTML(welcomeText, {
    reply_markup: replyMarkup
  }).catch(() => {})
})

// 'custom_emoji' is not a telegraf updateSubType — a custom emoji arrives as a
// text message carrying a custom_emoji entity, so that branch never ran.
adminPackFind.on(['sticker', 'text'], async (ctx) => {
  const { sticker, text, entities } = ctx.message
  let packName

  const customEmoji = entities && entities.find((e) => e.type === 'custom_emoji')

  if (sticker) {
    packName = sticker.set_name
  } else if (customEmoji) {
    const emojiStickers = await ctx.telegram.callApi('getCustomEmojiStickers', {
      custom_emoji_ids: [customEmoji.custom_emoji_id]
    }).catch(() => null)

    packName = emojiStickers && emojiStickers[0] && emojiStickers[0].set_name
  } else if (text) {
    const urlMatch = text.match(/(?:addstickers|addemoji)\/(.+)/)
    if (urlMatch) {
      packName = urlMatch[1]
    } else {
      packName = text.trim()
    }
  }

  if (!packName) {
    return ctx.replyWithHTML('❌ 输入无效。请发送贴纸、自定义表情、贴纸包链接或贴纸包名称。')
  }

  let stickerSet
  try {
    stickerSet = await ctx.telegram.getStickerSet(packName)
  } catch (firstErr) {
    // Pack not found as a sticker set — try emoji set lookup before giving up.
    try {
      const customEmojiStickers = await ctx.telegram.getCustomEmojiStickers([packName.split('_')[0]])
      if (customEmojiStickers?.length > 0) {
        stickerSet = {
          name: packName,
          title: 'Custom Emoji Set',
          is_emoji: true,
          stickers: customEmojiStickers
        }
      }
    } catch (secondErr) {
      console.error('admin-pack: emoji set lookup failed:', secondErr.message)
    }
  }

  if (!stickerSet) {
    return ctx.replyWithHTML(`❌ 未找到贴纸包/表情集 <code>${escapeHTML(packName)}</code>，请检查名称后重试。`)
  }

  if (packName.split('_').pop() !== ctx.options.username) {
    return ctx.replyWithHTML('⚠️ 该贴纸包/表情集不是本 bot 创建的，你只能管理本 bot 创建的包/表情集。')
  }

  let info
  try {
    info = await ctx.db.StickerSet.findOne({ name: packName })
  } catch (dbErr) {
    console.error('admin-pack: DB lookup failed:', dbErr.message)
    return ctx.replyWithHTML('❌ 获取贴纸包信息时数据库出错，请稍后重试。')
  }

  ctx.session.admin = { editPack: stickerSet, info }
  await ctx.scene.enter('adminPackEdit')
})

const adminPackEdit = new Scene('adminPackEdit')

adminPackEdit.enter(async (ctx) => {
  const { editPack, info } = ctx.session.admin

  if (!editPack) {
    return ctx.scene.enter('adminPackFind')
  }

  const packOwner = await ctx.db.User.findById(info?.owner)
  const resultText = `
<b>${editPack.is_emoji ? '自定义表情集' : '贴纸包'} Details:</b>

📦 名称：<code>${escapeHTML(editPack.name)}</code>
🏷 标题：${escapeHTML(editPack.title)}
👤 所有者：<a href="tg://user?id=${packOwner?.telegram_id}">${escapeHTML(packOwner?.first_name)}</a>
🖼 ${editPack.is_emoji ? '表情' : '贴纸'}：${editPack.stickers.length}

你想对这个${editPack.is_emoji ? '表情集' : '贴纸包'}做什么？
  `

  const replyMarkup = Markup.inlineKeyboard([
    [
      Markup.callbackButton('🔄 更换所有者', 'admin:pack:edit:change_owner'),
      Markup.callbackButton('🗑 删除', 'admin:pack:edit:remove')
    ],
    [Markup.callbackButton('🔙 返回搜索', 'admin:pack:find')]
  ])

  await ctx.replyWithHTML(resultText, { reply_markup: replyMarkup }).catch(() => {})
})

adminPackEdit.action('admin:pack:edit:change_owner', async (ctx) => {
  await ctx.answerCbQuery()
  await ctx.replyWithHTML('👤 要更换所有者，请发送新所有者的 Telegram ID。')
  ctx.scene.state.awaitingNewOwner = true
})

adminPackEdit.on('text', async (ctx) => {
  if (ctx.scene.state.awaitingNewOwner) {
    const newOwnerId = ctx.message.text.trim()
    const newOwner = await ctx.db.User.findOne({ telegram_id: newOwnerId })

    if (!newOwner) {
      return ctx.replyWithHTML('❌ 未找到用户，请检查 ID 后重试。')
    }

    const { info } = ctx.session.admin || {}

    // The pack exists in Telegram but has no row in our DB (third-party pack) —
    // there is nothing to reassign, and info.save() threw a TypeError.
    if (!info) {
      ctx.scene.state.awaitingNewOwner = false
      return ctx.replyWithHTML('❌ 该贴纸包在数据库中没有记录，无法更换所有者。')
    }

    info.owner = newOwner._id
    await info.save()

    await ctx.replyWithHTML(`✅ ${info.is_emoji ? '表情集' : '贴纸包'}所有者已更换为 <a href="tg://user?id=${newOwner.telegram_id}">${escapeHTML(newOwner.first_name)}</a>`)
    ctx.scene.state.awaitingNewOwner = false
    return ctx.scene.reenter()
  }
})

adminPackEdit.action('admin:pack:edit:remove', async (ctx) => {
  const { editPack } = ctx.session.admin

  const confirmText = `
⚠️ <b>警告：${editPack.is_emoji ? '自定义表情集' : '贴纸包'}删除</b>

你即将删除${editPack.is_emoji ? '表情集' : '贴纸包'} "${escapeHTML(editPack.title)}"。
此操作无法撤销。

确定要继续吗？
  `

  const replyMarkup = Markup.inlineKeyboard([
    [
      Markup.callbackButton('✅ 确定删除', 'admin:pack:edit:remove:confirm'),
      Markup.callbackButton('❌ 取消', 'admin:pack:edit:remove:cancel')
    ]
  ])

  await ctx.editMessageText(confirmText, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup
  }).catch(() => {})
})

adminPackEdit.action('admin:pack:edit:remove:confirm', async (ctx) => {
  const { editPack } = ctx.session.admin

  try {
    const stickerSet = await ctx.telegram.getStickerSet(editPack.name)

    for (const sticker of stickerSet.stickers) {
      await ctx.telegram.deleteStickerFromSet(sticker.file_id).catch(() => {})
      await ctx.db.Sticker.deleteOne({ fileUniqueId: sticker.file_unique_id })
    }

    await ctx.answerCbQuery(`✅ ${editPack.is_emoji ? '自定义表情集' : '贴纸包'}已成功删除`, true)
    await ctx.replyWithHTML(`✅ ${editPack.is_emoji ? '自定义表情集' : '贴纸包'} "${escapeHTML(editPack.title)}" 已删除。`)
    return ctx.scene.enter('adminPackFind')
  } catch (error) {
    console.error('Error removing sticker pack or custom emoji set:', error)
    await ctx.answerCbQuery('❌ 删除贴纸包/表情集时出错', true).catch(() => {})
    await ctx.replyWithHTML('❌ 删除贴纸包/表情集时出错，请稍后重试。')
  }
})

adminPackEdit.action('admin:pack:edit:remove:cancel', async (ctx) => {
  await ctx.answerCbQuery('操作已取消')
  return ctx.scene.reenter()
})

adminPackEdit.action('admin:pack:find', async (ctx) => {
  await ctx.answerCbQuery()
  return ctx.scene.enter('adminPackFind')
})

module.exports = [
  adminPackFind,
  adminPackEdit
]
