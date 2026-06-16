// Voice-rule unit tests for the EOD digest.
//
// Run locally:    npm test
// Run in CI:      .github/workflows/voice-rules.yml
//
// Philosophy: every voice rule in assertVoiceRules() should have a positive
// case (good paragraph passes) and a negative case (bad paragraph fails with
// a recognizable reason). When you tighten a rule, add a test here first.

import { assertVoiceRules } from '../lib/gm/digestWriter.ts'

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \u2713 ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, err })
    console.log(`  \u2717 ${name}`)
    console.log(`      ${err.message}`)
  }
}

function expectOk(paragraph, label) {
  const result = assertVoiceRules(paragraph)
  if (!result.ok) {
    throw new Error(`expected ok=true for ${label}; got reasons: ${result.reasons.join(', ')}`)
  }
}

function expectReason(paragraph, reasonSubstring, label) {
  const result = assertVoiceRules(paragraph)
  if (result.ok) {
    throw new Error(`expected ok=false for ${label}; got ok=true`)
  }
  if (!result.reasons.some((r) => r.includes(reasonSubstring))) {
    throw new Error(
      `expected reason containing "${reasonSubstring}" for ${label}; got: ${result.reasons.join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Positive cases — these should pass voice rules
// ---------------------------------------------------------------------------

console.log('\nPositive cases (should pass):')

test('clean operator-voice paragraph passes', () => {
  expectOk(
    '$4,820 net on 142 covers, Friday. Bourbon flight carried the room. Numbers landed in band. Nothing to chase.',
    'clean paragraph',
  )
})

test('paragraph with a lever recommendation passes', () => {
  expectOk(
    '$3,210 net on 98 covers, Tuesday. Old Fashioned was the only mover. Push the bourbon flight tomorrow, three pours away from the well.',
    'lever paragraph',
  )
})

test('paragraph using "net" keyword without dollar sign still passes', () => {
  expectOk(
    'Net came in at four thousand on 120 covers, Wednesday. Bourbon flight led. Nothing to chase.',
    'net keyword paragraph',
  )
})

// ---------------------------------------------------------------------------
// Structural rules
// ---------------------------------------------------------------------------

console.log('\nStructural rules:')

test('empty paragraph fails', () => {
  expectReason('', 'empty', 'empty string')
})

test('whitespace-only paragraph fails', () => {
  expectReason('   \n  \t  ', 'empty', 'whitespace only')
})

test('multi-paragraph output fails', () => {
  expectReason(
    '$4,000 net on 100 covers.\n\nBourbon flight led the night.',
    'multi-paragraph',
    'two paragraphs',
  )
})

test('over 7 sentences fails', () => {
  const sentences = Array.from({ length: 9 }, (_, i) => `Sentence ${i} about $${i * 100} net`).join('. ') + '.'
  expectReason(sentences, 'too many sentences', '9 sentences')
})

test('over 1200 chars fails', () => {
  const long = '$4,000 net on 100 covers. ' + 'a'.repeat(1300)
  expectReason(long, 'too long', '1300+ chars')
})

// ---------------------------------------------------------------------------
// Punctuation rules
// ---------------------------------------------------------------------------

console.log('\nPunctuation rules:')

test('exclamation point fails', () => {
  expectReason(
    '$4,000 net on 100 covers, Friday! Bourbon led.',
    'exclamation',
    'one exclamation',
  )
})

test('multiple exclamation points still fails', () => {
  expectReason(
    '$4,000 net!! 100 covers!!',
    'exclamation',
    'three exclamations',
  )
})

// ---------------------------------------------------------------------------
// Opener rules (throat-clearing)
// ---------------------------------------------------------------------------

console.log('\nOpener rules:')

test('"Last night was..." opener fails', () => {
  expectReason(
    'Last night was solid. $4,000 net on 100 covers. Bourbon led.',
    'throat-clearing',
    'last-night opener',
  )
})

test('"Yesterday we..." opener fails', () => {
  expectReason(
    'Yesterday we hit $4,000 net on 100 covers. Bourbon led.',
    'throat-clearing',
    'yesterday-we opener',
  )
})

test('"The team..." opener fails', () => {
  expectReason(
    'The team moved $4,000 net on 100 covers. Bourbon led.',
    'throat-clearing',
    'the-team opener',
  )
})

test('"Overall," opener fails', () => {
  expectReason(
    'Overall, $4,000 net on 100 covers, Friday. Bourbon led.',
    'throat-clearing',
    'overall opener',
  )
})

// ---------------------------------------------------------------------------
// Cheesy hospitality language
// ---------------------------------------------------------------------------

console.log('\nCheesy hospitality rules:')

test('"crushed it" fails', () => {
  expectReason(
    '$4,000 net on 100 covers, Friday. Bar crushed it on the bourbon flight.',
    'crushed it',
    'crushed-it phrase',
  )
})

test('"killed it" fails', () => {
  expectReason(
    '$4,000 net on 100 covers. Team killed it tonight.',
    'killed it',
    'killed-it phrase',
  )
})

test('"rockstars" fails', () => {
  expectReason(
    '$4,000 net on 100 covers. Bartenders were rockstars.',
    'rockstar',
    'rockstars phrase',
  )
})

test('"amazing night" fails', () => {
  expectReason(
    '$4,000 net on 100 covers. What an amazing night for the bourbon program.',
    'amazing night',
    'amazing-night phrase',
  )
})

test('"guests had a wonderful time" fails', () => {
  expectReason(
    '$4,000 net on 100 covers. Guests had a wonderful time at the bar.',
    'wonderful time',
    'wonderful-time phrase',
  )
})

// ---------------------------------------------------------------------------
// Formatting rules (emoji, markdown)
// ---------------------------------------------------------------------------

console.log('\nFormatting rules:')

test('paragraph with emoji fails', () => {
  expectReason(
    '$4,000 net on 100 covers 🔥. Bourbon led.',
    'emoji',
    'fire emoji',
  )
})

test('markdown bold fails', () => {
  expectReason(
    '$4,000 **net** on 100 covers. Bourbon led.',
    'markdown bold',
    'markdown bold',
  )
})

test('markdown heading fails', () => {
  expectReason(
    '# Digest\n$4,000 net on 100 covers. Bourbon led.',
    'markdown heading',
    'markdown heading',
  )
})

test('bullet list fails', () => {
  expectReason(
    '$4,000 net on 100 covers.\n- Bourbon led\n- Old fashioned second',
    'bullet list',
    'bullet list',
  )
})

// ---------------------------------------------------------------------------
// Content sanity (no money mention)
// ---------------------------------------------------------------------------

console.log('\nContent sanity:')

test('paragraph with no money mention fails', () => {
  expectReason(
    'Smooth Friday on 100 covers. Bourbon flight carried the room. Nothing to chase.',
    'no net sales reference',
    'no money mention',
  )
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.err.message}`)
  }
  process.exit(1)
}
