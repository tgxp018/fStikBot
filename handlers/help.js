const { replyOrEditBanner } = require('../banners')

module.exports = async (ctx) => {
  await replyOrEditBanner(ctx, 'help', ctx.i18n.t('cmd.guide.web'))
}
