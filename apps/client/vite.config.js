import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    server: {
        host: true
    },
    build: {
        sourcemap: true,
        assetsInlineLimit: 0 // Ensures all assets are copied to dist folder instead of inlined
    }
});