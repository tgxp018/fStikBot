const Composer = require('telegraf/composer')
const Markup = require('telegraf/markup')

const composer = new Composer()

composer.action(/admin:pack:edit/, (ctx) => ctx.scene.enter('adminPackFind'))

composer.action(/admin:pack:bulk_delete/, (ctx) => ctx.scene.enter('adminPackBulkDelete'))

composer.action(/admin:pack/, async (ctx) => {
  const resultText = `
<b>贴纸包管理</b>

选择操作：
• 编辑或删除单个贴纸包
• 按用户 ID 批量删除贴纸包
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
