import { z } from 'zod';
import { getJwtToken } from '@/services/cfsm/config';

// 同标签页刷新复用；按站点与登录身份隔离，不保存 JWT 签名或凭据。
const PREFIX='cfsm:nikki:v1:';
export const NIKKI_FRESH_MS=150_000;
export function cacheKey(base:string|undefined):string {
  return PREFIX+JSON.stringify([base,getJwtToken().split('.')[1]||'anonymous']);
}
export function readNikkiCache<T extends {observed_at:number|null;fresh:boolean}>(key:string,schema:z.ZodType<T>,now=Date.now()):T|undefined {
  try {
    const parsed=schema.safeParse(JSON.parse(sessionStorage.getItem(key)||'null'));
    if(parsed.success && parsed.data.fresh && parsed.data.observed_at!=null && now>=parsed.data.observed_at-120_000 && now-parsed.data.observed_at<=NIKKI_FRESH_MS)return parsed.data;
    sessionStorage.removeItem(key);
  } catch { /* 隐私模式或损坏缓存不影响联网读取。 */ }
}
export function saveNikkiCache<T extends {observed_at:number|null;fresh:boolean}>(key:string,value:T):void {
  try {if(value.fresh)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch { /* 存储不可用时正常联网。 */ }
}
