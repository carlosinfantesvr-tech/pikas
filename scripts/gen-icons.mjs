import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { spawnSync } from "child_process";

const svg = readFileSync("public/logo.svg", "utf8");

function page(w, h, mark, label) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${w}px;height:${h}px;background:#08090d;display:grid;place-items:center}
    .wrap{display:grid;justify-items:center;gap:18px}
    .box{width:${mark}px;height:${mark}px}
    .box svg{width:100%;height:100%;display:block}
    p{margin:0;color:#e8edf5;letter-spacing:.32em;font:600 ${Math.round(mark * 0.18)}px sans-serif}
  </style></head><body><div class="wrap"><div class="box">${svg}</div>${label ? "<p>PIKAS</p>" : ""}</div></body></html>`;
}

function shoot(name, w, h, mark, label = false) {
  const file = `/tmp/${name}.html`;
  writeFileSync(file, page(w, h, mark, label));
  const out = `public/icons/${name}.png`;
  const res = spawnSync("google-chrome-stable", [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${file}`,
  ], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

mkdirSync("public/icons", { recursive: true });
shoot("icon-192", 192, 192, 120);
shoot("icon-512", 512, 512, 320);
shoot("maskable-192", 192, 192, 92);
shoot("maskable-512", 512, 512, 246);
shoot("apple-touch-icon", 180, 180, 112);
shoot("favicon-32", 32, 32, 26);
shoot("splash", 540, 1166, 220, true);
console.log("ok");
