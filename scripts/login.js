import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const STORAGE = path.join('..', 'storage', 'storageState.json');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('> Abrindo LinkedIn para login manual...');
  await page.goto('https://www.linkedin.com/login');

  // espere você concluir o login (sem timeout)
  await page.waitForURL(/linkedin\.com\/(feed|messaging)/, { timeout: 0 });

  // salva cookies/ sessão
  await context.storageState({ path: STORAGE });
  console.log(`> Sessão salva em ${STORAGE}`);

  await browser.close();
})();