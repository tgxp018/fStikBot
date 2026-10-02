const Scene = require('telegraf/scenes/base')
const Markup = require('telegraf/markup')
const { escapeHTML } = require('../utils')

const adminPackBulkDelete = new Scene('adminPackBulkDelete')

adminPackBulkDelete.enter(async (ctx) => {
  const welcomeText = `
批量删除贴纸包

此工具可根据你消息中的链接批量删除多个贴纸包和自定义表情集。

⚠️ 警告：此操作不可逆，请谨慎使用。

请发送包含要删除的贴纸包链接的消息。
链接可以是可见文本或消息中的隐藏链接。
或点击"取消"返回。
  `

  const replyMarkup = Markup.inlineKeyboard([
    [Markup.callbackButton('❌ 取消', 'admin:pack:bulk_delete:cancel')]
  ])

  await ctx.replyWithHTML(welcomeText, { reply_markup: replyMarkup })
})

adminPackBulkDelete.on('message', async (ctx) => {
  const message = ctx.message
  const entities = message.entities || message.caption_entities || []
  const text = message.text || message.caption || ''

  const links = new Set()

  // Extract links from visible text
  const visibleLinks = text.match(/https?:\/\/t\.me\/addstickers\/\w+/g) || []
  visibleLinks.forEach(link => links.add(link))

  // Extract links from entities
  entities.forEach(entity => {
    if (entity.type === 'text_link') {
      if (entity.url.startsWith('https://t.me/addstickers/')) {
        links.add(entity.url)
      }
    } else if (entity.type === 'url') {
      const url = text.slice(entity.offset, entity.offset + entity.length)
      if (url.startsWith('https://t.me/addstickers/')) {
        links.add(url)
      }
    }
  })

  if (links.size === 0) {
    return ctx.replyWithHTML('❌ 消息中未找到有效的贴纸包链接，请重新发送有效链接。')
  }

  const stickerSetNames = Array.from(links).map(link => link.split('/').pop())

  const confirmText = `
在消息中找到 ${stickerSetNames.length} 个贴纸包：

${stickerSetNames.map(name => `• ${escapeHTML(name)}`).join('\n')}

确定要删除所有这些贴纸包吗？

⚠️ 此操作无法撤销！
  `

  const replyMarkup = Markup.inlineKeyboard([
    [
      Markup.callbackButton('✅ 确定全部删除', 'admin:pack:bulk_delete:confirm'),
      Markup.callbackButton('❌ 取消', 'admin:pack:bulk_delete:cancel')
    ]
  ])

  ctx.session.stickerSetsToDelete = stickerSetNames

  await ctx.replyWithHTML(confirmText, { reply_markup: replyMarkup })
})

adminPackBulkDelete.action('admin:pack:bulk_delete:confirm', async (ctx) => {
  const stickerSetNames = ctx.session.stickerSetsToDelete

  if (!stickerSetNames || stickerSetNames.length === 0) {
    return ctx.answerCbQuery('❌ 没有可删除的贴纸包，操作已取消。', true)
  }

  let deletedCount = 0
  let errorCount = 0

  for (const setName of stickerSetNames) {
    try {
      const stickerSet = await ctx.telegram.getStickerSet(setName)
      let removed = 0
      for (const sticker of stickerSet.stickers) {
        const ok = await ctx.telegram.deleteStickerFromSet(sticker.file_id).then(() => true).catch(() => false)
        if (ok) removed++
      }
      // Every deleteStickerFromSet failing used to still count as a success.
      if (removed > 0 || stickerSet.stickers.length === 0) deletedCount++
      else errorCount++
    } catch (error) {
      console.error(`Error deleting sticker set ${setName}:`, error)
      errorCount++
    }
  }

  const resultText = `
操作完成：
✅ 成功删除：${deletedCount} 个贴纸包
❌ 删除失败：${errorCount} 个贴纸包

共处理：${stickerSetNames.length} 个贴纸包
  `

  await ctx.answerCbQuery()
  await ctx.replyWithHTML(resultText)
  delete ctx.session.stickerSetsToDelete
  return ctx.scene.leave()
})

adminPackBulkDelete.action('admin:pack:bulk_delete:cancel', async (ctx) => {
  await ctx.answerCbQuery('操作已取消')
  delete ctx.session.stickerSetsToDelete
  return ctx.scene.leave()
})

adminPackBulkDelete.on('callback_query', async (ctx) => {
  await ctx.answerCbQuery('未知操作')
})

module.exports = adminPackBulkDelete
