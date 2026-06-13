process.env.DIGEST_DRY_RUN = '1'
process.env.TWILIO_DRY_RUN = '1'
process.env.SLACK_DRY_RUN = '1'

const { runShiftDigest } = await import('../lib/gm/shiftDigest.ts')
const result = await runShiftDigest()
console.log('STATUS:', result.status, '| voiceOk:', result.voiceOk)
console.log('SMS:', JSON.stringify(result.sms))
console.log('SLACK:', JSON.stringify(result.slack))
console.log('PARAGRAPH:', result.summary)
