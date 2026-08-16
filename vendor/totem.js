/* ============================================================
   门厅：阴阳龙纹图腾 + 光笔刷交互
   图腾线条来自 totem.json（由你的 3D 模型提取的折痕线稿）
   纯 Canvas 2D，不依赖任何库
   ============================================================ */
(function(){
"use strict";

var CFG = {
  bg:        "#1F080A",   /* 暗红背景 */
  dark:      "#5E1F24",   /* 浮雕主体的暗红 */
  darkHi:    "#8C3A3E",   /* 浮雕受光边 */
  darkLo:    "#12050700", /* 浮雕投影（带透明度后缀无效，见下面单独处理） */
  darkAlpha: 0.62,        /* 浮雕整体可见度 */
  glow:      "#E01030",   /* 激活后的霓虹红，偏暗一档 */
  brush:     70,          /* 笔刷半径 */
  brushFast: 108,         /* 快速移动时的笔刷半径 */
  fade:      1.5,         /* 余辉淡出时长（秒） */
  eyeDist:   50,          /* 靠近鱼眼的触发距离（像素） */
  particles: 160          /* 粒子池上限 */
};

var host, cv, ctx, mask, mctx, grain;
var paths = null, eyes = [];
var W = 0, H = 0, DPR = 1, S = 1, CX = 0, CY = 0;
var raf = null, running = false, t0 = 0, lastT = 0;

var mx = -9999, my = -9999, pmx = -9999, pmy = -9999, speed = 0, inside = false;
var parts = [], ripple = 0, ripplePos = null;
var eyeHot = [];

var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 尺寸与坐标 ---------- */
function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = host.clientWidth || innerWidth;
  H = host.clientHeight || innerHeight;
  cv.width = Math.floor(W*DPR); cv.height = Math.floor(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);

  /* 遮罩图用一半分辨率就够，省一半开销 */
  mask.width = Math.floor(W/2); mask.height = Math.floor(H/2);

  S  = Math.min(W, H) * 0.42;      /* 图腾半径 */
  CX = W/2; CY = H/2;
  buildGrain();
  if(paths){ buildRelief(); buildGlow(); }
}

/* 针织／皮革质感：一次生成，之后平铺 */
function buildGrain(){
  var g = document.createElement("canvas");
  g.width = g.height = 128;
  var c = g.getContext("2d");
  var img = c.createImageData(128,128);
  for(var i=0;i<img.data.length;i+=4){
    var n = (Math.random()*2-1);
    var v = 128 + n*11;
    img.data[i]=v; img.data[i+1]=v*0.92; img.data[i+2]=v*0.92; img.data[i+3]=26;
  }
  c.putImageData(img,0,0);
  /* 叠一层横向织纹 */
  c.globalAlpha = 0.16; c.strokeStyle = "#000";
  for(var y=0;y<128;y+=3){ c.beginPath(); c.moveTo(0,y); c.lineTo(128,y); c.stroke(); }
  grain = ctx.createPattern(g, "repeat");
}

function toScreen(p){ return [CX + p[0]*S, CY + p[1]*S]; }

/* ---------- 预渲染的两层 ---------- */
var reliefCv = null, glowCv = null, compCv = null;

function makeCanvas(){
  var c = document.createElement("canvas");
  c.width = cv.width; c.height = cv.height;
  return c;
}

/* 浮雕层：投影 + 受光边 + 主体，做出石刻的立体感 */
function buildRelief(){
  reliefCv = makeCanvas();
  var c = reliefCv.getContext("2d");
  c.setTransform(DPR,0,0,DPR,0,0);
  c.lineJoin = c.lineCap = "round";
  c.globalAlpha = CFG.darkAlpha;

  /* 投影：向右下偏移的深色 */
  c.save(); c.translate(1.6, 1.9);
  c.strokeStyle = "#0B0203"; c.lineWidth = 2.1;
  strokeTotem(c); c.restore();

  /* 受光边：向左上偏移的亮色 */
  c.save(); c.translate(-1.1, -1.3);
  c.globalAlpha = CFG.darkAlpha*0.55;
  c.strokeStyle = CFG.darkHi; c.lineWidth = 1.0;
  strokeTotem(c); c.restore();

  /* 主体 */
  c.globalAlpha = CFG.darkAlpha;
  c.strokeStyle = CFG.dark; c.lineWidth = 1.35;
  strokeTotem(c);
}

/* 发光层：只在尺寸变化时画一次，之后每帧只做遮罩合成 */
function buildGlow(){
  glowCv = makeCanvas();
  var c = glowCv.getContext("2d");
  c.setTransform(DPR,0,0,DPR,0,0);
  c.lineJoin = c.lineCap = "round";
  c.shadowColor = CFG.glow;
  c.strokeStyle = CFG.glow;
  c.shadowBlur = 22; c.globalAlpha = 0.5; c.lineWidth = 2.0;
  strokeTotem(c);
  c.shadowBlur = 10; c.globalAlpha = 1; c.lineWidth = 1.35;
  strokeTotem(c);
  compCv = makeCanvas();
}

/* ---------- 画图腾 ---------- */
function strokeTotem(c, lw){
  for(var i=0;i<paths.length;i++){
    var p = paths[i];
    c.beginPath();
    var a = toScreen(p[0]);
    c.moveTo(a[0], a[1]);
    for(var j=1;j<p.length;j++){
      var b = toScreen(p[j]);
      c.lineTo(b[0], b[1]);
    }
    c.stroke();
  }
}

/* ---------- 粒子 ---------- */
function spawn(x, y, n){
  for(var i=0;i<n;i++){
    if(parts.length >= CFG.particles) parts.shift();
    var a = Math.random()*Math.PI*2, sp = 0.4 + Math.random()*1.9;
    parts.push({ x:x, y:y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                 life:1, r:0.7+Math.random()*1.6 });
  }
}

/* ---------- 主循环 ---------- */
function frame(){
  var t = (performance.now()-t0)/1000;
  var dt = Math.min(0.05, t-lastT); lastT = t;

  /* 1. 背景 */
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = CFG.bg;
  ctx.fillRect(0,0,W,H);
  if(grain){ ctx.fillStyle = grain; ctx.fillRect(0,0,W,H); }

  /* 2. 底图层：预渲染好的浮雕，直接贴上去 */
  if(reliefCv){
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(reliefCv, 0, 0);
    ctx.restore();
  }

  /* 3. 遮罩：记录笔刷轨迹，按指数淡出 */
  var k = Math.pow(0.5, dt/(CFG.fade/3.2));     /* 指数淡出：约 1.5 秒散尽 */
  mctx.globalCompositeOperation = "destination-out";
  mctx.fillStyle = "rgba(0,0,0,"+(1-k).toFixed(3)+")";
  mctx.fillRect(0,0,mask.width,mask.height);
  mctx.globalCompositeOperation = "source-over";

  if(inside && mx > -9000){
    var d = Math.hypot(mx-pmx, my-pmy);
    speed += (Math.min(1, d/26) - speed)*0.25;
    var rad = CFG.brush + (CFG.brushFast-CFG.brush)*speed;
    /* 沿着这一帧的位移连续涂抹，快速移动时不会断成点 */
    var steps = Math.max(1, Math.ceil(d/12));
    for(var s=0;s<=steps;s++){
      var px = pmx + (mx-pmx)*(s/steps), py = pmy + (my-pmy)*(s/steps);
      var g = mctx.createRadialGradient(px/2, py/2, 0, px/2, py/2, rad/2);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.55, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = g;
      mctx.beginPath(); mctx.arc(px/2, py/2, rad/2, 0, Math.PI*2); mctx.fill();
    }
    if(speed > 0.28 && Math.random() < 0.5) spawn(mx, my, 1+Math.round(speed*2));
    pmx = mx; pmy = my;
  } else {
    speed += (0-speed)*0.1;
  }

  /* 4. 鱼眼：靠近就脉冲爆闪，并激起涟漪 */
  for(var e=0;e<eyes.length;e++){
    var ex = CX + eyes[e].x*S, ey = CY + eyes[e].y*S;
    var near = Math.hypot(mx-ex, my-ey) < CFG.eyeDist && inside;
    eyeHot[e] = eyeHot[e] || 0;
    if(near && eyeHot[e] < 0.05){
      ripple = 1; ripplePos = [ex, ey];
      spawn(ex, ey, 14);
    }
    eyeHot[e] += ((near?1:0) - eyeHot[e]) * (near ? 0.35 : 0.045);
    if(eyeHot[e] > 0.01){
      var pulse = 0.55 + 0.45*Math.sin(t*22 + e);
      var rr = eyes[e].r*S*(1.1 + 0.5*eyeHot[e]);
      mctx.save();
      var gg = mctx.createRadialGradient(ex/2, ey/2, 0, ex/2, ey/2, rr/2*2.2);
      gg.addColorStop(0, "rgba(255,255,255,"+(0.95*eyeHot[e]*pulse).toFixed(3)+")");
      gg.addColorStop(0.5, "rgba(255,255,255,"+(0.5*eyeHot[e]).toFixed(3)+")");
      gg.addColorStop(1, "rgba(255,255,255,0)");
      mctx.fillStyle = gg;
      mctx.beginPath(); mctx.arc(ex/2, ey/2, rr/2*2.2, 0, Math.PI*2); mctx.fill();
      mctx.restore();
    }
  }

  /* 涟漪：一圈向外扩散的激活波 */
  if(ripple > 0.002 && ripplePos){
    var R = (1-ripple)*Math.min(W,H)*0.62;
    mctx.save();
    mctx.strokeStyle = "rgba(255,255,255,"+(0.55*ripple).toFixed(3)+")";
    mctx.lineWidth = (26*ripple + 6)/2;
    mctx.beginPath();
    mctx.arc(ripplePos[0]/2, ripplePos[1]/2, R/2, 0, Math.PI*2);
    mctx.stroke();
    mctx.restore();
    ripple -= dt*0.85;
  }

  /* 5. 高亮层：拿预渲染的发光图，用遮罩裁出被笔刷扫过的部分 */
  if(glowCv && compCv){
    var lc = compCv.getContext("2d");
    lc.setTransform(1,0,0,1,0,0);
    lc.globalCompositeOperation = "copy";
    lc.drawImage(glowCv, 0, 0);
    lc.globalCompositeOperation = "destination-in";
    lc.drawImage(mask, 0, 0, compCv.width, compCv.height);

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(compCv, 0, 0);
    ctx.restore();
  }

  /* 6. 粒子 */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for(var i=parts.length-1;i>=0;i--){
    var p = parts[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.965; p.vy = p.vy*0.965 + 0.012;
    p.life -= dt*0.85;
    if(p.life <= 0){ parts.splice(i,1); continue; }
    ctx.fillStyle = "rgba(255,40,60,"+(p.life*0.75).toFixed(3)+")";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r*p.life, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();

  raf = requestAnimationFrame(frame);
}

/* ---------- 事件 ---------- */
function onMove(e){
  var r = cv.getBoundingClientRect();
  var nx = e.clientX - r.left, ny = e.clientY - r.top;
  if(pmx < -9000){ pmx = nx; pmy = ny; }
  mx = nx; my = ny; inside = true;
}
function onLeave(){ inside = false; mx = my = -9999; pmx = pmy = -9999; }

/* ---------- 生命周期 ---------- */
function ensure(){
  host = document.getElementById("hall");
  cv   = document.getElementById("hallCanvas");
  if(!host || !cv) return false;
  if(!ctx){
    ctx  = cv.getContext("2d");
    mask = document.createElement("canvas");
    mctx = mask.getContext("2d");
    addEventListener("resize", resize);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
  }
  return true;
}

function start(){
  if(running || !ensure()) return;
  if(!paths){
    fetch("totem.json").then(function(r){ return r.json(); })
      .then(function(d){
        paths = d.paths; eyes = d.eyes || [];
        host.classList.add("ready");
        begin();
      })
      .catch(function(){
        /* 直接双击打开时浏览器不允许读本地 json，用内嵌副本 */
        if(window.TOTEM_DATA){
          paths = window.TOTEM_DATA.paths; eyes = window.TOTEM_DATA.eyes || [];
          host.classList.add("ready");
          begin();
        } else {
          host.classList.add("nomodel");
        }
      });
    return;
  }
  begin();
}
function begin(){
  running = true;
  resize();
  t0 = performance.now(); lastT = 0;
  if(reduce){ frame(); if(raf){ cancelAnimationFrame(raf); raf = null; } return; }
  raf = requestAnimationFrame(frame);
}
function stop(){
  running = false;
  if(raf){ cancelAnimationFrame(raf); raf = null; }
}
document.addEventListener("visibilitychange", function(){
  if(document.hidden) stop();
  else if(document.getElementById("hall") &&
          document.getElementById("hall").classList.contains("on")) start();
});

window.Hall3D = { start: start, stop: stop };
})();
