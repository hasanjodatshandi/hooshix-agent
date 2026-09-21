import crypto from "node:crypto";
export interface WebSession {readonly createdAt:number;lastUsedAt:number;readonly csrf:string;}
/** In-memory, bounded operator UI sessions. Raw bootstrap secret is never persisted. */
export class OperatorWebSessions{
  private readonly entries=new Map<string,WebSession>();
  constructor(private readonly now:()=>number=Date.now,
    private readonly idleMs=30*60_000,private readonly absoluteMs=8*60*60_000,
    private readonly cap=64){}
  issue():{id:string;csrf:string}{
    this.prune();
    if(this.entries.size>=this.cap)throw new Error("operator_session_limit");
    const id=crypto.randomBytes(32).toString("base64url");
    const csrf=crypto.randomBytes(32).toString("base64url");
    this.entries.set(crypto.createHash("sha256").update(id).digest("hex"),
      {createdAt:this.now(),lastUsedAt:this.now(),csrf});
    return {id,csrf};
  }
  get(id:string|undefined):WebSession|null{
    if(!id||!/^[-_a-zA-Z0-9]{43}$/.test(id))return null;
    const key=crypto.createHash("sha256").update(id).digest("hex");
    const e=this.entries.get(key);
    if(!e)return null;
    const time=this.now();
    if(time-e.createdAt>=this.absoluteMs||time-e.lastUsedAt>=this.idleMs){
      this.entries.delete(key);return null;
    }
    e.lastUsedAt=time;
    return e;
  }
  close(id:string|undefined):void{
    if(id)this.entries.delete(crypto.createHash("sha256").update(id).digest("hex"));
  }
  prune():void{
    for(const [key,e] of this.entries)
      if(this.now()-e.createdAt>=this.absoluteMs||this.now()-e.lastUsedAt>=this.idleMs)
        this.entries.delete(key);
  }
  get activeCount():number{return this.entries.size;}
}
/** Bounded principal-scoped application context, independent of transport session IDs. */
export class HttpPrincipalContexts<T>{
  private readonly entries=new Map<string,{value:T;createdAt:number;lastUsedAt:number}>();
  constructor(private readonly now:()=>number=Date.now,
    private readonly idleMs=30*60_000,private readonly absoluteMs=8*60*60_000,
    private readonly cap=64){}
  get(key:string,create:()=>T):T{
    const current=this.now();
    for(const [id,item] of this.entries){
      if(current-item.createdAt>=this.absoluteMs||current-item.lastUsedAt>=this.idleMs)
        this.entries.delete(id);
    }
    const prior=this.entries.get(key);
    if(prior){prior.lastUsedAt=current;return prior.value;}
    if(this.entries.size>=this.cap)throw new Error("modern_context_limit");
    const value=create();
    this.entries.set(key,{value,createdAt:current,lastUsedAt:current});
    return value;
  }
  get activeCount():number{return this.entries.size;}
}
export class HttpWindowLimiter{
  private readonly buckets=new Map<string,{start:number;count:number}>();
  constructor(private readonly limit:number,private readonly windowMs:number,
    private readonly now:()=>number=Date.now,private readonly maxKeys=4096){}
  allow(key:string):{allowed:boolean;retryAfter:number}{
    const time=this.now();
    if(this.buckets.size>=this.maxKeys){
      for(const [k,v] of this.buckets)if(time-v.start>=this.windowMs)this.buckets.delete(k);
      // Reject unknown identities instead of unbounded memory growth.
      if(this.buckets.size>=this.maxKeys&&!this.buckets.has(key))
        return {allowed:false,retryAfter:Math.ceil(this.windowMs/1000)};
    }
    const previous=this.buckets.get(key);
    const entry=!previous||time-previous.start>=this.windowMs?{start:time,count:0}:previous;
    entry.count++;this.buckets.set(key,entry);
    if(entry.count>this.limit)return {allowed:false,retryAfter:Math.max(1,Math.ceil((this.windowMs-(time-entry.start))/1000))};
    return {allowed:true,retryAfter:0};
  }
}
