<script setup lang="ts">
import Login from '~/components/Login.vue';

definePageMeta({ layout: false });
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-paper">
    <div class="max-w-sm w-full px-6">
      <Login />
    </div>
  </div>
</template>
