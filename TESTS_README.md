
Puppeteer smoke test

Install locally:

npm init -y
npm install puppeteer

Run the local static server (e.g. npx http-server . -p 8080) in project root
Then run:

node tests/smoke_test.js http://localhost:8080

This will open the app headlessly and dump console logs to help debug runtime errors.
