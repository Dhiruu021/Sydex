import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("client/dist", "dist", { recursive: true, force: true });
