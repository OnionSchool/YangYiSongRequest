<script setup lang="ts"></script>

<template>
  <div class="min-h-screen bg-paper flex">
    <!-- Sidebar (desktop) -->
    <AdminNav />

    <!-- Main content area -->
    <div class="flex-1 min-w-0 flex flex-col">
      <header class="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div class="flex h-12 items-center px-4 lg:px-6">
          <div class="lg:hidden shrink-0">
            <h1 class="text-sm font-bold" style="font-family: var(--font-display)">广播台</h1>
          </div>

          <NuxtLink
            to="/"
            class="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg border border-rule px-2.5 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span class="hidden sm:inline">前台</span>
          </NuxtLink>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 px-4 py-6 pb-20 lg:px-6 lg:pb-6">
        <div class="mx-auto max-w-5xl">
          <slot />
        </div>
      </main>
    </div>

    <!-- Sidebar border for desktop -->
    <div class="hidden lg:block fixed left-56 top-0 bottom-0 w-px bg-rule" />
  </div>
</template>
