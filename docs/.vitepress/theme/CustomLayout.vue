<script setup>
import DefaultTheme from 'vitepress/theme'
import LandingPage from './components/LandingPage.vue'
import { useData, useRouter } from 'vitepress'
import { ref } from 'vue'

const { Layout } = DefaultTheme
const { frontmatter, isDark, lang, site } = useData()
const router = useRouter()

function toggleTheme() {
  isDark.value = !isDark.value
}

const locales = site.value.locales || {}
const localeEntries = Object.entries(locales).map(([path, config]) => ({
  path: path === 'root' ? '/' : `/${path}/`,
  label: config.label || path,
  lang: config.lang || 'en',
}))

function switchLocale(targetPath) {
  const currentPath = router.route.path
  const currentLocale = localeEntries.find(l => l.path !== '/' && currentPath.startsWith(l.path))
  const relPath = currentLocale ? currentPath.slice(currentLocale.path.length - 1) : currentPath
  if (targetPath === '/') {
    router.go(relPath)
  } else {
    router.go(targetPath.slice(0, -1) + relPath)
  }
  showLangMenu.value = false
}

const showLangMenu = ref(false)
function toggleLangMenu() {
  showLangMenu.value = !showLangMenu.value
  if (showLangMenu.value) {
    setTimeout(() => document.addEventListener('click', () => { showLangMenu.value = false }, { once: true }), 0)
  }
}
</script>

<template>
  <Layout>
    <template #home-hero-before>
      <LandingPage v-if="frontmatter.layout === 'home'" />
    </template>

    <template #nav-bar-content-after>
      <!-- GitHub -->
      <a href="https://github.com/pssah4/obsilo" target="_blank" rel="noopener noreferrer" class="github-link" title="GitHub">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
        <span>GitHub</span>
      </a>

      <!-- Appearance toggle with sun/moon indicators -->
      <label class="theme-toggle" title="Toggle appearance">
        <input type="checkbox" :checked="!isDark" @change="toggleTheme" />
        <span class="toggle-track">
          <span class="toggle-icon toggle-moon">&#9789;</span>
          <span class="toggle-icon toggle-sun">&#9788;</span>
          <span class="toggle-thumb" />
        </span>
      </label>

      <!-- Language dropdown -->
      <div class="lang-select" v-if="localeEntries.length > 1">
        <button class="lang-current" @click.stop="toggleLangMenu">
          {{ lang === 'de' ? 'DE' : 'EN' }}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="lang-menu" v-show="showLangMenu">
          <button
            v-for="loc in localeEntries"
            :key="loc.lang"
            class="lang-item"
            :class="{ active: lang === loc.lang }"
            @click="switchLocale(loc.path)"
          >{{ loc.label }}</button>
        </div>
      </div>

      <!-- Buy Me A Coffee -->
      <a href="https://buymeacoffee.com/sebastianhanke" target="_blank" rel="noopener noreferrer" class="bmc-header" title="Support">
        <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" class="bmc-header-img">
      </a>
    </template>

    <template #doc-after>
      <footer class="obsilo-doc-footer">
        <p>
          <a href="https://github.com/pssah4/obsilo/blob/main/LICENSE">Apache 2.0</a>
          <span class="sep">|</span>
          <a href="/imprint">Imprint</a>
          <span class="sep">|</span>
          <span class="disclaimer">Provided as-is, without any warranty or liability.</span>
        </p>
      </footer>
    </template>
  </Layout>
</template>

<style scoped>
/* GitHub link with logo + text */
.github-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-2);
  padding: 0 10px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.15s;
}
.github-link:hover {
  color: var(--vp-c-text-1);
}

/* Appearance toggle with sun/moon */
.theme-toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  padding: 0 8px;
}
.theme-toggle input {
  display: none;
}
.toggle-track {
  position: relative;
  width: 44px;
  height: 22px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 11px;
  transition: background 0.2s, border-color 0.2s;
}
.toggle-icon {
  position: absolute;
  top: 1px;
  font-size: 13px;
  line-height: 18px;
  pointer-events: none;
  opacity: 0.5;
}
.toggle-moon {
  left: 4px;
}
.toggle-sun {
  right: 4px;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: var(--vp-c-text-2);
  border-radius: 50%;
  transition: transform 0.2s;
  z-index: 1;
}
.theme-toggle input:checked + .toggle-track {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
}
.theme-toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(22px);
  background: var(--vp-c-brand-1);
}

/* Language dropdown */
.lang-select {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.lang-current {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--vp-c-divider);
  background: none;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--vp-font-family-base);
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.lang-current:hover {
  border-color: var(--vp-c-text-3);
  color: var(--vp-c-text-1);
}
.lang-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 4px;
  min-width: 100px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 100;
}
.lang-item {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
  border-radius: 4px;
  text-align: left;
  font-size: 13px;
  font-family: var(--vp-font-family-base);
}
.lang-item:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}
.lang-item.active {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

/* Buy Me A Coffee */
.bmc-header {
  display: inline-flex;
  align-items: center;
  margin-left: 16px;
}
.bmc-header-img {
  height: 28px;
  border-radius: 6px;
  transition: opacity 0.15s;
}
.bmc-header-img:hover {
  opacity: 0.85;
}

@media (max-width: 768px) {
  .github-link,
  .theme-toggle,
  .lang-select,
  .bmc-header {
    display: none;
  }
}

/* Footer */
.obsilo-doc-footer {
  margin-top: 3rem;
  padding: 1.5rem 0 0;
  border-top: 1px solid var(--vp-c-divider);
  text-align: center;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}
.obsilo-doc-footer a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}
.obsilo-doc-footer a:hover {
  color: var(--vp-c-brand-1);
}
.obsilo-doc-footer .sep {
  margin: 0 0.5rem;
  opacity: 0.4;
}
.obsilo-doc-footer .disclaimer {
  opacity: 0.7;
}
</style>
