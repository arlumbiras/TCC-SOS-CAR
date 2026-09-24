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

// O nome vem do cadastro (texto livre). No corpo HTML do e-mail ele precisa
// ser escapado, senão quem se cadastra com um nome contendo tags consegue
// injetar HTML/links na mensagem.
function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function smtpConfigurado() {
  const provider = (process.env.SMTP_PROVIDER || 'gmail').toLowerCase();
  const host = process.env.SMTP_HOST || (
    provider === 'hotmail' ? process.env.SMTP_HOST_HOTMAIL : process.env.SMTP_HOST_GMAIL
  );
  const usuario = process.env.SMTP_USER || (
    provider === 'hotmail' ? process.env.SMTP_USER_HOTMAIL : process.env.SMTP_USER_GMAIL
  );
  const senha = process.env.SMTP_PASS || (
    provider === 'hotmail' ? process.env.SMTP_PASS_HOTMAIL : process.env.SMTP_PASS_GMAIL
  );
  return Boolean(host && usuario && senha);
}

function obterConfigSmtp() {
  const provider = (process.env.SMTP_PROVIDER || 'gmail').toLowerCase();

  if (provider === 'hotmail') {
    return {
      host: process.env.SMTP_HOST_HOTMAIL || process.env.SMTP_HOST || 'smtp.office365.com',
      port: Number(process.env.SMTP_PORT_HOTMAIL || process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER_HOTMAIL || process.env.SMTP_USER,
        pass: process.env.SMTP_PASS_HOTMAIL || process.env.SMTP_PASS
      }
    };
  }

  return {
    host: process.env.SMTP_HOST_GMAIL || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT_GMAIL || process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER_GMAIL || process.env.SMTP_USER,
      pass: process.env.SMTP_PASS_GMAIL || process.env.SMTP_PASS
    }
  };
}

let transportador;
function obterTransportador() {
  if (!transportador) {
    const config = obterConfigSmtp();
    transportador = nodemailer.createTransport(config);
  }
  return transportador;
}

// Monta o link de redefinição e tenta enviar por e-mail. Nunca lança
// erro para quem chamou — a rota de "esqueci minha senha" sempre deve
// responder com sucesso genérico, mesmo se o e-mail falhar (ver
// server/server.js).
async function enviarEmailRedefinicao({ paraEmail, nome, tipo, token, appUrl }) {
  const baseUrl = appUrl || process.env.APP_URL || 'https://localhost:3000';
  const link = `${baseUrl}/?tipo=${encodeURIComponent(tipo)}&token=${encodeURIComponent(token)}`;

  if (!smtpConfigurado()) {
    console.warn(
      `[e-mail] SMTP não configurado (defina SMTP_HOST/SMTP_USER/SMTP_PASS). Link de redefinição de senha para ${paraEmail} (válido por 1 hora):\n  ${link}`
    );
    return { link, smtpConfigurado: false };
  }

  try {
    await obterTransportador().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: paraEmail,
      subject: 'SOS Car — Redefinição de senha',
      text: `Olá, ${nome}!\n\nRecebemos um pedido para redefinir sua senha no SOS Car. Acesse o link abaixo (válido por 1 hora) para escolher uma nova senha:\n\n${link}\n\nSe você não pediu isso, apenas ignore este e-mail.`,
      html: `<p>Olá, ${escaparHtml(nome)}!</p><p>Recebemos um pedido para redefinir sua senha no SOS Car. Acesse o link abaixo (válido por 1 hora) para escolher uma nova senha:</p><p><a href="${escaparHtml(link)}">${escaparHtml(link)}</a></p><p>Se você não pediu isso, apenas ignore este e-mail.</p>`
    });
    return { link, smtpConfigurado: true };
  } catch (erro) {
    console.warn(
      `[e-mail] Falha ao enviar para ${paraEmail}. Link de redefinição (válido por 1 hora):\n  ${link}`,
      erro.message
    );
    return { link, smtpConfigurado: false };
  }
}

module.exports = { enviarEmailRedefinicao };
