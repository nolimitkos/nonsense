local states=setmetatable({},{__mode='k'})
local band,bor,bxor,lsh,rsh,rrot=bit32.band,bit32.bor,bit32.bxor,bit32.lshift,bit32.rshift,bit32.rrotate
local MUL={0x7F2D,0x4C95,0xF42D,0x5851}
local function advance(st)
    local a={band(st.l,65535),rsh(st.l,16),band(st.h,65535),rsh(st.h,16)}
    local r0=a[1]*MUL[1]
    local r1=a[1]*MUL[2]+a[2]*MUL[1]+math.floor(r0/65536)
    local r2=a[1]*MUL[3]+a[2]*MUL[2]+a[3]*MUL[1]+math.floor(r1/65536)
    local r3=a[1]*MUL[4]+a[2]*MUL[3]+a[3]*MUL[2]+a[4]*MUL[1]+math.floor(r2/65536)
    local lo=r0%65536+(r1%65536)*65536+105
    st.l=lo%4294967296
    st.h=(r2%65536+(r3%65536)*65536+(lo>=4294967296 and 1 or 0))%4294967296
end
local function word(st)
    local h,l=st.h,st.l
    advance(st)
    return rrot(bor(rsh(bxor(l,bor(rsh(l,18),lsh(h,14))),27),lsh(bxor(h,rsh(h,18)),5)),rsh(h,27))
end
local methods={}
local make
local function state(self)
    local st=states[self]
    if not st then error('Random expected',2)end
    return st
end
function methods:NextNumber(a,b)
    local st=state(self)
    local lo,hi=word(st),word(st)
    local value=hi*2^-32+lo*2^-64
    if a==nil and b==nil then return value end
    if type(a)~='number' or type(b)~='number' then error('number expected',2)end
    if a>b then a,b=b,a end
    return a+(b-a)*value
end
function methods:NextInteger(a,b)
    if type(a)~='number' or type(b)~='number' then error('number expected',2)end
    a,b=math.floor(a),math.floor(b)
    if a>b then a,b=b,a end
    local range=b-a+1
    if range>4294967294 then error('Wide Random range unsupported by extraction host',2)end
    local w=word(state(self))
    return a+math.floor((math.floor(w/65536)*range+math.floor((w%65536)*range/65536))/65536)
end
function methods:Clone()
    local st=state(self)
    return make({h=st.h,l=st.l})
end
make=function(st)
    local object=newproxy(true)
    local mt=getmetatable(object)
    mt.__index=methods
    mt.__newindex=function()error('Random is immutable',2)end
    mt.__tostring=function()return 'Random'end
    mt.__metatable='The metatable is locked'
    states[object]=st
    return object
end
local count=0
local function new(seed)
    if seed==nil then count=count+1;seed=math.floor(os.clock()*1e6)+count end
    if type(seed)~='number' then error('number expected',2)end
    seed=math.floor(seed)
    local m=math.abs(seed)
    local hi,lo=math.floor(m/4294967296),m%4294967296
    if seed<0 then lo=(4294967296-lo)%4294967296;hi=(4294967295-hi+(lo==0 and 1 or 0))%4294967296 end
    local st={h=0,l=0}
    advance(st)
    local sum=st.l+lo
    st.l=sum%4294967296;st.h=(st.h+hi+(sum>=4294967296 and 1 or 0))%4294967296
    advance(st)
    return make(st)
end
return {new=new},states
