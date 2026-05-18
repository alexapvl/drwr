import { defineConfig } from "tsup";
import { copyFileSync } from "fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  outDir: "dist",
  onSuccess: async () => {
    copyFileSync("src/styles.css", "dist/style.css");
  },
});
