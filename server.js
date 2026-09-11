const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const POLICE_RANKS = [
  { name: "Cadet", roleId: "1528758226420633750", level: 1 },
  { name: "Agent", roleId: "1528758226420633752", level: 2 },
  { name: "Agent Principal", roleId: "1528758226428891359", level: 3 },
  { name: "Agent Șef Adjunct", roleId: "1528758226428891360", level: 4 },
  { name: "Agent Șef Principal", roleId: "1528758226428891361", level: 5 },
  { name: "Sub Inspector", roleId: "1528758226428891362", level: 6 },
  { name: "Inspector", roleId: "1528758226428891363", level: 7 },
  { name: "Inspector Principal", roleId: "1528758226428891364", level: 8 },
  { name: "Sub Comisar", roleId: "1528758226428891365", level: 9 },
  { name: "Comisar", roleId: "1528758226428891366", level: 10 },
  { name: "Comisar Șef", roleId: "1528758226428891368", level: 11 },
  { name: "Chestor Secundar", roleId: "1528758226437275786", level: 12 },
  { name: "Chestor Principal", roleId: "1528758226437275787", level: 13 },
  { name: "Chestor General", roleId: "1528758226437275788", level: 14 },
  { name: "Responsabil Guvernamentale", roleId: "1528758226437275791", level: 15 }
];
const COMMAND_MIN_LEVEL = 11;

function getPoliceRank(roles = []) {
  const ids = roles.map(String);
  return [...POLICE_RANKS].sort((a,b) => b.level-a.level).find(r => ids.includes(r.roleId)) ||
    { name: "MEMBRU", roleId: null, level: 0 };
}
function requireAuth(req,res,next){ if(!req.session?.user) return res.status(401).json({error:"Neautentificat."}); next(); }
function requireCommand(req,res,next){ if(!req.session?.user || Number(req.session.user.rankLevel||0)<COMMAND_MIN_LEVEL) return res.status(403).json({error:"Nu ai acces la această funcție."}); next(); }

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave:false, saveUninitialized:false,
  cookie:{ secure:process.env.NODE_ENV === "production", httpOnly:true, sameSite:"lax", maxAge:1000*60*60*24 }
}));
app.use(express.static(__dirname));
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));

app.get("/auth/discord", (req,res)=>{
  const state=crypto.randomBytes(24).toString("hex");
  req.session.oauthState=state;
  const params=new URLSearchParams({
    client_id:process.env.DISCORD_CLIENT_ID,
    redirect_uri:process.env.DISCORD_REDIRECT_URI,
    response_type:"code", scope:"identify guilds guilds.members.read", state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req,res)=>{
  try{
    const {code,state}=req.query;
    if(!code || !state || state!==req.session.oauthState) return res.status(400).send("Autentificare Discord invalidă. Încearcă din nou.");
    delete req.session.oauthState;
    const tokenResponse=await axios.post("https://discord.com/api/oauth2/token",new URLSearchParams({
      client_id:process.env.DISCORD_CLIENT_ID,
      client_secret:process.env.DISCORD_CLIENT_SECRET,
      grant_type:"authorization_code", code,
      redirect_uri:process.env.DISCORD_REDIRECT_URI
    }),{headers:{"Content-Type":"application/x-www-form-urlencoded"}});
    const accessToken=tokenResponse.data.access_token;
    const user=(await axios.get("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${accessToken}`}})).data;
    const guilds=(await axios.get("https://discord.com/api/users/@me/guilds",{headers:{Authorization:`Bearer ${accessToken}`}})).data;
    if(!guilds.some(g=>String(g.id)===String(process.env.DISCORD_GUILD_ID))) return res.status(403).send("Trebuie să fii membru pe serverul Discord pentru a folosi site-ul.");

    let member=null;
    if(process.env.DISCORD_BOT_TOKEN){
      try{ member=(await axios.get(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${user.id}`,{headers:{Authorization:`Bot ${process.env.DISCORD_BOT_TOKEN}`}})).data; }catch(e){ console.warn("Bot member lookup failed:",e.response?.status||e.message); }
    }
    if(!member){
      try{ member=(await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,{headers:{Authorization:`Bearer ${accessToken}`}})).data; }catch(e){ console.warn("OAuth member lookup failed:",e.response?.status||e.message); }
    }
    const roles=Array.isArray(member?.roles)?member.roles.map(String):[];
    const rank=getPoliceRank(roles);
    req.session.user={
      id:String(user.id), username:user.username, globalName:user.global_name||user.username,
      displayName:member?.nick||user.global_name||user.username, avatar:user.avatar||null,
      roles, rank:rank.name, rankLevel:rank.level, rankRoleId:rank.roleId,
      isCommand:rank.level>=COMMAND_MIN_LEVEL, guildId:String(process.env.DISCORD_GUILD_ID||"")
    };
    req.session.save(err=>{ if(err){console.error("Session save error:",err);return res.status(500).send("Sesiunea nu a putut fi salvată.");} res.redirect("/"); });
  }catch(error){ console.error("Discord OAuth error:",error.response?.data||error.message); res.redirect("/?error=discord"); }
});

app.get("/api/me",(req,res)=>{
  if(!req.session?.user) return res.status(401).json({authenticated:false,loggedIn:false});
  res.json({authenticated:true,loggedIn:true,user:req.session.user,permissions:{command:Boolean(req.session.user.isCommand),admin:Boolean(req.session.user.isCommand)}});
});
app.get("/dashboard",(req,res)=>{ if(!req.session?.user) return res.redirect("/"); res.sendFile(path.join(__dirname,"dashboard.html")); });
app.get("/logout",(req,res)=>req.session.destroy(()=>{res.clearCookie("connect.sid");res.redirect("/");}));
app.get("/health",(req,res)=>res.json({status:"online",service:"MAI Rush - Politia Romana"}));

// Middleware-urile sunt pregătite pentru rutele administrative viitoare.
app.locals.requireAuth=requireAuth;
app.locals.requireCommand=requireCommand;

const PORT=process.env.PORT||3000;
app.listen(PORT,"0.0.0.0",()=>console.log(`MAI Rush pornit pe portul ${PORT}`));
