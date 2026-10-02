const Composer = require('telegraf/composer')
const Markup = require('telegraf/markup')

const composer = new Composer()

composer.action(/admin:pack:edit/, (ctx) => ctx.scene.enter('adminPackFind'))

composer.action(/admin:pack:bulk_delete/, (ctx) => ctx.scene.enter('adminPackBulkDelete'))

composer.action(/admin:pack/, async (ctx) => {
  const resultText = `
<b>Admin Pack Management</b>

Choose an option:
• Edit or remove individual packs
• Bulk delete packs by user ID
  `

  const replyMarkup = Markup.inlineKeyboard([
    [Markup.callbackButton('🖊 编辑/删除贴纸包', 'admin:pack:edit')],
    [Markup.callbackButton('🗑 批量删除贴纸包', 'admin:pack:bulk_delete')],
    [Markup.callbackButton('🔙 返回管理菜单', 'admin:back')]
  ])

  await ctx.editMessageText(resultText, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup
  }).catch(() => {})
})

module.exports = composer
