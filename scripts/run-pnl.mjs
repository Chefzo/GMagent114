const dry = process.argv.includes('--dry-run')
if (dry) {
  process.env.PNL_DRY_RUN = '1'
  process.env.TWILIO_DRY_RUN = '1'
  process.env.SLACK_DRY_RUN = '1'
}
const { runPnlSnapshot } = await import('../lib/gm/pnlSnapshot.ts')
const result = await runPnlSnapshot()
console.log('STATUS:', result.status, '| voiceOk:', result.voiceOk)
console.log('SMS:', JSON.stringify(result.sms))
console.log('SLACK:', JSON.stringify(result.slack))
console.log('PARAGRAPH:')
console.log(result.summary)
