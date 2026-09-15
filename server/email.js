// =================================================================
// Envio de e-mail (recuperação de senha), via SMTP com nodemailer.
//
// Configuração por variáveis de ambiente: SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS, SMTP_FROM e APP_URL (usada para montar o link
// de redefinição, ex.: "https://seudominio.com"). Se essas variáveis
// não estiverem definidas, ou se o envio falhar por qualquer motivo, o
// link é apenas registrado no console (console.warn) em vez de travar
// a requisição — mesmo espírito do fallback em memória do MySQL em
// server/db.js: a funcionalidade continua demonstrável mesmo sem
// infraestrutura de e-mail configurada, e passa a enviar e-mails de
// verdade assim que as variáveis SMTP_* forem preenchidas.
// =================================================================
const nodemailer = require('nodemailer');

function smtpConfigurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transportador;
function obterTransportador() {
  if (!transportador) {
    transportador = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transportador;
}

// Monta o link de redefinição e tenta enviar por e-mail. Nunca lança
// erro para quem chamou — a rota de "esqueci minha senha" sempre deve
// responder com sucesso genérico, mesmo se o e-mail falhar (ver
// server/server.js).
async function enviarEmailRedefinicao({ paraEmail, nome, tipo, token }) {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  const link = `${baseUrl}/?tipo=${encodeURIComponent(tipo)}&token=${encodeURIComponent(token)}`;

  if (!smtpConfigurado()) {
    console.warn(
      `[e-mail] SMTP não configurado (defina SMTP_HOST/SMTP_USER/SMTP_PASS). Link de redefinição de senha para ${paraEmail} (válido por 1 hora):\n  ${link}`
    );
    return;
  }

  try {
    await obterTransportador().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: paraEmail,
      subject: 'SOS Car — Redefinição de senha',
      text: `Olá, ${nome}!\n\nRecebemos um pedido para redefinir sua senha no SOS Car. Acesse o link abaixo (válido por 1 hora) para escolher uma nova senha:\n\n${link}\n\nSe você não pediu isso, apenas ignore este e-mail.`,
      html: `<p>Olá, ${nome}!</p><p>Recebemos um pedido para redefinir sua senha no SOS Car. Acesse o link abaixo (válido por 1 hora) para escolher uma nova senha:</p><p><a href="${link}">${link}</a></p><p>Se você não pediu isso, apenas ignore este e-mail.</p>`
    });
  } catch (erro) {
    console.warn(
      `[e-mail] Falha ao enviar para ${paraEmail}. Link de redefinição (válido por 1 hora):\n  ${link}`,
      erro.message
    );
  }
}

module.exports = { enviarEmailRedefinicao };
