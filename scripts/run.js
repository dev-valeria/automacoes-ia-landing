import { chromium } from 'playwright';
import fetch from 'node-fetch';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

/* =============================
   Funções utilitárias
============================= */

// Abre a primeira conversa (ou qualquer uma) para garantir que o editor apareça
async function openAnyThread(page) {
  // tenta lista lateral (tela /messaging)
  const listItem = page.locator('.msg-conversation-listitem__link').first();
  if (await listItem.isVisible().catch(() => false)) {
    await listItem.click();
    await page.waitForTimeout(1500);
    return;
  }
  // tenta pop-up flutuante (ícone na barra)
  const pop = page.locator('[data-control-name="nav_messaging"]');
  if (await pop.first().isVisible().catch(() => false)) {
    await pop.first().click();
    await page.waitForTimeout(1500);
  }
}

// Digita e envia uma mensagem no editor do LinkedIn (pop-up ou tela cheia)
async function sendReply(page, message) {
  await openAnyThread(page);

  const editorPT = page.locator('div[contenteditable="true"][role="textbox"][aria-label^="Escreva"]');
  const editorAny = page.locator('div[contenteditable="true"][role="textbox"]');
  const editor = (await editorPT.first().isVisible().catch(() => false)) ? editorPT.first() : editorAny.first();

  await editor.waitFor({ state: 'visible', timeout: 15000 });
  await editor.click({ delay: 80 });
  await editor.fill('');
  await editor.type(message, { delay: 15 + Math.floor(Math.random() * 20) });

  // 1) tenta Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  // checa se apareceu uma bolha nossa
  let sent = await page.locator('[data-is-own-message="true"]').last().isVisible().catch(() => false);
  if (sent) {
    console.log('> ✅ Enviado com Enter.');
    return;
  }

  // 2) tenta clique no botão (várias variações)
  const selectors = [
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    'button[title*="Enviar"]',
    '.msg-form__send-button',
    '.msg-form__send-btn',
  ];

  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ delay: 120 });
      await page.waitForTimeout(1500);
      sent = await page.locator('[data-is-own-message="true"]').last().isVisible().catch(() => false);
      if (sent) {
        console.log(`> ✉️ Enviado via botão (${sel}).`);
        return;
      }
    }
  }
  console.log('> ⚠️ Não consegui confirmar o envio (sem bolha própria visível).');
}

/* =============================
   Configurações
============================= */
const STORAGE = path.join('..', 'storage', 'storageState.json');
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const START_URL = process.env.LINKEDIN_START_URL || 'https://www.linkedin.com/messaging/';
const PAGE_NAME = process.env.PAGE_NAME || 'InterWeg Seguros';

/* =============================
   Execução principal
============================= */
(async () => {
  if (!fs.existsSync(STORAGE)) {
    console.log('❌ Nenhum login salvo. Rode "npm run login" antes.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  console.log('> Abrindo LinkedIn logado...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  await openAnyThread(page);

  // tenta obter um nome de conversa (só para compor o payload)
  let name = await page.locator('[data-testid="conversation-header__recipient-names"], .msg-thread__name')
    .first()
    .innerText()
    .catch(() => null);
  if (!name) {
    name = await page.locator('.msg-conversation-listitem__link').first().innerText().catch(() => 'Desconhecido');
  }

  const payload = {
    channel: 'linkedin',
    page: PAGE_NAME,
    contact: { name },
    message: { text: 'teste de integração', ts: Date.now() },
    context: { threadUrl: page.url(), firstInteraction: true },
  };

  console.log('> Enviando payload para n8n...');
  const resp = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));
  console.log('> Resposta do n8n:', data);

  // extrai o texto de reply, independentemente do formato
  const replyText =
    (typeof data?.reply === 'string' && data.reply) ? data.reply :
    (typeof data?.object?.reply === 'string' && data.object.reply) ? data.object.reply :
    (typeof data?.['object Object']?.reply === 'string' && data['object Object'].reply) ? data['object Object'].reply :
    null;

  if (replyText) {
    await sendReply(page, replyText.trim());
    console.log('> ✅ Mensagem enviada no LinkedIn (tentativa concluída).');
  } else {
    console.log('> ⚠️ n8n não retornou "reply" válido.');
  }

  await browser.close();
})();
