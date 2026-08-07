import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Unit tests only. Anything that needs a real getBBox, getCTM or a download is
// a Playwright test instead — jsdom implements none of the SVG geometry this
// app is built on, and a test that stubs it would only be testing the stub.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        restoreMocks: true,
        clearMocks: true
    }
});
