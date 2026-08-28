type CacheEntry<T>={value?:T;promise?:Promise<T>;expiresAt:number};const cache=new Map<string,CacheEntry<unknown>>();
export function readQueryCache<T>(key:string):T|undefined{const current=cache.get(key) as CacheEntry<T>|undefined;return current?.value;}
export function queryOnce<T>(key:string,loader:()=>Promise<T>,ttlMs=15000):Promise<T>{const current=cache.get(key) as CacheEntry<T>|undefined;if(current?.value&&current.expiresAt>Date.now())return Promise.resolve(current.value);if(current?.promise)return current.promise;const entry:CacheEntry<T>={expiresAt:0};entry.promise=loader().then(value=>{entry.value=value;entry.expiresAt=Date.now()+ttlMs;entry.promise=undefined;return value;}).catch(error=>{cache.delete(key);throw error;});cache.set(key,entry);return entry.promise;}
export function invalidateQuery(prefix:string){for(const key of cache.keys())if(key.startsWith(prefix))cache.delete(key);}
export function clearQueryCache(){cache.clear();}
