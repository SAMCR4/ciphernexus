
Local syntax & smoke checks

1) Ensure Node is installed.
2) From project root run one-off syntax checks:

node -e "new Function(require('fs').readFileSync('./src/main.js','utf8'))"

Repeat for key files, or run a simple script to validate all *.js files.

3) Run the Puppeteer smoke test as documented in TESTS_README.md.
