import DefaultTheme from 'vitepress/theme'
import Roadmap from './components/Roadmap.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Roadmap', Roadmap)
  },
}
