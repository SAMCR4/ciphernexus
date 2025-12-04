
import fs from "fs";
let html = fs.readFileSync("index.html", "utf8");
html = html.replace(/src="\.\/src\/main.*?"/, 'src="./src/main.min.js"');
fs.writeFileSync("index.html", html);
console.log("✔ index.html updated");
