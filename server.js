const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MIME = {".html":"text/html",".css":"text/css",".js":"text/javascript",".json":"application/json"};

function code(){ let c=""; do { c=Math.random().toString(36).slice(2,6).toUpperCase(); } while(rooms.has(c)); return c; }
function send(ws, msg){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room,msg){ room.players.forEach(p=>send(p.ws,msg)); }
function publicPlayers(room){ return room.players.map(p=>({id:p.id,name:p.name,score:p.score})); }

const server=http.createServer((req,res)=>{
  let file=req.url===" /" ? "/index.html" : req.url;
  if(file==="/") file="/index.html";
  file=file.split("?")[0];
  const fp=path.join(__dirname,"public",path.normalize(file).replace(/^(\.\.[\/\\])+/, ""));
  fs.readFile(fp,(e,data)=>{ if(e){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":MIME[path.extname(fp)]||"text/plain"}); res.end(data);
  });
});
const wss=new WebSocket.Server({server});

wss.on("connection",ws=>{
  let player=null, room=null;
  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="create"){
      const c=code(); room={code:c,players:[],host:null,game:null,state:{}};
      rooms.set(c,room); player={id:Math.random().toString(36).slice(2),name:(m.name||"لاعب").slice(0,18),score:0,ws};
      room.players.push(player); room.host=player.id;
      send(ws,{type:"joined",code:c,you:player.id,host:true,players:publicPlayers(room)});
      return;
    }
    if(m.type==="join"){
      room=rooms.get(String(m.code||"").toUpperCase());
      if(!room||room.players.length>=4) return send(ws,{type:"error",msg:"الغرفة غير موجودة أو ممتلئة"});
      player={id:Math.random().toString(36).slice(2),name:(m.name||"لاعب").slice(0,18),score:0,ws};
      room.players.push(player);
      send(ws,{type:"joined",code:room.code,you:player.id,host:false,players:publicPlayers(room)});
      broadcast(room,{type:"players",players:publicPlayers(room)});
      return;
    }
    if(!room||!player) return;

    if(m.type==="start"){
      if(player.id!==room.host) return;
      room.game=m.game; room.state={phase:"start"};
      room.players.forEach(p=>p.score=0);
      broadcast(room,{type:"game",game:m.game,players:publicPlayers(room)});
    }
    if(m.type==="action"){
      handleAction(room,player,m);
    }
    if(m.type==="chat"){
      broadcast(room,{type:"chat",name:player.name,text:String(m.text||"").slice(0,180)});
    }
  });
  ws.on("close",()=>{
    if(room&&player){
      room.players=room.players.filter(p=>p.id!==player.id);
      if(room.players.length===0) rooms.delete(room.code);
      else {
        if(room.host===player.id) room.host=room.players[0].id;
        broadcast(room,{type:"players",players:publicPlayers(room),host:room.host});
      }
    }
  });
});

function add(room,p,n){p.score+=n; broadcast(room,{type:"players",players:publicPlayers(room)});}

function handleAction(room,p,m){
  const a=m.action;
  if(a==="reset"){
    room.game=null; room.state={}; room.players.forEach(x=>x.score=0);
    return broadcast(room,{type:"lobby",players:publicPlayers(room),host:room.host});
  }

  if(room.game==="challenge"){
    if(a==="answer"){
      const correct=!!m.correct;
      add(room,p,correct?100:0);
      broadcast(room,{type:"roundResult",name:p.name,correct,answer:m.answer});
    }
    return;
  }

  if(room.game==="likely"){
    if(a==="vote"){
      room.state.votes=room.state.votes||{};
      room.state.votes[p.id]=m.target;
      if(Object.keys(room.state.votes).length===room.players.length){
        const counts={}; Object.values(room.state.votes).forEach(x=>counts[x]=(counts[x]||0)+1);
        broadcast(room,{type:"likelyResult",counts});
        room.state.votes={};
      } else send(p.ws,{type:"waiting",text:"تم تصويتك، ننتظر البقية..."});
    }
    return;
  }

  if(room.game==="risk"){
    if(a==="risk"){
      const n=Math.floor(Math.random()*101);
      const gain=n<45?-50:(n<75?50:150);
      add(room,p,gain);
      send(p.ws,{type:"riskResult",n,gain});
    }
    return;
  }

  if(room.game==="auction"){
    if(a==="bid"){
      room.state.bids=room.state.bids||{};
      room.state.bids[p.id]=Math.max(0,Math.min(1000,Number(m.amount)||0));
      if(Object.keys(room.state.bids).length===room.players.length){
        const arr=Object.entries(room.state.bids).sort((x,y)=>y[1]-x[1]);
        const winner=room.players.find(x=>x.id===arr[0][0]);
        const item=["صندوق غامض","جائزة ذهبية","درع الحظ","بطاقة مضاعفة"][Math.floor(Math.random()*4)];
        add(room,winner,100);
        broadcast(room,{type:"auctionResult",item,winner:winner.name,amount:arr[0][1]});
        room.state.bids={};
      }
    }
    return;
  }
}

server.listen(PORT,()=>console.log(`H4 Party running on http://localhost:${PORT}`));
