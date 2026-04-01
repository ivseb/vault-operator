<script setup lang="ts">
import { onMounted, ref } from 'vue'

const typewriterText = ref<HTMLSpanElement>()
const mentionDropdown = ref<HTMLDivElement>()
const mentionItem = ref<HTMLDivElement>()

interface MentionSegment {
  type: 'mention'
  typed: string
  full: string
  file: string
}

interface TextSegment {
  type: 'text'
  value: string
}

interface SlashSegment {
  type: 'slash'
  typed: string
  full: string
  label: string
}

type Segment = TextSegment | MentionSegment | SlashSegment

interface ComplexPrompt {
  segments: Segment[]
}

type Prompt = string | ComplexPrompt

const prompts: Prompt[] = [
  {
    segments: [
      { type: 'text', value: 'Find all Notes related to ' },
      { type: 'mention', typed: 'Agenti', full: 'AgenticAI', file: 'AgenticAI.md' },
      { type: 'text', value: ' and create a Base.' },
    ],
  },
  'Create a Canvas based on this Base that shows the relationships between the Notes.',
  'Describe the connections between these Notes in the created Canvas and label the arrows.',
  'Show me all meeting notes from January for meetings with John Doe.',
  {
    segments: [
      { type: 'text', value: 'Create a summary of this meeting ' },
      { type: 'mention', typed: 'proce', full: 'process-analysis-sales-dpt', file: 'process-analysis-sales-dpt.md' },
      { type: 'text', value: ' as a new Meeting Note.' },
    ],
  },
  'Create a draw.io diagram that visualizes the process from this meeting as a flowchart.',
  {
    segments: [
      { type: 'text', value: 'Summarize this brainstorming in ' },
      { type: 'mention', typed: 'produ', full: 'product-launch-ideas', file: 'product-launch-ideas.md' },
      { type: 'text', value: ' and visualize the ideas in an Excalidraw graphic.' },
    ],
  },
  'Change the tags in the metadata of all Notes from "agenticai" to "Agentic-AI".',
  'Search the internet for the latest Python release and create a summary note.',
]

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isSimple(p: Prompt): p is string {
  return typeof p === 'string'
}

function getPlainText(p: Prompt): string {
  if (isSimple(p)) return p
  let t = ''
  for (const s of (p as ComplexPrompt).segments) {
    if (s.type === 'text') t += s.value
    else if (s.type === 'mention') t += '@' + s.full
    else if (s.type === 'slash') t += '/' + s.full
  }
  return t
}

onMounted(() => {
  const el = typewriterText.value
  const dropdown = mentionDropdown.value
  const dropdownItemEl = mentionItem.value
  if (!el || !dropdown || !dropdownItemEl) return

  let promptIdx = 0

  function animateSimple(text: string, onDone: () => void) {
    let ci = 0
    function typeChar() {
      ci++
      el!.textContent = text.slice(0, ci)
      if (ci >= text.length) {
        setTimeout(startDelete, 2000)
        return
      }
      setTimeout(typeChar, 50)
    }
    function startDelete() {
      deleteFrom(text, text.length, onDone)
    }
    typeChar()
  }

  function deleteFrom(plain: string, ci: number, onDone: () => void) {
    function del() {
      ci--
      el!.textContent = plain.slice(0, ci)
      if (ci <= 0) {
        setTimeout(onDone, 400)
        return
      }
      setTimeout(del, 25)
    }
    del()
  }

  function animateComplex(prompt: ComplexPrompt, onDone: () => void) {
    const segments = prompt.segments
    const completed: { type: string; html: string; plain: string }[] = []
    let segIdx = 0

    function renderCompleted(partial?: string) {
      let html = ''
      for (const c of completed) html += c.html
      if (partial) html += escHtml(partial)
      el!.innerHTML = html
    }

    function nextSegment() {
      if (segIdx >= segments.length) {
        const plain = getPlainText(prompt)
        setTimeout(() => deleteFrom(plain, plain.length, onDone), 2000)
        return
      }
      const seg = segments[segIdx]
      segIdx++
      if (seg.type === 'text') typeTextSegment(seg.value, nextSegment)
      else if (seg.type === 'mention') typeMentionSegment(seg as MentionSegment, nextSegment)
      else if (seg.type === 'slash') typeSlashSegment(seg as SlashSegment, nextSegment)
    }

    function typeTextSegment(value: string, cb: () => void) {
      let ci = 0
      function t() {
        ci++
        renderCompleted(value.slice(0, ci))
        if (ci >= value.length) {
          completed.push({ type: 'text', html: escHtml(value), plain: value })
          cb()
          return
        }
        setTimeout(t, 50)
      }
      t()
    }

    function typeMentionSegment(seg: MentionSegment, cb: () => void) {
      const typed = '@' + seg.typed
      let ci = 0
      let dropdownShown = false

      function t() {
        ci++
        renderCompleted(typed.slice(0, ci))
        if (ci >= 4 && !dropdownShown) {
          dropdownShown = true
          dropdownItemEl!.textContent = seg.file
          dropdown!.classList.add('visible')
        }
        if (ci >= typed.length) {
          setTimeout(() => {
            dropdown!.classList.remove('visible')
            const pillHtml = '<span class="mention-pill">@' + escHtml(seg.full) + '</span>'
            completed.push({ type: 'mention', html: pillHtml, plain: '@' + seg.full })
            renderCompleted('')
            setTimeout(cb, 100)
          }, 600)
          return
        }
        setTimeout(t, 50)
      }
      t()
    }

    function typeSlashSegment(seg: SlashSegment, cb: () => void) {
      const typed = '/' + seg.typed
      const full = '/' + seg.full
      let ci = 0
      let dropdownShown = false

      function t() {
        ci++
        renderCompleted(typed.slice(0, ci))
        if (ci >= 3 && !dropdownShown) {
          dropdownShown = true
          dropdownItemEl!.textContent = seg.label
          dropdown!.classList.add('visible')
        }
        if (ci >= typed.length) {
          setTimeout(() => {
            dropdown!.classList.remove('visible')
            const slashHtml = '<span class="slash-pill">' + escHtml(full) + '</span>'
            completed.push({ type: 'slash', html: slashHtml, plain: full })
            renderCompleted('')
            setTimeout(cb, 100)
          }, 600)
          return
        }
        setTimeout(t, 50)
      }
      t()
    }

    nextSegment()
  }

  function next() {
    const p = prompts[promptIdx]
    promptIdx = (promptIdx + 1) % prompts.length
    if (isSimple(p)) animateSimple(p, next)
    else animateComplex(p as ComplexPrompt, next)
  }

  next()
})
</script>

<template>
  <div class="chat-mockup">
    <div class="chat-mockup-header">
      <div class="dots">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
      </div>
      Obsilo Agent
    </div>
    <div class="chat-mockup-body">
      <span class="chat-mockup-prompt">&gt;</span>
      <span ref="typewriterText" class="chat-mockup-text" /><span class="chat-mockup-cursor" />
      <div ref="mentionDropdown" class="mention-dropdown">
        <div ref="mentionItem" class="mention-item" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-mockup {
  max-width: 560px;
  width: 100%;
  margin: 1.25rem auto 1.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(124, 58, 237, 0.08);
}

.chat-mockup-header {
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 0.45rem 0.85rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.chat-mockup-header .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  opacity: 0.5;
}

.chat-mockup-header .dot:nth-child(1) { background: #ef4444; opacity: 0.7; }
.chat-mockup-header .dot:nth-child(2) { background: #f59e0b; opacity: 0.7; }
.chat-mockup-header .dot:nth-child(3) { background: #10b981; opacity: 0.7; }

.chat-mockup-header .dots {
  display: flex;
  gap: 5px;
}

.chat-mockup-body {
  background: var(--vp-c-bg-alt);
  padding: 0.7rem 1rem;
  min-height: 46px;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  position: relative;
}

.chat-mockup-prompt {
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  font-weight: 600;
  flex-shrink: 0;
  user-select: none;
  line-height: 1.6;
}

.chat-mockup-text {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  color: var(--vp-c-text-1);
  line-height: 1.6;
  min-height: 1.6em;
}

.chat-mockup-cursor {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  background: var(--vp-c-brand-1);
  vertical-align: text-bottom;
  margin-left: 1px;
  animation: cursorBlink 0.8s step-end infinite;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.mention-dropdown {
  position: absolute;
  top: 100%;
  left: 2rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.2rem;
  min-width: 180px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  display: none;
  z-index: 10;
}

.mention-dropdown.visible {
  display: block;
}

.mention-item {
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
  color: var(--vp-c-text-1);
  background: var(--vp-c-brand-soft);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
}

:deep(.mention-pill) {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  font-size: inherit;
  font-family: inherit;
}

:deep(.slash-pill) {
  color: var(--vp-c-brand-1);
  font-size: inherit;
  font-family: inherit;
  font-weight: 600;
}

@media (max-width: 600px) {
  .mention-dropdown {
    left: 1rem;
    min-width: 150px;
  }

  .chat-mockup-body {
    padding: 0.7rem 0.75rem;
  }

  .chat-mockup-text {
    font-size: 0.78rem;
  }
}
</style>
