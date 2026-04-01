<script setup>
import DefaultTheme from 'vitepress/theme'
import ChatMockup from './components/ChatMockup.vue'
import { useData } from 'vitepress'

const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <Layout>
    <template #home-hero-info-after>
      <ChatMockup v-if="frontmatter.layout === 'home'" />
    </template>
  </Layout>
</template>
