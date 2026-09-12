import { createTransport, type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP 未配置，请设置 SMTP_HOST / SMTP_USER / SMTP_PASS 环境变量');
  }

  transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  await getTransporter().sendMail({
    from,
    to,
    subject: '广播台邮箱验证码',
    text: `你的邮箱验证码是：${code}\n\n验证码 10 分钟内有效，请尽快完成验证。\n\n如果这不是你的操作，请忽略此邮件。`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px">邮箱验证码</h2>
        <p>你的验证码是：</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px;text-align:center;
                  background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">${code}</p>
        <p style="color:#666;font-size:14px">验证码 10 分钟内有效，请尽快完成验证。</p>
        <p style="color:#999;font-size:12px;margin-top:24px">如果这不是你的操作，请忽略此邮件。</p>
      </div>
    `,
  });
}
