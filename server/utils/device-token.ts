/**
 * 匿名点歌的持久设备令牌。
 *
 * 匿名模式下没有账号体系，限额需要一种「同一个人」的近似识别：
 * 首次提交点歌/取 PoW 挑战时签发一个随机的 HttpOnly cookie，
 * 之后每次提交都带着它。配合 IP 双重计数——单靠 cookie 可以被清除绕过，
 * 单靠 IP 又会在校园 NAT 下误伤同出口的同学。
 *
 * 令牌本身只是随机串，不含任何个人信息；库里直接存原值即可，
 * 泄露了也只能伪造「某台设备点过歌」这一件事。
 */
import { randomBytes } from 'node:crypto';
import { getCookie, setCookie } from 'h3';
import type { H3Event } from 'h3';

const COOKIE_NAME = 'yys_device';
/** 与点歌周期匹配：留存一个学期足够，毕业换季自动作废 */
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** 读出请求里的设备令牌；格式不对视为没有 */
export function readDeviceToken(event: H3Event): string | null {
  const raw = getCookie(event, COOKIE_NAME);
  return raw && TOKEN_PATTERN.test(raw) ? raw : null;
}

/** 有合法令牌就直接用，没有就签发新令牌并写 cookie；返回最终生效的令牌 */
export function ensureDeviceToken(event: H3Event): string {
  const existing = readDeviceToken(event);
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return token;
}
