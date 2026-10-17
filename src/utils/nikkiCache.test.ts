// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cacheKey, readNikkiCache, saveNikkiCache } from './nikkiCache';
const schema=z.object({observed_at:z.number().nullable(),fresh:z.boolean(),routes:z.array(z.string())});
beforeEach(()=>{sessionStorage.clear();localStorage.clear();});
describe('Nikki 刷新缓存',()=>{
  it('刷新可恢复有效状态，读取失败不改写，超过采集有效期即舍弃',()=>{
    const key=cacheKey('https://monitor.example');
    const state={observed_at:1_000_000,fresh:true,routes:['lax/ipv4']};
    saveNikkiCache(key,state);
    expect(readNikkiCache(key,schema,1_010_000)).toEqual(state);
    // 联网异常时不会调用 save，原快照仍可读。
    expect(readNikkiCache(key,schema,1_149_999)).toEqual(state);
    expect(readNikkiCache(key,schema,1_150_001)).toBeUndefined();
  });
  it('成功的空快照必须清除旧颜色，失效和坏数据不得恢复',()=>{
    const key=cacheKey('a');
    saveNikkiCache(key,{observed_at:100,fresh:true,routes:['old']});
    saveNikkiCache(key,{observed_at:101,fresh:true,routes:[]});
    expect(readNikkiCache(key,schema,102)?.routes).toEqual([]);
    saveNikkiCache(key,{observed_at:101,fresh:false,routes:[]});
    expect(readNikkiCache(key,schema,102)).toBeUndefined();
    sessionStorage.setItem(key,'{"fresh":true}');
    expect(readNikkiCache(key,schema,102)).toBeUndefined();
  });
  it('不同站点与登录会话互不复用，不保存 JWT 签名',()=>{
    localStorage.setItem('jwt_token','header.user1.signature-secret');
    const first=cacheKey('a');
    expect(first).not.toContain('signature-secret');
    expect(cacheKey('b')).not.toEqual(first);
    localStorage.setItem('jwt_token','header.user2.other-signature');
    expect(cacheKey('a')).not.toEqual(first);
    localStorage.removeItem('jwt_token');expect(cacheKey('a')).not.toEqual(first);
  });
});
