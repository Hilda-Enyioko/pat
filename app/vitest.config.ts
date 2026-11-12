import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { VITE_PROGRAM_ID: "FZZBN6jwVzWMKR67rta8MewDZPqG8mRHP5igK6qwN8fT" },
  },
});
